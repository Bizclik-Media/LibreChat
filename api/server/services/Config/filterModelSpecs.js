const { checkAccess } = require('@librechat/api');
const { PermissionTypes, Permissions, isAgentsEndpoint } = require('librechat-data-provider');
const { getRoleByName } = require('~/models/Role');

/**
 * Filter ModelSpecs based on user's agent permissions
 * @param {Express.Request} req - The Express request object
 * @param {TCustomConfig['modelSpecs']} modelSpecs - The model specs configuration
 * @returns {Promise<TCustomConfig['modelSpecs']>} Filtered model specs
 */
async function filterModelSpecsByPermissions(req, modelSpecs) {
  if (!modelSpecs?.list) {
    return modelSpecs;
  }

  // Check if user has agent permissions
  const hasAgentAccess = await checkAccess({
    req,
    user: req.user,
    permissionType: PermissionTypes.AGENTS,
    permissions: [Permissions.USE],
    getRoleByName,
  });

  // If no agent access, filter out agent-based ModelSpecs
  if (!hasAgentAccess) {
    const filteredList = modelSpecs.list.filter(spec => 
      !isAgentsEndpoint(spec.preset.endpoint)
    );
    
    return {
      ...modelSpecs,
      list: filteredList,
    };
  }

  return modelSpecs;
}

module.exports = { filterModelSpecsByPermissions };
