import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createHttpServer } from "../http/server.js";
import { createMockResolvers, MOCK_ENTITY } from "./mock-resolvers.js";
import type { VaultEvent } from "../types.js";

function wsUrl(httpUrl: string, token: string): string {
  return httpUrl.replace("http://", "ws://") + `/api/v1/events?token=${token}`;
}

function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function receiveMessage(ws: WebSocket, timeoutMs = 1000): Promise<VaultEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WS message timeout")), timeoutMs);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(data)) as VaultEvent);
    });
  });
}

describe("WebSocket /api/v1/events", () => {
  let url: string;
  let token: string;
  let server: ReturnType<typeof createHttpServer>;

  beforeEach(async () => {
    server = createHttpServer({ resolvers: createMockResolvers(), port: 0 });
    ({ url, token } = await server.start());
  });

  afterEach(async () => {
    await server.stop();
  });

  it("rejects WS connection without token", async () => {
    const wsRawUrl = url.replace("http://", "ws://") + "/api/v1/events";
    const ws = new WebSocket(wsRawUrl);
    await new Promise<void>((resolve) => {
      ws.once("close", () => resolve());
      ws.once("error", () => resolve());
    });
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("rejects WS connection with wrong token", async () => {
    const badUrl = wsUrl(url, "wrong-token");
    const ws = new WebSocket(badUrl);
    await new Promise<void>((resolve) => {
      ws.once("close", () => resolve());
      ws.once("error", () => resolve());
    });
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("accepts WS connection with correct token", async () => {
    const ws = await connectWs(wsUrl(url, token));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("receives entity.created event after POST", async () => {
    const ws = await connectWs(wsUrl(url, token));
    const msgPromise = receiveMessage(ws);

    await fetch(`${url}/api/v1/entities`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ typeId: "contact", fields: { name: "Test" }, body: "" }),
    });

    const event = await msgPromise;
    expect(event.kind).toBe("entity.created");
    ws.close();
  });

  it("receives entity.updated event after PATCH", async () => {
    const ws = await connectWs(wsUrl(url, token));
    const msgPromise = receiveMessage(ws);

    await fetch(`${url}/api/v1/entities/${MOCK_ENTITY.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Updated" }),
    });

    const event = await msgPromise;
    expect(event.kind).toBe("entity.updated");
    ws.close();
  });

  it("receives entity.deleted event after DELETE", async () => {
    const ws = await connectWs(wsUrl(url, token));
    const msgPromise = receiveMessage(ws);

    await fetch(`${url}/api/v1/entities/${MOCK_ENTITY.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    const event = await msgPromise;
    expect(event.kind).toBe("entity.deleted");
    ws.close();
  });

  it("event has correct timestamp format", async () => {
    const ws = await connectWs(wsUrl(url, token));
    const msgPromise = receiveMessage(ws);

    server.publish({ kind: "entity.created", entityId: "test-1", payload: {}, timestamp: new Date().toISOString() });

    const event = await msgPromise;
    expect(typeof event.timestamp).toBe("string");
    expect(new Date(event.timestamp).getTime()).toBeGreaterThan(0);
    ws.close();
  });
});
