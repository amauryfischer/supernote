export { PluginHost, type ApiHandler, type PluginHostOptions } from "./plugin-host.js";
export { HostChannel, PluginCallError, type HostChannelOptions } from "./channel.js";
export { checkPermission, getRequiredPermission } from "./permissions.js";
export { generateBootstrap, generateSrcdoc } from "./bootstrap.js";
export type {
  LoadedPlugin,
  HostEvent,
  HostEventType,
  HostEventListener,
  PluginLoadedEvent,
  PluginErrorEvent,
  PermissionDeniedEvent,
  MessagePort,
} from "./types.js";
