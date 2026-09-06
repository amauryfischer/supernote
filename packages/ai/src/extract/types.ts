// ============================================================
// Action and mention extractor type definitions
// ============================================================

import type { OllamaClient } from "../ollama/types.js";
import type { Logger } from "pino";

export interface ExtractedAction {
  /** Libellé nettoyé : ni markdown, ni expression de date. */
  text: string;
  assignee: string | null;
  /** Date calendaire ISO `YYYY-MM-DD`, jamais l'expression brute. */
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
  /** Référence temporelle des échéances relatives (« demain »). */
  now?: () => Date;
}
