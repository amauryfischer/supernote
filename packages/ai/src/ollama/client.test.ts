// ============================================================
// OllamaClient tests
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createOllamaClient } from "./client.js";

const BASE_URL = "http://127.0.0.1:11434";

function mockFetch(responses: Array<{ ok: boolean; json?: unknown; text?: string; body?: ReadableStream }>) {
  let callIndex = 0;
  return vi.fn(async () => {
    const response = responses[callIndex % responses.length];
    callIndex++;
    return {
      ok: response?.ok ?? true,
      status: response?.ok ? 200 : 500,
      json: async () => response?.json,
      text: async () => response?.text ?? "",
      body: response?.body ?? null,
    };
  });
}

describe("OllamaClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch([{ ok: true, json: { models: [] } }]));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isAvailable", () => {
    it("returns true when /api/tags responds ok", async () => {
      vi.stubGlobal("fetch", mockFetch([{ ok: true, json: { models: [] } }]));
      const client = createOllamaClient({ baseUrl: BASE_URL });
      const result = await client.isAvailable();
      expect(result).toBe(true);
    });

    it("returns false when server is unreachable", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        }),
      );
      const client = createOllamaClient({ baseUrl: BASE_URL });
      const result = await client.isAvailable();
      expect(result).toBe(false);
    });

    it("returns false when server returns non-ok status", async () => {
      vi.stubGlobal("fetch", mockFetch([{ ok: false }]));
      const client = createOllamaClient({ baseUrl: BASE_URL });
      const result = await client.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe("listModels", () => {
    it("parses model list correctly", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetch([
          {
            ok: true,
            json: {
              models: [
                {
                  name: "llama3.2:3b",
                  size: 1_000_000,
                  digest: "abc123",
                  modified_at: "2024-01-01T00:00:00Z",
                },
              ],
            },
          },
        ]),
      );
      const client = createOllamaClient({ baseUrl: BASE_URL });
      const models = await client.listModels();
      expect(models).toHaveLength(1);
      expect(models[0]?.name).toBe("llama3.2:3b");
      expect(models[0]?.size).toBe(1_000_000);
    });

    it("throws when listModels fails", async () => {
      vi.stubGlobal("fetch", mockFetch([{ ok: false, text: "Internal error" }]));
      const client = createOllamaClient({ baseUrl: BASE_URL });
      await expect(client.listModels()).rejects.toThrow("listModels failed");
    });
  });

  describe("generate", () => {
    it("sends prompt and returns response text", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetch([
          { ok: true, json: { models: [{ name: "llama3.2:3b", size: 1, digest: "d", modified_at: "2024-01-01" }] } },
          { ok: true, json: { response: "Hello world", done: true } },
        ]),
      );
      const client = createOllamaClient({ baseUrl: BASE_URL });
      const result = await client.generate({ prompt: "Say hello" });
      expect(result).toBe("Hello world");
    });

    it("uses specified model when provided", async () => {
      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        if (url.includes("/api/generate")) {
          const body = JSON.parse(init.body as string) as { model: string };
          expect(body.model).toBe("phi3:mini");
        }
        return { ok: true, json: async () => ({ response: "ok", done: true }), text: async () => "" };
      });
      vi.stubGlobal("fetch", fetchMock);
      const client = createOllamaClient({ baseUrl: BASE_URL, defaultModel: "phi3:mini" });
      await client.generate({ prompt: "test", model: "phi3:mini" });
    });

    it("throws when generate fails", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetch([
          { ok: true, json: { models: [{ name: "llama3.2:3b", size: 1, digest: "d", modified_at: "2024-01-01" }] } },
          { ok: false, text: "model error" },
        ]),
      );
      const client = createOllamaClient({ baseUrl: BASE_URL });
      await expect(client.generate({ prompt: "test" })).rejects.toThrow();
    });
  });

  describe("embed", () => {
    it("returns Float32Array of embeddings", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetch([
          { ok: true, json: { models: [{ name: "llama3.2:3b", size: 1, digest: "d", modified_at: "2024-01-01" }] } },
          { ok: true, json: { embedding: [0.1, 0.2, 0.3] } },
        ]),
      );
      const client = createOllamaClient({ baseUrl: BASE_URL });
      const embedding = await client.embed("hello world");
      expect(embedding).toBeInstanceOf(Float32Array);
      expect(embedding).toHaveLength(3);
      expect(embedding[0]).toBeCloseTo(0.1);
    });

    it("uses custom model for embedding when provided", async () => {
      const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
        if (url.includes("/api/embeddings")) {
          const body = JSON.parse(init.body as string) as { model: string };
          expect(body.model).toBe("nomic-embed-text");
        }
        return { ok: true, json: async () => ({ embedding: [0.5] }), text: async () => "" };
      });
      vi.stubGlobal("fetch", fetchMock);
      const client = createOllamaClient({ baseUrl: BASE_URL, defaultModel: "llama3.2:3b" });
      const result = await client.embed("test text", "nomic-embed-text");
      expect(result).toBeInstanceOf(Float32Array);
    });
  });

  describe("chat (streaming)", () => {
    it("yields chat chunks from streaming response", async () => {
      const chunks = [
        JSON.stringify({ message: { content: "Hello" }, done: false }),
        JSON.stringify({ message: { content: " world" }, done: false }),
        JSON.stringify({ message: { content: "" }, done: true }),
      ].join("\n");

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(chunks));
          controller.close();
        },
      });

      vi.stubGlobal(
        "fetch",
        mockFetch([
          { ok: true, json: { models: [{ name: "llama3.2:3b", size: 1, digest: "d", modified_at: "2024-01-01" }] } },
          { ok: true, body: stream },
        ]),
      );

      const client = createOllamaClient({ baseUrl: BASE_URL });
      const collected: string[] = [];

      for await (const chunk of client.chat({
        messages: [{ role: "user", content: "Hi" }],
      })) {
        collected.push(chunk.content);
        if (chunk.done) break;
      }

      expect(collected.join("")).toContain("Hello");
    });
  });
});
