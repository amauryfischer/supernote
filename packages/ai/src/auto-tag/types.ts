// ============================================================
// Auto-tagger type definitions
// ============================================================

import type { OllamaClient } from "../ollama/types.js";
import type { Logger } from "pino";

export interface TagInfo {
  path: string;
  description?: string;
  usageCount: number;
  recentEntities?: string[];
  embedding?: Float32Array;
}

export interface AutoTagInput {
  noteContent: string;
  noteTitle?: string;
  existingTags: TagInfo[];
}

export type TagSuggestionReason =
  | "existing-match"
  | "new-tag"
  | "embedding-similarity"
  | "keyword-rule";

export type TagSuggestionSource = "ollama" | "embedding" | "heuristic";

export interface AutoTagSuggestion {
  tag: string;
  confidence: number;
  reason: TagSuggestionReason;
  source: TagSuggestionSource;
}

/** Minimal EmbeddingEngine interface (compatible with @supernote/search) */
export interface EmbeddingEngine {
  embed(text: string): Promise<Float32Array>;
}

export interface AutoTaggerOptions {
  ollama?: OllamaClient;
  embeddingEngine?: EmbeddingEngine;
  maxSuggestions?: number;
  minConfidence?: number;
  preferExisting?: boolean;
  logger?: Logger;
}

export interface AutoTagger {
  suggest(input: AutoTagInput): Promise<AutoTagSuggestion[]>;
}
