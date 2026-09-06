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
import { refineActions } from "./refine.js";
import pino from "pino";
import type { Logger } from "pino";

/** Plafond appliqué APRÈS scission : deux actions issues d'une phrase comptent double. */
const MAX_REFINED_ACTIONS = 8;

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
    const now = this.opts.now?.() ?? new Date();

    if (this.opts.ollama) {
      try {
        const available = await this.opts.ollama.isAvailable();
        if (available) {
          const raw = await ollamaExtractActions(noteContent, this.opts.ollama, now);
          // Filtré AVANT de décider : une réponse qui ne contenait qu'un titre
          // de gabarit ne vaut pas mieux qu'une réponse vide, et l'heuristique
          // doit alors avoir sa chance.
          const actions = refineActions(raw, noteContent, now, MAX_REFINED_ACTIONS);
          if (actions.length > 0) {
            this.logger.debug({ count: actions.length }, "Ollama actions");
            return actions;
          }
        }
      } catch (err) {
        this.logger.warn({ err }, "Ollama extract actions failed, using heuristic");
      }
    }

    const actions = refineActions(
      extractActionsHeuristic(noteContent),
      noteContent,
      now,
      MAX_REFINED_ACTIONS,
    );
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
