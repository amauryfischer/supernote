// ============================================================
// Entity type classifier type definitions
// ============================================================

import type { OllamaClient } from "../ollama/types.js";
import type { Logger } from "pino";

export interface EntityTypeInfo {
  id: string;
  name: string;
  description?: string;
  keywords?: string[];
}

export interface TypeSuggestion {
  typeId: string;
  typeName: string;
  confidence: number;
  reason: string;
  source: "ollama" | "heuristic";
}

export interface EntityTypeClassifier {
  suggest(
    noteContent: string,
    availableTypes: EntityTypeInfo[],
  ): Promise<TypeSuggestion[]>;
}

export interface ClassifierOptions {
  ollama?: OllamaClient;
  maxSuggestions?: number;
  minConfidence?: number;
  logger?: Logger;
}
