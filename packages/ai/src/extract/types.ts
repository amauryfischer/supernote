// ============================================================
// Action and mention extractor type definitions
// ============================================================

import type { OllamaClient } from "../ollama/types.js";
import type { Logger } from "pino";

export interface ExtractedAction {
  text: string;
  assignee: string | null;
  deadline: string | null;
  priority: "high" | "medium" | "low";
  source: "ollama" | "heuristic";
}

export interface EntityRef {
  id: string;
  name: string;
  aliases?: string[];
  typeId?: string;
}

export interface MentionMatch {
  entityId: string;
  entityName: string;
  matchedText: string;
  confidence: number;
  startOffset: number;
  endOffset: number;
  source: "ollama" | "heuristic";
}

export interface ActionExtractor {
  extractActions(noteContent: string): Promise<ExtractedAction[]>;
  extractEntityMentions(
    noteContent: string,
    candidateEntities: EntityRef[],
  ): Promise<MentionMatch[]>;
}

export interface ExtractorOptions {
  ollama?: OllamaClient;
  logger?: Logger;
}
