// ============================================================
// Host — public types
// ============================================================

import type { PluginManifest } from "../manifest/types.js";

export interface LoadedPlugin {
  readonly id: string;
  readonly manifest: PluginManifest;
  readonly loadedAt: Date;
}

export type HostEventType = "plugin-loaded" | "plugin-error" | "permission-denied";

export interface PluginLoadedEvent {
  readonly type: "plugin-loaded";
  readonly plugin: LoadedPlugin;
}

export interface PluginErrorEvent {
  readonly type: "plugin-error";
  readonly pluginId: string;
  readonly error: Error;
}

export interface PermissionDeniedEvent {
  readonly type: "permission-denied";
  readonly pluginId: string;
  readonly method: string;
  readonly requiredPermission: string;
}

export type HostEvent =
  | PluginLoadedEvent
  | PluginErrorEvent
  | PermissionDeniedEvent;

export type HostEventListener<E extends HostEvent = HostEvent> = (
  event: E
) => void;

/** Abstraction over postMessage channel (iframe or MessageChannel) */
export interface MessagePort {
  postMessage(data: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}
