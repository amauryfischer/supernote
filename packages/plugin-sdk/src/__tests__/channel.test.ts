import { describe, it, expect, vi, afterEach } from "vitest";
import { HostChannel, PluginCallError } from "../host/channel.js";
import { createResponse, createError } from "../protocol/factory.js";
import { createMockChannel } from "./helpers/message-channel-mock.js";
import type { RequestEnvelope } from "../protocol/types.js";

describe("HostChannel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trip: sends a request and receives a correlated response", async () => {
    const { hostPort, pluginPort } = createMockChannel();

    // Plugin side: echo back the request as a response
    pluginPort.onmessage = (ev) => {
      const req = ev.data as RequestEnvelope;
      if (req.type !== "request") return;
      pluginPort.postMessage(createResponse(req.id, { echo: req.payload.args }));
    };

    const channel = new HostChannel(hostPort);
    const result = await channel.send("test.echo", { hello: "world" });

    expect(result).toEqual({ echo: { hello: "world" } });
    channel.destroy();
  });

  it("rejects with PluginCallError when plugin returns an error", async () => {
    const { hostPort, pluginPort } = createMockChannel();

    pluginPort.onmessage = (ev) => {
      const req = ev.data as RequestEnvelope;
      if (req.type !== "request") return;
      pluginPort.postMessage(
        createError("PERMISSION_DENIED", "Access denied", req.id)
      );
    };

    const channel = new HostChannel(hostPort);
    await expect(channel.send("denied.method", {})).rejects.toBeInstanceOf(
      PluginCallError
    );
    channel.destroy();
  });

  it("rejects with timeout error if no response arrives", async () => {
    const { hostPort } = createMockChannel();
    // Plugin side does nothing

    const channel = new HostChannel(hostPort, { timeoutMs: 50 });
    await expect(channel.send("no.response", {})).rejects.toThrow(/timed out/i);
    channel.destroy();
  });

  it("handles multiple concurrent calls with correct correlation", async () => {
    const { hostPort, pluginPort } = createMockChannel();

    pluginPort.onmessage = (ev) => {
      const req = ev.data as RequestEnvelope;
      if (req.type !== "request") return;
      const result = req.payload.method === "a" ? "result-a" : "result-b";
      pluginPort.postMessage(createResponse(req.id, result));
    };

    const channel = new HostChannel(hostPort);
    const [a, b] = await Promise.all([
      channel.send<string>("a", {}),
      channel.send<string>("b", {}),
    ]);

    expect(a).toBe("result-a");
    expect(b).toBe("result-b");
    channel.destroy();
  });

  it("destroy clears all pending calls with errors", async () => {
    const { hostPort } = createMockChannel();
    const channel = new HostChannel(hostPort, { timeoutMs: 30_000 });

    const promise = channel.send("will.never.resolve", {});
    channel.destroy();

    await expect(promise).rejects.toThrow(/destroyed/i);
  });

  it("ignores malformed messages", async () => {
    const { hostPort, pluginPort } = createMockChannel();

    const channel = new HostChannel(hostPort);
    // Send garbage — should not throw
    pluginPort.postMessage({ not: "valid" });
    pluginPort.postMessage(null);
    pluginPort.postMessage("raw string");

    // Give a moment for message processing
    await new Promise((r) => setTimeout(r, 10));
    expect(channel.pendingCount).toBe(0);
    channel.destroy();
  });
});
