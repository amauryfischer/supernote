import { describe, it, expect, vi } from "vitest";
import type { OllamaClient, ChatChunk } from "../../ollama/types.js";
import { runAction } from "../runAction.js";
import type { AIActionChunk } from "../types.js";

function fakeOllama(chunks: string[]): OllamaClient {
  return {
    isAvailable: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    generate: vi.fn(),
    embed: vi.fn(),
    chat: vi.fn().mockImplementation(async function* (): AsyncIterable<ChatChunk> {
      for (const c of chunks) yield { content: c, done: false };
      yield { content: "", done: true };
    }),
  };
}

async function collect(iter: AsyncIterable<AIActionChunk>): Promise<AIActionChunk[]> {
  const out: AIActionChunk[] = [];
  for await (const c of iter) out.push(c);
  return out;
}

describe("runAction", () => {
  it("propage les chunks Ollama en delta puis done", async () => {
    const ollama = fakeOllama(["Hello", " ", "world"]);
    const promptResolver = vi.fn().mockResolvedValue("PROMPT");

    const chunks = await collect(
      runAction(
        {
          actionId: "reformat",
          selection: "raw text",
          context: { noteTitle: "Test" },
        },
        { ollama, promptResolver },
      ),
    );

    expect(chunks).toEqual([
      { type: "delta", text: "Hello" },
      { type: "delta", text: " " },
      { type: "delta", text: "world" },
      { type: "done" },
    ]);
    expect(promptResolver).toHaveBeenCalledWith("reformat");
  });

  it("résout le template avec selection + context", async () => {
    const ollama = fakeOllama(["x"]);
    const promptResolver = vi
      .fn()
      .mockResolvedValue("S={{selection}} T={{noteTitle}} P={{parentBlock}}");

    await collect(
      runAction(
        {
          actionId: "reformat",
          selection: "ma sélection",
          context: { noteTitle: "Note A", parentBlock: "Bloc parent" },
        },
        { ollama, promptResolver },
      ),
    );

    const callArg = (ollama.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMsg = callArg.messages.find((m: { role: string }) => m.role === "user");
    expect(userMsg.content).toBe("S=ma sélection T=Note A P=Bloc parent");
  });

  it("inclut le system prompt", async () => {
    const ollama = fakeOllama(["x"]);
    const promptResolver = vi.fn().mockResolvedValue("USER PROMPT");

    await collect(
      runAction(
        { actionId: "reformat", selection: "s", context: {} },
        { ollama, promptResolver },
      ),
    );

    const callArg = (ollama.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const sys = callArg.messages.find((m: { role: string }) => m.role === "system");
    expect(sys).toBeDefined();
    expect(sys.content.length).toBeGreaterThan(20);
  });

  it("strip les fences markdown ``` autour de la réponse", async () => {
    const ollama = fakeOllama(["```\n", "résultat\n", "```"]);
    const promptResolver = vi.fn().mockResolvedValue("PROMPT");

    const chunks = await collect(
      runAction(
        { actionId: "reformat", selection: "s", context: {} },
        { ollama, promptResolver },
      ),
    );

    const text = chunks
      .filter((c): c is { type: "delta"; text: string } => c.type === "delta")
      .map((c) => c.text)
      .join("");
    expect(text).toBe("résultat\n");
  });

  it("émet error si Ollama throw", async () => {
    const ollama: OllamaClient = {
      isAvailable: vi.fn().mockResolvedValue(true),
      listModels: vi.fn(),
      generate: vi.fn(),
      embed: vi.fn(),
      chat: vi.fn().mockImplementation(async function* () {
        throw new Error("connection refused");
      }),
    };
    const promptResolver = vi.fn().mockResolvedValue("PROMPT");

    const chunks = await collect(
      runAction(
        { actionId: "reformat", selection: "s", context: {} },
        { ollama, promptResolver },
      ),
    );

    expect(chunks.at(-1)).toMatchObject({ type: "error" });
  });
});
