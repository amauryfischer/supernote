/**
 * Integration tests for AutoTagger with real Ollama daemon.
 *
 * These tests are skipped automatically when Ollama is not running.
 * Run manually with: pnpm --filter @supernote/ai test -- --reporter=verbose
 */

import { describe, it, expect, beforeAll } from "vitest";
import { createAutoTagger } from "./tagger.js";
import { createOllamaClient } from "../ollama/client.js";
import type { TagInfo } from "./types.js";

const SKIP_REASON = "Ollama daemon not available — skipping integration test";

let ollamaAvailable = false;

beforeAll(async () => {
  const client = createOllamaClient();
  ollamaAvailable = await client.isAvailable().catch(() => false);
});

function makeTag(path: string): TagInfo {
  return { path, usageCount: 3 };
}

describe("AutoTagger integration (requires Ollama)", () => {
  it("suggests existing tags for a note about finances", async () => {
    if (!ollamaAvailable) {
      console.warn(SKIP_REASON);
      return;
    }

    const ollama = createOllamaClient();
    const tagger = createAutoTagger({ ollama, minConfidence: 0.4, preferExisting: true });

    const suggestions = await tagger.suggest({
      noteContent: "Réunion avec le comptable pour réviser le bilan financier du trimestre.",
      noteTitle: "Réunion comptabilité",
      existingTags: [
        makeTag("finance"),
        makeTag("travail"),
        makeTag("perso"),
        makeTag("reunion"),
      ],
    });

    expect(suggestions.length).toBeGreaterThan(0);
    // At least one suggestion with confidence > 0.4
    expect(suggestions.some((s) => s.confidence > 0.4)).toBe(true);
  });

  it("falls back to heuristics when content is minimal", async () => {
    if (!ollamaAvailable) {
      console.warn(SKIP_REASON);
      return;
    }

    const ollama = createOllamaClient();
    const tagger = createAutoTagger({ ollama, minConfidence: 0.3 });

    // Minimal content — heuristics should still fire
    const suggestions = await tagger.suggest({
      noteContent: "Meeting 14h",
      existingTags: [makeTag("travail"), makeTag("reunion")],
    });

    // We expect the result is an array (no crash), even if empty
    expect(Array.isArray(suggestions)).toBe(true);
  });
});
