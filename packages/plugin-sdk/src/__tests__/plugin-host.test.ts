import { describe, it, expect, vi, afterEach } from "vitest";
import { PluginHost } from "../host/plugin-host.js";
import { PluginCallError } from "../host/channel.js";
import { createMockChannel } from "./helpers/message-channel-mock.js";
import { createResponse, createError } from "../protocol/factory.js";
import type { PluginManifest } from "../manifest/types.js";
import type { RequestEnvelope } from "../protocol/types.js";
import type { MessagePort } from "../host/types.js";

const baseManifest: PluginManifest = {
  id: "com.test.plugin",
  name: "Test Plugin",
  version: "1.0.0",
  entry: "index.js",
  permissions: ["entities:read"],
};

function createHostWithMockPort() {
  let pluginPort: MessagePort | undefined;

  const host = new PluginHost({
    apiHandler: async (_pluginId, method, args) => {
      if (method === "entities.list") return [{ id: "1", name: "Note" }];
      if (method === "entities.get") return { id: "1", name: "Note" };
      throw new Error(`Unhandled: ${method}`);
    },
    createChannel: (_manifest) => {
      const { hostPort, pluginPort: pp } = createMockChannel();
      pluginPort = pp;
      return hostPort;
    },
  });

  return { host, getPluginPort: () => pluginPort! };
}

describe("PluginHost", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loadPlugin returns a LoadedPlugin with correct id", async () => {
    const { host } = createHostWithMockPort();
    const loaded = await host.loadPlugin(baseManifest, "// plugin code");
    expect(loaded.id).toBe("com.test.plugin");
    expect(loaded.manifest).toBe(baseManifest);
    await host.unloadPlugin("com.test.plugin");
  });

  it("emits plugin-loaded event after successful load", async () => {
    const { host } = createHostWithMockPort();
    const listener = vi.fn();
    host.on("plugin-loaded", listener);

    await host.loadPlugin(baseManifest, "");
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      type: "plugin-loaded",
      plugin: { id: "com.test.plugin" },
    });

    await host.unloadPlugin("com.test.plugin");
  });

  it("throws if loading the same plugin twice", async () => {
    const { host } = createHostWithMockPort();
    await host.loadPlugin(baseManifest, "");
    await expect(host.loadPlugin(baseManifest, "")).rejects.toThrow(
      /already loaded/i
    );
    await host.unloadPlugin("com.test.plugin");
  });

  it("unloadPlugin removes plugin from loaded list", async () => {
    const { host } = createHostWithMockPort();
    await host.loadPlugin(baseManifest, "");
    expect(host.loadedPlugins).toHaveLength(1);
    await host.unloadPlugin("com.test.plugin");
    expect(host.loadedPlugins).toHaveLength(0);
  });

  it("unloadPlugin throws if plugin is not loaded", async () => {
    const { host } = createHostWithMockPort();
    await expect(host.unloadPlugin("com.nonexistent")).rejects.toThrow(
      /not loaded/i
    );
  });

  it("rejects invalid manifest on loadPlugin", async () => {
    const { host } = createHostWithMockPort();
    await expect(
      host.loadPlugin({ ...baseManifest, id: "bad_id" }, "")
    ).rejects.toThrow(/Invalid manifest/);
  });

  it("permission-denied event is emitted when plugin calls unauthorized method", async () => {
    const { host, getPluginPort } = createHostWithMockPort();
    const listener = vi.fn();
    host.on("permission-denied", listener);

    await host.loadPlugin(baseManifest, ""); // only has entities:read
    const pluginPort = getPluginPort();

    // Simulate plugin calling entities.create (requires entities:write)
    const fakeReq: RequestEnvelope = {
      protocolVersion: "1.0",
      id: "req-1",
      type: "request",
      payload: { method: "entities.create", args: {} },
      timestamp: Date.now(),
    };
    pluginPort.postMessage(fakeReq);

    await new Promise((r) => setTimeout(r, 50));
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      type: "permission-denied",
      pluginId: "com.test.plugin",
      method: "entities.create",
    });

    await host.unloadPlugin("com.test.plugin");
  });

  it("host.call throws PluginCallError for unauthorized method", async () => {
    const { host } = createHostWithMockPort();
    await host.loadPlugin(baseManifest, ""); // only entities:read

    await expect(
      host.call("com.test.plugin", "entities.create", {})
    ).rejects.toBeInstanceOf(PluginCallError);

    await host.unloadPlugin("com.test.plugin");
  });

  it("host.call throws PLUGIN_NOT_FOUND for unknown plugin", async () => {
    const { host } = createHostWithMockPort();
    await expect(
      host.call("com.nonexistent", "entities.list", {})
    ).rejects.toMatchObject({ code: "PLUGIN_NOT_FOUND" });
  });

  it("loadedPlugins returns all currently loaded plugins", async () => {
    const manifest2: PluginManifest = {
      ...baseManifest,
      id: "com.test.plugin2",
      name: "Plugin 2",
    };

    const { host } = createHostWithMockPort();
    await host.loadPlugin(baseManifest, "");
    await host.loadPlugin(manifest2, "");

    expect(host.loadedPlugins).toHaveLength(2);
    const ids = host.loadedPlugins.map((p) => p.id);
    expect(ids).toContain("com.test.plugin");
    expect(ids).toContain("com.test.plugin2");

    await host.unloadPlugin("com.test.plugin");
    await host.unloadPlugin("com.test.plugin2");
  });
});
