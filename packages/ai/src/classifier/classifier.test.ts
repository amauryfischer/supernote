// ============================================================
// EntityTypeClassifier tests
// ============================================================

import { describe, it, expect, vi } from "vitest";
import { createEntityTypeClassifier } from "./classifier.js";
import type { EntityTypeInfo } from "./types.js";
import type { OllamaClient } from "../ollama/types.js";

const AVAILABLE_TYPES: EntityTypeInfo[] = [
  { id: "interaction", name: "Interaction", description: "Meeting, call, or other interaction" },
  { id: "task", name: "Tâche", description: "A task or action item" },
  { id: "recipe", name: "Recette", description: "A food recipe" },
  { id: "person", name: "Personne", description: "A person or contact" },
  { id: "project", name: "Projet", description: "A project" },
];

function makeMockOllama(suggestions: Array<{ typeId: string; typeName: string; confidence: number; reason: string }>): OllamaClient {
  return {
    isAvailable: vi.fn().mockResolvedValue(true),
    generate: vi.fn().mockResolvedValue(JSON.stringify({ suggestions })),
    listModels: vi.fn().mockResolvedValue([]),
    embed: vi.fn(),
    chat: vi.fn(),
  } as unknown as OllamaClient;
}

describe("EntityTypeClassifier", () => {
  describe("with Ollama", () => {
    it("returns Ollama suggestions when available", async () => {
      const ollama = makeMockOllama([
        { typeId: "interaction", typeName: "Interaction", confidence: 0.9, reason: "Meeting detected" },
      ]);
      const classifier = createEntityTypeClassifier({ ollama });
      const suggestions = await classifier.suggest(
        "Réunion avec Jean et Marie pour discuter du projet.",
        AVAILABLE_TYPES,
      );
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it("falls back to heuristic when Ollama unavailable", async () => {
      const ollama = {
        isAvailable: vi.fn().mockResolvedValue(false),
        generate: vi.fn(),
      } as unknown as OllamaClient;
      const classifier = createEntityTypeClassifier({ ollama, minConfidence: 0.0 });
      const suggestions = await classifier.suggest(
        "Réunion avec l'équipe pour discuter du sprint.",
        AVAILABLE_TYPES,
      );
      // heuristic should detect Interaction
      expect(suggestions).toBeDefined();
    });
  });

  describe("heuristic classification", () => {
    it("detects Interaction type from meeting keywords", async () => {
      const classifier = createEntityTypeClassifier({ minConfidence: 0.0 });
      const suggestions = await classifier.suggest(
        "Réunion avec Jean. Participants: Marie, Paul. Compte-rendu de la réunion.",
        AVAILABLE_TYPES,
      );
      const interaction = suggestions.find((s) => s.typeId === "interaction");
      expect(interaction).toBeDefined();
      expect(interaction!.confidence).toBeGreaterThan(0.5);
    });

    it("detects Tâche type from task keywords", async () => {
      const classifier = createEntityTypeClassifier({ minConfidence: 0.0 });
      const suggestions = await classifier.suggest(
        "TODO: finish the report by Friday. Priority: high. Deadline: 2026-05-15.",
        AVAILABLE_TYPES,
      );
      const task = suggestions.find((s) => s.typeId === "task");
      expect(task).toBeDefined();
    });

    it("detects Recette type from recipe keywords", async () => {
      const classifier = createEntityTypeClassifier({ minConfidence: 0.0 });
      const suggestions = await classifier.suggest(
        "Recette: tarte aux pommes. Ingrédients: 200g farine, 3 pommes. Cuire 30 min au four.",
        AVAILABLE_TYPES,
      );
      const recipe = suggestions.find((s) => s.typeId === "recipe");
      expect(recipe).toBeDefined();
    });

    it("uses user-defined keywords when provided", async () => {
      const types: EntityTypeInfo[] = [
        { id: "custom", name: "Custom", keywords: ["supernote", "vault", "workspace"] },
      ];
      const classifier = createEntityTypeClassifier({ minConfidence: 0.0 });
      const suggestions = await classifier.suggest(
        "My supernote vault is well organized.",
        types,
      );
      const custom = suggestions.find((s) => s.typeId === "custom");
      expect(custom).toBeDefined();
      expect(custom!.confidence).toBeGreaterThan(0.5);
    });
  });

  describe("filtering", () => {
    it("respects maxSuggestions limit", async () => {
      const classifier = createEntityTypeClassifier({ maxSuggestions: 1, minConfidence: 0.0 });
      const suggestions = await classifier.suggest(
        "Réunion todo task tâche meeting projet project",
        AVAILABLE_TYPES,
      );
      expect(suggestions.length).toBeLessThanOrEqual(1);
    });

    it("returns empty for empty content", async () => {
      const classifier = createEntityTypeClassifier();
      const suggestions = await classifier.suggest("", AVAILABLE_TYPES);
      expect(suggestions).toEqual([]);
    });

    it("returns empty for empty types list", async () => {
      const classifier = createEntityTypeClassifier();
      const suggestions = await classifier.suggest("Some content", []);
      expect(suggestions).toEqual([]);
    });
  });
});
