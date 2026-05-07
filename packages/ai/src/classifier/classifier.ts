// ============================================================
// EntityTypeClassifier — Ollama + heuristic fallback
// ============================================================

import type {
  ClassifierOptions,
  EntityTypeClassifier,
  EntityTypeInfo,
  TypeSuggestion,
} from "./types.js";
import { heuristicClassify } from "./heuristic-classify.js";
import { ollamaClassify } from "./ollama-classify.js";
import pino from "pino";
import type { Logger } from "pino";

const DEFAULT_MAX_SUGGESTIONS = 3;
const DEFAULT_MIN_CONFIDENCE = 0.5;

function buildLogger(parent?: Logger): Logger {
  return parent
    ? parent.child({ module: "classifier" })
    : pino({ name: "ai:classifier" });
}

class EntityTypeClassifierImpl implements EntityTypeClassifier {
  private readonly opts: ClassifierOptions;
  private readonly logger: Logger;

  constructor(opts: ClassifierOptions) {
    this.opts = opts;
    this.logger = buildLogger(opts.logger);
  }

  async suggest(
    noteContent: string,
    availableTypes: EntityTypeInfo[],
  ): Promise<TypeSuggestion[]> {
    if (!noteContent?.trim() || availableTypes.length === 0) return [];

    const maxSuggestions = this.opts.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS;
    const minConfidence = this.opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

    let suggestions: TypeSuggestion[] = [];

    // Try Ollama first
    if (this.opts.ollama) {
      try {
        const available = await this.opts.ollama.isAvailable();
        if (available) {
          suggestions = await ollamaClassify(
            noteContent,
            availableTypes,
            this.opts.ollama,
          );
          this.logger.debug({ count: suggestions.length }, "Ollama classify");
        }
      } catch (err) {
        this.logger.warn({ err }, "Ollama classify failed, using heuristic");
      }
    }

    // Fall back to or supplement with heuristic
    if (suggestions.length === 0) {
      suggestions = heuristicClassify(noteContent, availableTypes);
      this.logger.debug(
        { count: suggestions.length },
        "Heuristic classify",
      );
    }

    return suggestions
      .filter((s) => s.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxSuggestions);
  }
}

export function createEntityTypeClassifier(
  opts: ClassifierOptions = {},
): EntityTypeClassifier {
  return new EntityTypeClassifierImpl(opts);
}
