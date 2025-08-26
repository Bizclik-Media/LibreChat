const jwt = require('jsonwebtoken');
const { ExtractJwt } = require('passport-jwt');
const { isAgentsEndpoint, ResourceType, PermissionBits, Time, CacheKeys } = require('librechat-data-provider');
const { findAccessibleResources } = require('~/server/services/PermissionService');
const { getUserById } = require('~/models');
const { Agent } = require('~/db/models');
const { getLogStores } = require('~/cache');
const { logger } = require('@librechat/data-schemas');

/**
 * Filter ModelSpecs based on user's ACL permissions for specific agents
 * @param {Express.Request} req - The Express request object
 * @param {TCustomConfig['modelSpecs']} modelSpecs - The model specs configuration
 * @returns {Promise<TCustomConfig['modelSpecs']>} Filtered model specs
 */
async function filterModelSpecsByPermissions(req, modelSpecs) {
  if (!modelSpecs?.list) {
    logger.debug('[filterModelSpecs] No modelSpecs.list found, returning unchanged');
    return modelSpecs;
  }

  // Extract JWT token and get user
  const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
  if (!token) {
    logger.debug('[filterModelSpecs] No JWT token found, returning unchanged');
    return modelSpecs;
  }

  let user;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    logger.debug(`[filterModelSpecs] JWT payload:`, payload);
    user = await getUserById(payload.id, '-password -__v -totpSecret -backupCodes');
    if (!user) {
      logger.debug('[filterModelSpecs] User not found, returning unchanged');
      return modelSpecs;
    }
  } catch (err) {
    logger.debug('[filterModelSpecs] JWT verification failed, returning unchanged');
    return modelSpecs;
  }

  const userId = user._id.toString();
  logger.debug(`[filterModelSpecs] Filtering ${modelSpecs.list.length} ModelSpecs for user ${userId}`);

  // Check per-user cache first
  const cache = getLogStores(CacheKeys.CONFIG_STORE);
  const userCacheKey = `FILTERED_MODELSPECS_${userId}`;
  const cachedFiltered = await cache.get(userCacheKey);

  if (cachedFiltered) {
    logger.debug(`[filterModelSpecs] Using cached filtered ModelSpecs for user ${userId}`);
    return cachedFiltered;
  }

  // Get agent IDs the user has VIEW access to via ACL (these are MongoDB ObjectIds)
  const accessibleAgentIds = await findAccessibleResources({
    userId,
    role: user.role,
    resourceType: ResourceType.AGENT,
    requiredPermissions: PermissionBits.VIEW,
  });

  logger.debug(`[filterModelSpecs] User ${userId} has VIEW access to ${accessibleAgentIds.length} agents: [${accessibleAgentIds.map(id => id.toString()).join(', ')}]`);

  // Query agents by MongoDB _id to get their string id field
  const accessibleAgents = await Agent.find(
    { _id: { $in: accessibleAgentIds } },
    { id: 1 }
  ).lean();

  // Extract string IDs that ModelSpecs use
  const accessibleStringIds = accessibleAgents.map(agent => agent.id);
  logger.debug(`[filterModelSpecs] Accessible agent string IDs: [${accessibleStringIds.join(', ')}]`);

  // Filter ModelSpecs based on agent access
  const filteredList = modelSpecs.list.filter(spec => {
    const isAgentSpec = isAgentsEndpoint(spec.preset.endpoint);

    if (!isAgentSpec) {
      logger.debug(`[filterModelSpecs] Keeping non-agent ModelSpec: ${spec.name}`);
      return true; // Keep non-agent specs
    }

    const agentId = spec.preset.agent_id;
    if (!agentId) {
      logger.warn(`[filterModelSpecs] Agent ModelSpec ${spec.name} has no agent_id, filtering out`);
      return false; // No agent_id, can't verify access
    }

    // Check if user has VIEW access to this specific agent
    // Use string ID comparison with ModelSpec agent_id
    const hasAccess = accessibleStringIds.includes(agentId);

    if (hasAccess) {
      logger.debug(`[filterModelSpecs] Keeping agent ModelSpec ${spec.name} - user has access to agent ${agentId}`);
    } else {
      logger.debug(`[filterModelSpecs] Filtering out agent ModelSpec ${spec.name} - user lacks access to agent ${agentId}`);
    }

    return hasAccess;
  });

  logger.debug(`[filterModelSpecs] Filtered from ${modelSpecs.list.length} to ${filteredList.length} ModelSpecs`);

  const filteredResult = {
    ...modelSpecs,
    list: filteredList,
  };

  // Cache the filtered result for this user (10 minutes TTL)
  await cache.set(userCacheKey, filteredResult, Time.TEN_MINUTES);
  logger.debug(`[filterModelSpecs] Cached filtered ModelSpecs for user ${userId} for 10 minutes`);

  return filteredResult;
}

module.exports = { filterModelSpecsByPermissions };
