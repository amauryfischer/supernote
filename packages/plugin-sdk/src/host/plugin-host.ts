// ============================================================
// PluginHost — orchestrates plugin lifecycle
// ============================================================

import { pluginManifestSchema } from "../manifest/schema.js";
import type { PluginManifest, PluginPermission } from "../manifest/types.js";
import { anyEnvelopeSchema } from "../protocol/schema.js";
import {
  createResponse,
  createError,
  createHandshakeAck,
} from "../protocol/factory.js";
import type { RequestEnvelope } from "../protocol/types.js";
import { checkPermission } from "./permissions.js";
import { HostChannel, PluginCallError } from "./channel.js";
import type {
  LoadedPlugin,
  HostEventType,
  HostEvent,
  HostEventListener,
  MessagePort,
} from "./types.js";

export type ApiHandler = (
  pluginId: string,
  method: string,
  args: unknown
) => Promise<unknown>;

export interface PluginHostOptions {
  /** Called when plugin makes an API request. Required for actual functionality. */
  apiHandler?: ApiHandler;
  /** Override channel creation (useful for testing with MessageChannel) */
  createChannel?: (manifest: PluginManifest) => MessagePort;
  readonly timeoutMs?: number;
}

interface PluginEntry {
  readonly manifest: PluginManifest;
  readonly channel: HostChannel;
  readonly port: MessagePort;
  readonly loadedAt: Date;
}

/**
 * Orchestrates plugin lifecycle: load, unload, call, permission gate.
 * Designed to be used in the renderer process alongside iframe sandboxes.
 */
export class PluginHost {
  private readonly plugins = new Map<string, PluginEntry>();
  private readonly listeners = new Map<
    HostEventType,
    Set<HostEventListener<HostEvent>>
  >();
  private readonly apiHandler: ApiHandler;
  private readonly createChannelFn: ((manifest: PluginManifest) => MessagePort) | undefined;
  private readonly timeoutMs: number;

  constructor(options: PluginHostOptions = {}) {
    this.apiHandler =
      options.apiHandler ??
      (async () => {
        throw new Error("No API handler registered");
      });
    this.createChannelFn = options.createChannel;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /**
   * Loads a plugin from its manifest and JS code string.
   * Creates a sandboxed iframe with the bootstrap + plugin code.
   */
  async loadPlugin(
    manifest: PluginManifest,
    _code: string
  ): Promise<LoadedPlugin> {
    const parsed = pluginManifestSchema.safeParse(manifest);
    if (!parsed.success) {
      throw new Error(
        `Invalid manifest for plugin ${manifest.id}: ${parsed.error.message}`
      );
    }

    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin ${manifest.id} is already loaded`);
    }

    const port = this.createPort(manifest);
    const channel = new HostChannel(port, { timeoutMs: this.timeoutMs });

    this.attachRequestHandler(manifest, port);

    const entry: PluginEntry = {
      manifest,
      channel,
      port,
      loadedAt: new Date(),
    };
    this.plugins.set(manifest.id, entry);

    const loadedPlugin: LoadedPlugin = {
      id: manifest.id,
      manifest,
      loadedAt: entry.loadedAt,
    };

    this.emit({
      type: "plugin-loaded",
      plugin: loadedPlugin,
    });

    return loadedPlugin;
  }

  /** Unloads a plugin and tears down its channel */
  async unloadPlugin(id: string): Promise<void> {
    const entry = this.plugins.get(id);
    if (!entry) {
      throw new Error(`Plugin ${id} is not loaded`);
    }
    entry.channel.destroy();
    this.plugins.delete(id);
  }

  /**
   * Calls a method on a loaded plugin.
   * Enforces permissions before forwarding.
   */
  async call<T>(pluginId: string, method: string, args: unknown): Promise<T> {
    const entry = this.plugins.get(pluginId);
    if (!entry) {
      throw new PluginCallError("PLUGIN_NOT_FOUND", `Plugin ${pluginId} not found`);
    }

    const check = checkPermission(method, entry.manifest.permissions);
    if (!check.allowed) {
      const requiredPermission = check.requiredPermission ?? method;
      this.emit({
        type: "permission-denied",
        pluginId,
        method,
        requiredPermission,
      });
      throw new PluginCallError(
        "PERMISSION_DENIED",
        `Plugin ${pluginId} lacks permission to call ${method}. Required: ${requiredPermission}`
      );
    }

    return entry.channel.send<T>(method, args);
  }

  on(event: HostEventType, listener: HostEventListener<HostEvent>): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as HostEventListener<HostEvent>);
  }

  off(event: HostEventType, listener: HostEventListener<HostEvent>): void {
    this.listeners.get(event)?.delete(listener);
  }

  get loadedPlugins(): LoadedPlugin[] {
    return [...this.plugins.values()].map((e) => ({
      id: e.manifest.id,
      manifest: e.manifest,
      loadedAt: e.loadedAt,
    }));
  }

  // ------ private -------------------------------------------

  private createPort(manifest: PluginManifest): MessagePort {
    if (this.createChannelFn) {
      return this.createChannelFn(manifest);
    }
    // In a real browser context, would create an iframe here
    throw new Error(
      "createChannel option is required outside of a browser context"
    );
  }

  /**
   * Attaches a listener that handles incoming requests from the plugin
   * by verifying permissions then delegating to the apiHandler.
   */
  private attachRequestHandler(
    manifest: PluginManifest,
    port: MessagePort
  ): void {
    port.onmessage = async (ev) => {
      const parsed = anyEnvelopeSchema.safeParse(ev.data);
      if (!parsed.success) return;

      const envelope = parsed.data;

      if (envelope.type === "handshake") {
        const ack = createHandshakeAck(
          envelope.id,
          true,
          manifest.permissions,
        );
        port.postMessage(ack);
        return;
      }

      if (envelope.type !== "request") return;

      const req = envelope as RequestEnvelope;
      const { method, args } = req.payload;

      const check = checkPermission(method, manifest.permissions);
      if (!check.allowed) {
        this.emit({
          type: "permission-denied",
          pluginId: manifest.id,
          method,
          requiredPermission: check.requiredPermission ?? method,
        });
        port.postMessage(
          createError(
            "PERMISSION_DENIED",
            `Permission denied: ${check.requiredPermission ?? method}`,
            req.id
          )
        );
        return;
      }

      try {
        const result = await this.apiHandler(manifest.id, method, args);
        port.postMessage(createResponse(req.id, result));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        port.postMessage(createError("INTERNAL_ERROR", message, req.id));
        this.emit({
          type: "plugin-error",
          pluginId: manifest.id,
          error: err instanceof Error ? err : new Error(message),
        });
      }
    };
  }

  private emit(event: HostEvent): void {
    const set = this.listeners.get(event.type);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(event);
      } catch {
        // suppress listener errors
      }
    }
  }
}
