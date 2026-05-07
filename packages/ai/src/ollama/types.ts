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

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  messages: ChatMessage[];
  format?: "json" | undefined;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatChunk {
  content: string;
  done: boolean;
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
