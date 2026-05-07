// ============================================================
// Host — permission gate
// ============================================================

import type { PluginPermission } from "../manifest/types.js";

/** Maps API method prefixes to required permissions */
const METHOD_PERMISSION_MAP: Record<string, PluginPermission> = {
  "entities.list": "entities:read",
  "entities.get": "entities:read",
  "entities.create": "entities:write",
  "entities.update": "entities:write",
  "entities.delete": "entities:write",
  "schemas.list": "entities:read",
  "schemas.get": "entities:read",
  "search.query": "entities:read",
  "storage.get": "entities:read",
  "storage.set": "entities:write",
  "ui.registerBlock": "commands:register",
  "ui.registerSlashItem": "commands:register",
  "ui.registerCommand": "commands:register",
  "ui.showNotification": "notifications:show",
  "ui.addSidebarPanel": "commands:register",
  "fs.read": "fs:read",
  "fs.write": "fs:write",
  "network.fetch": "network:fetch",
  "hooks.on": "entities:read",
};

export interface PermissionCheckResult {
  readonly allowed: boolean;
  readonly requiredPermission?: PluginPermission;
}

/**
 * Checks whether a plugin with the given permissions is allowed
 * to call the specified method.
 */
export function checkPermission(
  method: string,
  grantedPermissions: PluginPermission[]
): PermissionCheckResult {
  const required = METHOD_PERMISSION_MAP[method];

  if (required === undefined) {
    // Unknown method — deny by default
    return { allowed: false, requiredPermission: undefined };
  }

  const allowed = grantedPermissions.includes(required);
  return { allowed, requiredPermission: required };
}

/**
 * Returns the required permission for a method, or undefined if the
 * method is not mapped.
 */
export function getRequiredPermission(
  method: string
): PluginPermission | undefined {
  return METHOD_PERMISSION_MAP[method];
}
