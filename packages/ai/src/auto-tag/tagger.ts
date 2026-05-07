// ============================================================
// AutoTagger — 3-level strategy: Ollama → Embedding → Heuristic
// ============================================================

import type {
  AutoTagger,
  AutoTagInput,
  AutoTagSuggestion,
  AutoTaggerOptions,
} from "./types.js";
import { heuristicSuggest } from "./heuristic.js";
import { embeddingSuggest } from "./embedding-suggest.js";
import { ollamaSuggest } from "./ollama-suggest.js";
import pino from "pino";
import type { Logger } from "pino";

const DEFAULT_MAX_SUGGESTIONS = 5;
const DEFAULT_MIN_CONFIDENCE = 0.5;
const DEFAULT_PREFER_EXISTING = true;

function buildLogger(parent?: Logger): Logger {
  return parent
    ? parent.child({ module: "auto-tagger" })
    : pino({ name: "ai:auto-tagger" });
}

/**
 * Merge suggestions from multiple sources.
 * If same tag appears from multiple sources, boost confidence and keep highest-confidence entry.
 */
function mergeSuggestions(
  sources: AutoTagSuggestion[][],
): AutoTagSuggestion[] {
  const byTag = new Map<string, AutoTagSuggestion>();

  for (const sourceSuggestions of sources) {
    for (const suggestion of sourceSuggestions) {
      const existing = byTag.get(suggestion.tag);
      if (!existing) {
        byTag.set(suggestion.tag, { ...suggestion });
      } else {
        // Multi-source boost: average + 0.1 bonus, capped at 1.0
        const boosted = Math.min(
          (existing.confidence + suggestion.confidence) / 2 + 0.1,
          1.0,
        );
        byTag.set(suggestion.tag, {
          ...existing,
          confidence: boosted,
        });
      }
    }
  }

  return Array.from(byTag.values());
}

class AutoTaggerImpl implements AutoTagger {
  private readonly opts: Required<
    Omit<AutoTaggerOptions, "ollama" | "embeddingEngine" | "logger">
  > &
    Pick<AutoTaggerOptions, "ollama" | "embeddingEngine">;
  private readonly logger: Logger;

  constructor(opts: AutoTaggerOptions) {
    this.opts = {
      ollama: opts.ollama,
      embeddingEngine: opts.embeddingEngine,
      maxSuggestions: opts.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS,
      minConfidence: opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
      preferExisting: opts.preferExisting ?? DEFAULT_PREFER_EXISTING,
    };
    this.logger = buildLogger(opts.logger);
  }

  async suggest(input: AutoTagInput): Promise<AutoTagSuggestion[]> {
    if (!input.noteContent?.trim() && !input.noteTitle?.trim()) {
      return [];
    }

    const allSuggestions: AutoTagSuggestion[][] = [];

    // Level 1: Ollama (primary)
    if (this.opts.ollama) {
      try {
        const available = await this.opts.ollama.isAvailable();
        if (available) {
          const suggestions = await ollamaSuggest(input, this.opts.ollama);
          this.logger.debug(
            { count: suggestions.length },
            "Ollama suggestions",
          );
          allSuggestions.push(suggestions);
        } else {
          this.logger.debug("Ollama not available, skipping");
        }
      } catch (err) {
        this.logger.warn({ err }, "Ollama suggest failed, falling back");
      }
    }

    // Level 2: Embedding similarity (complement or fallback)
    if (this.opts.embeddingEngine) {
      try {
        const suggestions = await embeddingSuggest(
          input,
          this.opts.embeddingEngine,
        );
        this.logger.debug(
          { count: suggestions.length },
          "Embedding suggestions",
        );
        allSuggestions.push(suggestions);
      } catch (err) {
        this.logger.warn({ err }, "Embedding suggest failed, falling back");
      }
    }

    // Level 3: Heuristic (always runs as final safety net)
    const heuristic = heuristicSuggest(input, this.opts.preferExisting);
    this.logger.debug({ count: heuristic.length }, "Heuristic suggestions");
    allSuggestions.push(heuristic);

    // Merge, filter, sort, limit
    const merged = mergeSuggestions(allSuggestions);

    let filtered = merged.filter(
      (s) => s.confidence >= this.opts.minConfidence,
    );

    // If preferExisting, filter out new-tag suggestions when existing matches exist
    if (this.opts.preferExisting && input.existingTags.length > 0) {
      const hasExistingMatches = filtered.some(
        (s) => s.reason !== "new-tag",
      );
      if (hasExistingMatches) {
        filtered = filtered.filter((s) => s.reason !== "new-tag");
      }
    }

    return filtered
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, this.opts.maxSuggestions);
  }
}

export function createAutoTagger(opts: AutoTaggerOptions = {}): AutoTagger {
  return new AutoTaggerImpl(opts);
}
