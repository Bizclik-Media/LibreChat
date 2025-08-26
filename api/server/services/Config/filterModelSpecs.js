const { isAgentsEndpoint, ResourceType, PermissionBits } = require('librechat-data-provider');
const { findAccessibleResources } = require('~/server/services/PermissionService');
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

  const userId = req.user?.id;
  if (!userId) {
    logger.warn('[filterModelSpecs] No user ID found, returning unchanged');
    return modelSpecs;
  }

  logger.debug(`[filterModelSpecs] Filtering ${modelSpecs.list.length} ModelSpecs for user ${userId}`);

  // Get agent IDs the user has VIEW access to via ACL
  const accessibleAgentIds = await findAccessibleResources({
    userId,
    role: req.user.role,
    resourceType: ResourceType.AGENT,
    requiredPermissions: PermissionBits.VIEW,
  });

  logger.debug(`[filterModelSpecs] User ${userId} has VIEW access to ${accessibleAgentIds.length} agents`);

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
    const hasAccess = accessibleAgentIds.some(id => id.toString() === agentId);

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
