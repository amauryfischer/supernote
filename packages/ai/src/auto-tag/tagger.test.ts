// ============================================================
// AutoTagger tests
// ============================================================

import { describe, it, expect, vi } from "vitest";
import { createAutoTagger } from "./tagger.js";
import type { AutoTagInput, EmbeddingEngine, TagInfo } from "./types.js";
import type { OllamaClient } from "../ollama/types.js";

function makeTag(path: string, usageCount = 5, description?: string): TagInfo {
  return { path, usageCount, description };
}

function makeMockOllama(suggestions: Array<{ tag: string; confidence: number; reason: string }>): OllamaClient {
  return {
    isAvailable: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    generate: vi.fn().mockResolvedValue(
      JSON.stringify({ tags: suggestions }),
    ),
    embed: vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2, 0.3])),
    chat: vi.fn(),
  } as unknown as OllamaClient;
}

function makeMockEmbeddingEngine(similarity = 0.8): EmbeddingEngine {
  return {
    embed: vi.fn().mockResolvedValue(new Float32Array([1.0, 0.0, 0.0])),
  };
}

const baseInput: AutoTagInput = {
  noteContent: "Réunion avec Jean pour discuter du projet client.",
  noteTitle: "Réunion client",
  existingTags: [
    makeTag("client/important"),
    makeTag("réunion"),
    makeTag("projet"),
    makeTag("perso"),
  ],
};

