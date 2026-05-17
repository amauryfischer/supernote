// ============================================================
// Ollama client type definitions
// ============================================================

import type { Logger } from "pino";

export type { Logger };

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
  details?: Record<string, unknown>;
}

export interface GenerateOptions {
  model?: string;
  prompt: string;
  system?: string;
  format?: "json" | undefined;
  temperature?: number;
  maxTokens?: number;
  stream?: false;
}

/**
 * JSON-schema-like parameter spec for a tool. Sent verbatim to Ollama's
 * `/api/chat` `tools[].function.parameters` field — Ollama forwards it to
 * the underlying model's tool-calling grammar.
 */
export interface ToolParametersSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  [extra: string]: unknown;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolParametersSchema;
  };
}

export interface ToolCall {
  /** Ollama does not currently emit an id; the agent assigns one. */
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present on assistant messages that requested tool execution. */
  tool_calls?: ToolCall[];
  /** Present on `role: "tool"` messages — the call this is a result for. */
  tool_call_id?: string;
  /** Optional name of the tool whose output this message carries. */
  name?: string;
}

export interface ChatOptions {
  model?: string;
  messages: ChatMessage[];
  format?: "json" | undefined;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
}

export interface ChatChunk {
  content: string;
  done: boolean;
  /**
   * Ollama emits tool_calls in the final (done) chunk when the model
   * decided to call tools instead of returning content. Agent loop reads
   * this to dispatch tools and continue.
   */
  tool_calls?: ToolCall[];
}

export interface OllamaClient {
  isAvailable(): Promise<boolean>;
  listModels(): Promise<OllamaModel[]>;
  generate(opts: GenerateOptions): Promise<string>;
  embed(text: string, model?: string): Promise<Float32Array>;
  chat(opts: ChatOptions): AsyncIterable<ChatChunk>;
}

export interface OllamaClientOptions {
  baseUrl?: string;
  defaultModel?: string;
  logger?: Logger;
}

/** Ordered list of preferred fast models for tagging */
export const PREFERRED_MODELS = [
  "llama3.2:3b",
  "qwen2.5:3b",
  "phi3:mini",
] as const;
