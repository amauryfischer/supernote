export type {
  PluginManifest,
  PluginPermission,
  PluginHook,
  BlockContribution,
  SlashItem,
  CommandContribution,
  SidebarPanel,
  ViewContribution,
} from "./types.js";

export { PLUGIN_PERMISSIONS } from "./types.js";
export { pluginManifestSchema, type ValidatedPluginManifest } from "./schema.js";