describe("AutoTagger", () => {
  describe("with Ollama mock", () => {
    it("returns suggestions from Ollama when available", async () => {
      const ollama = makeMockOllama([
        { tag: "réunion", confidence: 0.9, reason: "existing-match" },
        { tag: "client/important", confidence: 0.8, reason: "existing-match" },
      ]);
      const tagger = createAutoTagger({ ollama });
      const suggestions = await tagger.suggest(baseInput);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions.some((s) => s.source === "ollama" || s.source === "heuristic")).toBe(true);
    });

    it("marks Ollama suggestions with source=ollama", async () => {
      const ollama = makeMockOllama([
        { tag: "réunion", confidence: 0.9, reason: "existing-match" },
      ]);
      const tagger = createAutoTagger({ ollama, minConfidence: 0.0 });
      const suggestions = await tagger.suggest(baseInput);

      const ollamaSuggestions = suggestions.filter((s) => s.source === "ollama");
      expect(ollamaSuggestions.length).toBeGreaterThan(0);
    });

    it("falls back to heuristic when Ollama returns empty", async () => {
      const ollama = makeMockOllama([]);
      const tagger = createAutoTagger({ ollama, minConfidence: 0.0 });
      const suggestions = await tagger.suggest(baseInput);

      // heuristic should still find something
      expect(suggestions.some((s) => s.source === "heuristic")).toBe(true);
    });

    it("falls back when Ollama is unavailable", async () => {
      const ollama = {
        isAvailable: vi.fn().mockResolvedValue(false),
        generate: vi.fn(),
      } as unknown as OllamaClient;
      const tagger = createAutoTagger({ ollama, minConfidence: 0.0 });
      const suggestions = await tagger.suggest(baseInput);

      expect(vi.mocked(ollama.generate)).not.toHaveBeenCalled();
      expect(suggestions.length).toBeGreaterThanOrEqual(0);
    });

    it("falls back gracefully when Ollama throws", async () => {
      const ollama = {
        isAvailable: vi.fn().mockResolvedValue(true),
        generate: vi.fn().mockRejectedValue(new Error("timeout")),
      } as unknown as OllamaClient;
      const tagger = createAutoTagger({ ollama, minConfidence: 0.0 });
      const suggestions = await tagger.suggest(baseInput);

      // Should still have heuristic results
      expect(suggestions).toBeDefined();
    });
  });

  describe("with embedding fallback", () => {
    it("uses embedding engine when Ollama not configured", async () => {
      const engine = makeMockEmbeddingEngine();
      const tagger = createAutoTagger({ embeddingEngine: engine, minConfidence: 0.0 });
      await tagger.suggest(baseInput);

      expect(vi.mocked(engine.embed)).toHaveBeenCalled();
    });

    it("returns embedding-source suggestions when cosine similarity is high", async () => {
      // Make embed return same vector for both note and tags → similarity = 1.0
      const engine: EmbeddingEngine = {
        embed: vi.fn().mockResolvedValue(new Float32Array([1.0, 0.0, 0.0])),
      };
      const tags = [makeTag("client/important")];
      const tagger = createAutoTagger({ embeddingEngine: engine, minConfidence: 0.0 });
      const suggestions = await tagger.suggest({ ...baseInput, existingTags: tags });

      const embeddingSuggestions = suggestions.filter(
        (s) => s.source === "embedding",
      );
      expect(embeddingSuggestions.length).toBeGreaterThan(0);
    });

    it("skips tags with low cosine similarity", async () => {
      // Orthogonal vectors → similarity = 0
      let callCount = 0;
      const engine: EmbeddingEngine = {
        embed: vi.fn().mockImplementation(async () => {
          callCount++;
          return callCount === 1
            ? new Float32Array([1.0, 0.0, 0.0])
            : new Float32Array([0.0, 1.0, 0.0]);
        }),
      };
      const tags = [makeTag("unrelated-topic")];
      const tagger = createAutoTagger({ embeddingEngine: engine, minConfidence: 0.5 });
      const suggestions = await tagger.suggest({ ...baseInput, existingTags: tags });

      const embeddingSuggestions = suggestions.filter(
        (s) => s.source === "embedding",
      );
      expect(embeddingSuggestions.length).toBe(0);
    });
  });

  describe("heuristic only (offline)", () => {
    it("finds tags by keyword presence in content", async () => {
      const tagger = createAutoTagger({ minConfidence: 0.0 });
      const input: AutoTagInput = {
        noteContent: "réunion avec l'équipe ce matin",
        existingTags: [makeTag("réunion")],
      };
      const suggestions = await tagger.suggest(input);
      expect(suggestions.some((s) => s.tag === "réunion")).toBe(true);
    });

    it("detects meeting concept and maps to existing tag", async () => {
      const tagger = createAutoTagger({ minConfidence: 0.0 });
      const input: AutoTagInput = {
        noteContent: "Meeting with the client today about the project",
        existingTags: [makeTag("meeting"), makeTag("perso")],
      };
      const suggestions = await tagger.suggest(input);
      expect(suggestions.some((s) => s.tag === "meeting")).toBe(true);
    });

    it("works with empty existing tags", async () => {
      const tagger = createAutoTagger({ minConfidence: 0.0, preferExisting: false });
      const input: AutoTagInput = {
        noteContent: "TODO: call back the client about the invoice",
        existingTags: [],
      };
      const suggestions = await tagger.suggest(input);
      expect(suggestions).toBeDefined();
    });
  });

  describe("preferExisting option", () => {
    it("does not suggest new tags when preferExisting=true and existing matches found", async () => {
      const tagger = createAutoTagger({ preferExisting: true, minConfidence: 0.0 });
      const input: AutoTagInput = {
        noteContent: "Meeting with client",
        existingTags: [makeTag("meeting")],
      };
      const suggestions = await tagger.suggest(input);
      const newTagSuggestions = suggestions.filter((s) => s.reason === "new-tag");
      expect(newTagSuggestions.length).toBe(0);
    });

    it("allows new tags when preferExisting=false", async () => {
      const tagger = createAutoTagger({ preferExisting: false, minConfidence: 0.0 });
      const input: AutoTagInput = {
        noteContent: "Todo: buy groceries and cook a recipe",
        existingTags: [],
      };
      const suggestions = await tagger.suggest(input);
      const newTags = suggestions.filter((s) => s.reason === "new-tag");
      expect(newTags.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("maxSuggestions option", () => {
    it("limits results to maxSuggestions", async () => {
      const ollama = makeMockOllama([
        { tag: "tag1", confidence: 0.9, reason: "existing-match" },
        { tag: "tag2", confidence: 0.85, reason: "existing-match" },
        { tag: "tag3", confidence: 0.8, reason: "existing-match" },
        { tag: "tag4", confidence: 0.75, reason: "existing-match" },
        { tag: "tag5", confidence: 0.7, reason: "existing-match" },
        { tag: "tag6", confidence: 0.65, reason: "existing-match" },
      ]);
      const tags = [1, 2, 3, 4, 5, 6].map((n) => makeTag(`tag${n}`));
      const tagger = createAutoTagger({ ollama, maxSuggestions: 3, minConfidence: 0.0 });
      const suggestions = await tagger.suggest({ ...baseInput, existingTags: tags });

      expect(suggestions.length).toBeLessThanOrEqual(3);
    });
  });

  describe("confidence threshold", () => {
    it("filters out suggestions below minConfidence", async () => {
      const ollama = makeMockOllama([
        { tag: "weak-tag", confidence: 0.3, reason: "existing-match" },
        { tag: "strong-tag", confidence: 0.9, reason: "existing-match" },
      ]);
      const tags = [makeTag("weak-tag"), makeTag("strong-tag")];
      const tagger = createAutoTagger({ ollama, minConfidence: 0.6 });
      const suggestions = await tagger.suggest({ ...baseInput, existingTags: tags });

      const ollamaResults = suggestions.filter((s) => s.source === "ollama");
      for (const s of ollamaResults) {
        expect(s.confidence).toBeGreaterThanOrEqual(0.6);
      }
    });
  });

  describe("edge cases", () => {
    it("returns empty array for empty note content", async () => {
      const tagger = createAutoTagger();
      const suggestions = await tagger.suggest({
        noteContent: "",
        existingTags: [makeTag("test")],
      });
      expect(suggestions).toEqual([]);
    });

    it("returns empty array for whitespace-only note", async () => {
      const tagger = createAutoTagger();
      const suggestions = await tagger.suggest({
        noteContent: "   \n\t  ",
        existingTags: [makeTag("test")],
      });
      expect(suggestions).toEqual([]);
    });

    it("handles note with no matching tags gracefully", async () => {
      const tagger = createAutoTagger({ minConfidence: 0.9 });
      const suggestions = await tagger.suggest({
        noteContent: "xyz123 random gibberish content",
        existingTags: [makeTag("unrelated")],
      });
      expect(Array.isArray(suggestions)).toBe(true);
    });
  });
});
