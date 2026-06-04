const { isAgentsEndpoint, ResourceType, PermissionBits } = require('librechat-data-provider');
const { findAccessibleResources } = require('~/server/services/PermissionService');
const { Agent } = require('~/db/models');
const { logger } = require('@librechat/data-schemas');

/**
 * Filter ModelSpecs based on user's ACL permissions for specific agents
 * @param {Express.Request} req - The Express request object
 * @param {TCustomConfig['modelSpecs']} modelSpecs - The model specs configuration
 * @returns {Promise<TCustomConfig['modelSpecs']>} Filtered model specs
 */
async function filterModelSpecsByPermissions(req, modelSpecs) {
  if (!modelSpecs?.list) {
    return modelSpecs;
  }

  // The /api/config authenticated branch in v0.8.5 runs under the JWT middleware
  // chain, so req.user is populated. If for some reason it isn't, return unchanged
  // rather than over-filter.
  const userId = req.user?.id ?? req.user?._id?.toString();
  if (!userId) {
    logger.debug('[filterModelSpecs] No req.user found, returning unchanged');
    return modelSpecs;
  }

  const role = req.user.role;
  logger.debug(`[filterModelSpecs] Filtering ${modelSpecs.list.length} ModelSpecs for user ${userId}`);

  // Agent IDs the user has VIEW access to via ACL (returned as MongoDB ObjectIds)
  const accessibleAgentIds = await findAccessibleResources({
    userId,
    role,
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

  return {
    ...modelSpecs,
    list: filteredList,
  };
}

module.exports = { filterModelSpecsByPermissions };
