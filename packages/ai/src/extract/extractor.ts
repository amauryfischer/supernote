// ============================================================
// ActionExtractor — Ollama + heuristic fallback
// ============================================================

import type {
  ActionExtractor,
  EntityRef,
  ExtractedAction,
  ExtractorOptions,
  MentionMatch,
} from "./types.js";
import {
  extractActionsHeuristic,
  extractMentionsHeuristic,
} from "./heuristic-extract.js";
import { ollamaExtractActions, ollamaExtractMentions } from "./ollama-extract.js";
import pino from "pino";
import type { Logger } from "pino";

function buildLogger(parent?: Logger): Logger {
  return parent
    ? parent.child({ module: "extractor" })
    : pino({ name: "ai:extractor" });
}

class ActionExtractorImpl implements ActionExtractor {
  private readonly opts: ExtractorOptions;
  private readonly logger: Logger;

  constructor(opts: ExtractorOptions) {
    this.opts = opts;
    this.logger = buildLogger(opts.logger);
  }

  async extractActions(noteContent: string): Promise<ExtractedAction[]> {
    if (!noteContent?.trim()) return [];

    if (this.opts.ollama) {
      try {
        const available = await this.opts.ollama.isAvailable();
        if (available) {
          const actions = await ollamaExtractActions(noteContent, this.opts.ollama);
          if (actions.length > 0) {
            this.logger.debug({ count: actions.length }, "Ollama actions");
            return actions;
          }
        }
      } catch (err) {
        this.logger.warn({ err }, "Ollama extract actions failed, using heuristic");
      }
    }

    const actions = extractActionsHeuristic(noteContent);
    this.logger.debug({ count: actions.length }, "Heuristic actions");
    return actions;
  }

  async extractEntityMentions(
    noteContent: string,
    candidateEntities: EntityRef[],
  ): Promise<MentionMatch[]> {
    if (!noteContent?.trim() || candidateEntities.length === 0) return [];

    if (this.opts.ollama) {
      try {
        const available = await this.opts.ollama.isAvailable();
        if (available) {
          const mentions = await ollamaExtractMentions(
            noteContent,
            candidateEntities,
            this.opts.ollama,
          );
          if (mentions.length > 0) {
            this.logger.debug({ count: mentions.length }, "Ollama mentions");
            return mentions;
          }
        }
      } catch (err) {
        this.logger.warn({ err }, "Ollama extract mentions failed, using heuristic");
      }
    }

    const mentions = extractMentionsHeuristic(noteContent, candidateEntities);
    this.logger.debug({ count: mentions.length }, "Heuristic mentions");
    return mentions;
  }
}

export function createActionExtractor(opts: ExtractorOptions = {}): ActionExtractor {
  return new ActionExtractorImpl(opts);
}
