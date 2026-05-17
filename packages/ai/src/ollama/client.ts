// ============================================================
// Ollama HTTP client — raw fetch, no external SDK dependency
// ============================================================

import type {
  OllamaClient,
  OllamaClientOptions,
  OllamaModel,
  GenerateOptions,
  ChatOptions,
  ChatChunk,
} from "./types.js";
import { PREFERRED_MODELS } from "./types.js";
import type { Logger } from "pino";
import pino from "pino";

const DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 30_000;

interface OllamaTagsResponse {
  models: Array<{
    name: string;
    size: number;
    digest: string;
    modified_at: string;
    details?: Record<string, unknown>;
  }>;
}

interface OllamaGenerateResponse {
  response: string;
  done: boolean;
}

interface OllamaEmbedResponse {
  embedding: number[];
}

interface OllamaChatResponseChunk {
  message?: {
    content: string;
    tool_calls?: Array<{
      function: { name: string; arguments: Record<string, unknown> };
    }>;
  };
  done: boolean;
}

function buildLogger(parent?: Logger): Logger {
  return parent
    ? parent.child({ module: "ollama-client" })
    : pino({ name: "ai:ollama" });
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

class OllamaClientImpl implements OllamaClient {
  private readonly baseUrl: string;
  private readonly logger: Logger;
  private resolvedModel: string | null = null;
  private readonly preferredModel: string | undefined;

  constructor(opts: OllamaClientOptions) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.logger = buildLogger(opts.logger);
    this.preferredModel = opts.defaultModel;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: "GET" },
        5_000,
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<OllamaModel[]> {
    const res = await fetchWithTimeout(`${this.baseUrl}/api/tags`, {
      method: "GET",
    });
    if (!res.ok) throw new Error(`Ollama listModels failed: ${res.status}`);
    const data = (await res.json()) as OllamaTagsResponse;
    return (data.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      digest: m.digest,
      modifiedAt: m.modified_at,
      details: m.details,
    }));
  }

  private async resolveModel(): Promise<string> {
    if (this.resolvedModel) return this.resolvedModel;
    if (this.preferredModel) {
      this.resolvedModel = this.preferredModel;
      return this.resolvedModel;
    }
    try {
      const models = await this.listModels();
      const names = models.map((m) => m.name);
      for (const preferred of PREFERRED_MODELS) {
        if (names.some((n) => n.startsWith(preferred.split(":")[0] ?? ""))) {
          const found = names.find((n) =>
            n.startsWith(preferred.split(":")[0] ?? ""),
          );
          if (found) {
            this.resolvedModel = found;
            this.logger.info({ model: found }, "Auto-selected Ollama model");
            return found;
          }
        }
      }
      const fallback = names[0];
      if (!fallback) throw new Error("No Ollama models available");
      this.resolvedModel = fallback;
      this.logger.warn({ model: fallback }, "Using fallback Ollama model");
      return fallback;
    } catch (err) {
      this.logger.error({ err }, "Failed to resolve Ollama model");
      throw err;
    }
  }

  async generate(opts: GenerateOptions): Promise<string> {
    const model = opts.model ?? (await this.resolveModel());
    const body: Record<string, unknown> = {
      model,
      prompt: opts.prompt,
      stream: false,
    };
    if (opts.system) body["system"] = opts.system;
    if (opts.format) body["format"] = opts.format;
    if (opts.temperature !== undefined) {
      body["options"] = { temperature: opts.temperature };
    }

    this.logger.debug({ model, promptLength: opts.prompt.length }, "generate");
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      throw new Error(`Ollama generate failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as OllamaGenerateResponse;
    return data.response;
  }

  async embed(text: string, model?: string): Promise<Float32Array> {
    const resolvedModel = model ?? (await this.resolveModel());
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/embeddings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: resolvedModel, prompt: text }),
      },
    );
    if (!res.ok) {
      throw new Error(`Ollama embed failed: ${res.status}`);
    }
    const data = (await res.json()) as OllamaEmbedResponse;
    return new Float32Array(data.embedding);
  }

  async *chat(opts: ChatOptions): AsyncIterable<ChatChunk> {
    const model = opts.model ?? (await this.resolveModel());
    // When `tools` is set we disable streaming. Ollama only emits
    // tool_calls in a single final chunk and many model backends refuse
    // tool calls in streaming mode altogether — non-streamed responses
    // are the only reliable shape today.
    const hasTools = Array.isArray(opts.tools) && opts.tools.length > 0;
    const stream = !hasTools;
    const body: Record<string, unknown> = {
      model,
      messages: opts.messages,
      stream,
    };
    if (hasTools) body["tools"] = opts.tools;
    if (opts.format) body["format"] = opts.format;
    if (opts.temperature !== undefined) {
      body["options"] = { temperature: opts.temperature };
    }

    // Tool-call turns can take much longer than plain chat (non-streamed,
    // larger context). Give those calls a generous budget; streaming calls
    // keep the default.
    const timeoutMs = hasTools ? 120_000 : DEFAULT_TIMEOUT_MS;
    const res = await fetchWithTimeout(
      `${this.baseUrl}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
    if (!res.ok || !res.body) {
      throw new Error(`Ollama chat failed: ${res.status}`);
    }

    // Non-streamed path (tool calling): single JSON body.
    if (!stream) {
      const data = (await res.json()) as OllamaChatResponseChunk;
      const toolCalls = data.message?.tool_calls?.map((c) => ({
        function: { name: c.function.name, arguments: c.function.arguments },
      }));
      yield {
        content: data.message?.content ?? "",
        done: true,
        ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const chunk = JSON.parse(trimmed) as OllamaChatResponseChunk;
          const toolCalls = chunk.message?.tool_calls?.map((c) => ({
            function: { name: c.function.name, arguments: c.function.arguments },
          }));
          yield {
            content: chunk.message?.content ?? "",
            done: chunk.done,
            ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          };
          if (chunk.done) return;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export function createOllamaClient(opts: OllamaClientOptions = {}): OllamaClient {
  return new OllamaClientImpl(opts);
}
