import { describe, it, expect, vi } from "vitest";
import { PluginHost } from "../host/plugin-host.js";
import { createMockChannel } from "./helpers/message-channel-mock.js";
import { anyEnvelopeSchema } from "../protocol/schema.js";
import type { PluginManifest } from "../manifest/types.js";
import type { RequestEnvelope, ResponseEnvelope, ErrorEnvelope } from "../protocol/types.js";
import type { MessagePort } from "../host/types.js";

const manifest: PluginManifest = {
  id: "com.test.handler",
  name: "Handler Test",
  version: "1.0.0",
  entry: "index.js",
  permissions: ["entities:read", "entities:write", "notifications:show"],
};

function setup(apiHandler: (pluginId: string, method: string, args: unknown) => Promise<unknown>) {
  let pluginPort: MessagePort | undefined;

  const host = new PluginHost({
    apiHandler,
    createChannel: () => {
      const { hostPort, pluginPort: pp } = createMockChannel();
      pluginPort = pp;
      return hostPort;
    },
  });

  return { host, getPluginPort: () => pluginPort! };
}

function sendRequest(port: MessagePort, method: string, args: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const req: RequestEnvelope = {
      protocolVersion: "1.0",
      id: `req-${Math.random()}`,
      type: "request",
      payload: { method, args },
      timestamp: Date.now(),
    };

    port.onmessage = (ev) => {
      const parsed = anyEnvelopeSchema.safeParse(ev.data);
      if (parsed.success && parsed.data.correlationId === req.id) {
        resolve(parsed.data);
      }
    };

    port.postMessage(req);
  });
}

describe("Host request handler (from plugin perspective)", () => {
  it("responds with correct data for an allowed API call", async () => {
    const { host, getPluginPort } = setup(async (_pid, method) => {
      if (method === "entities.list") return [{ id: "abc" }];
      throw new Error("unexpected");
    });

    await host.loadPlugin(manifest, "");
    const pluginPort = getPluginPort();

    const response = await sendRequest(pluginPort, "entities.list", {}) as ResponseEnvelope;
    expect(response.type).toBe("response");
    expect(response.payload.result).toEqual([{ id: "abc" }]);

    await host.unloadPlugin(manifest.id);
  });

  it("responds with PERMISSION_DENIED for an unauthorized method", async () => {
    const readOnlyManifest: PluginManifest = {
      ...manifest,
      id: "com.test.readonly",
      permissions: ["entities:read"],
    };

    const { host, getPluginPort } = setup(async () => ({}));
    await host.loadPlugin(readOnlyManifest, "");
    const pluginPort = getPluginPort();

    const response = await sendRequest(pluginPort, "entities.create", { typeId: "note" }) as ErrorEnvelope;
    expect(response.type).toBe("error");
    expect(response.payload.code).toBe("PERMISSION_DENIED");

    await host.unloadPlugin(readOnlyManifest.id);
  });

  it("responds with INTERNAL_ERROR when apiHandler throws", async () => {
    const { host, getPluginPort } = setup(async () => {
      throw new Error("DB connection failed");
    });

    await host.loadPlugin(manifest, "");
    const pluginPort = getPluginPort();

    const response = await sendRequest(pluginPort, "entities.list", {}) as ErrorEnvelope;
    expect(response.type).toBe("error");
    expect(response.payload.code).toBe("INTERNAL_ERROR");
    expect(response.payload.message).toContain("DB connection failed");

    await host.unloadPlugin(manifest.id);
  });

  it("emits plugin-error event when apiHandler throws", async () => {
    const { host, getPluginPort } = setup(async () => {
      throw new Error("Handler crashed");
    });
    const errorListener = vi.fn();
    host.on("plugin-error", errorListener);

    await host.loadPlugin(manifest, "");
    const pluginPort = getPluginPort();

    await sendRequest(pluginPort, "entities.list", {});
    await new Promise((r) => setTimeout(r, 20));

    expect(errorListener).toHaveBeenCalled();

    await host.unloadPlugin(manifest.id);
  });

  it("handles handshake and responds with handshake-ack", async () => {
    const { host, getPluginPort } = setup(async () => ({}));
    await host.loadPlugin(manifest, "");
    const pluginPort = getPluginPort();

    const ackPromise = new Promise<unknown>((resolve) => {
      pluginPort.onmessage = (ev) => {
        const parsed = anyEnvelopeSchema.safeParse(ev.data);
        if (parsed.success && parsed.data.type === "handshake-ack") {
          resolve(parsed.data);
        }
      };
    });

    pluginPort.postMessage({
      protocolVersion: "1.0",
      id: "hs-1",
      type: "handshake",
      payload: { pluginId: manifest.id, protocolVersion: "1.0", permissions: [] },
      timestamp: Date.now(),
    });

    const ack = await ackPromise as { type: string; payload: { accepted: boolean } };
    expect(ack.type).toBe("handshake-ack");
    expect(ack.payload.accepted).toBe(true);

    await host.unloadPlugin(manifest.id);
  });
});
