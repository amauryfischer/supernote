// ============================================================
// ActionExtractor tests
// ============================================================

import { describe, it, expect, vi } from "vitest";
import { createActionExtractor } from "./extractor.js";
import type { EntityRef } from "./types.js";
import type { OllamaClient } from "../ollama/types.js";

function makeMockOllama(
  actions: unknown[],
  mentions: unknown[] = [],
): OllamaClient {
  return {
    isAvailable: vi.fn().mockResolvedValue(true),
    generate: vi.fn()
      .mockResolvedValueOnce(JSON.stringify({ actions }))
      .mockResolvedValueOnce(JSON.stringify({ mentions })),
    listModels: vi.fn().mockResolvedValue([]),
    embed: vi.fn(),
    chat: vi.fn(),
  } as unknown as OllamaClient;
}

const CANDIDATE_ENTITIES: EntityRef[] = [
  { id: "ent-1", name: "Jean Dupont", aliases: ["Jean"] },
  { id: "ent-2", name: "Acme Corp", aliases: ["Acme"] },
  { id: "ent-3", name: "Marie Martin" },
];

describe("ActionExtractor", () => {
  describe("extractActions — heuristic", () => {
    it("extracts TODO items", async () => {
      const extractor = createActionExtractor();
      const actions = await extractor.extractActions(
        "Meeting notes:\nTODO: send the report to Jean\nTODO: book next meeting",
      );
      expect(actions.length).toBeGreaterThanOrEqual(1);
      expect(actions.some((a) => a.text.toLowerCase().includes("send"))).toBe(true);
    });

    it("extracts 'à faire' French patterns", async () => {
      const extractor = createActionExtractor();
      const actions = await extractor.extractActions(
        "Résumé: à faire: appeler le client demain",
      );
      expect(actions.some((a) => a.text.toLowerCase().includes("appeler"))).toBe(true);
    });

    it("extracts 'je dois' French patterns", async () => {
      const extractor = createActionExtractor();
      const actions = await extractor.extractActions(
        "Je dois finir le rapport avant vendredi.",
      );
      expect(actions.some((a) => a.text.toLowerCase().includes("finir"))).toBe(true);
    });

    it("extracts checkbox items [ ]", async () => {
      const extractor = createActionExtractor();
      const actions = await extractor.extractActions(
        "## Tasks\n- [ ] Review PR\n- [x] Deploy to staging\n- [ ] Write tests",
      );
      // Should find unchecked items
      expect(actions.some((a) => a.text.toLowerCase().includes("review pr"))).toBe(true);
      expect(actions.some((a) => a.text.toLowerCase().includes("write tests"))).toBe(true);
    });

    it("extracts deadline from action text", async () => {
      const extractor = createActionExtractor();
      const actions = await extractor.extractActions(
        "TODO: submit invoice by 2026-05-31",
      );
      const withDeadline = actions.find((a) => a.deadline !== null);
      expect(withDeadline).toBeDefined();
    });

    it("extracts assignee @mention from action", async () => {
      const extractor = createActionExtractor();
      const actions = await extractor.extractActions(
        "ACTION: @Jean review the contract",
      );
      const withAssignee = actions.find((a) => a.assignee !== null);
      expect(withAssignee?.assignee).toBe("Jean");
    });

    it("returns empty array for empty content", async () => {
      const extractor = createActionExtractor();
      const actions = await extractor.extractActions("");
      expect(actions).toEqual([]);
    });

    it("returns empty array for whitespace-only content", async () => {
      const extractor = createActionExtractor();
      const actions = await extractor.extractActions("   \n  ");
      expect(actions).toEqual([]);
    });

    it("marks heuristic-extracted actions with source=heuristic", async () => {
      const extractor = createActionExtractor();
      const actions = await extractor.extractActions("TODO: test action");
      expect(actions.every((a) => a.source === "heuristic")).toBe(true);
    });
  });

  describe("extractActions — with Ollama", () => {
    it("uses Ollama result when available", async () => {
      const ollamaActions = [
        { text: "Send report to client", assignee: "Jean", deadline: "2026-05-15", priority: "high" },
      ];
      const ollama = makeMockOllama(ollamaActions);
      const extractor = createActionExtractor({ ollama });
      const actions = await extractor.extractActions("Notes de réunion...");

      const ollamaResult = actions.filter((a) => a.source === "ollama");
      expect(ollamaResult.length).toBeGreaterThan(0);
      expect(ollamaResult[0]?.text).toBe("Send report to client");
    });

    it("falls back to heuristic when Ollama returns empty", async () => {
      const ollama = makeMockOllama([]);
      const extractor = createActionExtractor({ ollama });
      const actions = await extractor.extractActions("TODO: do something");

      // heuristic should find it
      expect(actions.some((a) => a.source === "heuristic")).toBe(true);
    });
  });

  describe("extractEntityMentions — heuristic", () => {
    it("finds entity name in text", async () => {
      const extractor = createActionExtractor();
      const mentions = await extractor.extractEntityMentions(
        "I met with Jean Dupont today to discuss Acme Corp's contract.",
        CANDIDATE_ENTITIES,
      );
      expect(mentions.some((m) => m.entityId === "ent-1")).toBe(true);
      expect(mentions.some((m) => m.entityId === "ent-2")).toBe(true);
    });

    it("finds entity by alias", async () => {
      const extractor = createActionExtractor();
      const mentions = await extractor.extractEntityMentions(
        "Jean called about the project.",
        CANDIDATE_ENTITIES,
      );
      expect(mentions.some((m) => m.entityId === "ent-1")).toBe(true);
    });

    it("returns correct offsets for matched text", async () => {
      const extractor = createActionExtractor();
      const content = "Hello Jean Dupont, how are you?";
      const mentions = await extractor.extractEntityMentions(content, CANDIDATE_ENTITIES);
      const jean = mentions.find((m) => m.entityId === "ent-1");
      expect(jean).toBeDefined();
      expect(jean!.startOffset).toBeGreaterThanOrEqual(0);
      expect(content.slice(jean!.startOffset, jean!.endOffset)).toBeTruthy();
    });

    it("returns empty when no candidates provided", async () => {
      const extractor = createActionExtractor();
      const mentions = await extractor.extractEntityMentions(
        "Hello Jean, nice to meet you.",
        [],
      );
      expect(mentions).toEqual([]);
    });

    it("returns empty for empty content", async () => {
      const extractor = createActionExtractor();
      const mentions = await extractor.extractEntityMentions("", CANDIDATE_ENTITIES);
      expect(mentions).toEqual([]);
    });

    it("assigns confidence scores to matches", async () => {
      const extractor = createActionExtractor();
      const mentions = await extractor.extractEntityMentions(
        "Jean Dupont attended the meeting.",
        CANDIDATE_ENTITIES,
      );
      for (const m of mentions) {
        expect(m.confidence).toBeGreaterThan(0);
        expect(m.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("extractEntityMentions — with Ollama", () => {
    it("uses Ollama for mention extraction when available", async () => {
      const ollamaMentions = [
        {
          entityId: "ent-1",
          entityName: "Jean Dupont",
          matchedText: "Jean",
          confidence: 0.95,
          startOffset: 10,
          endOffset: 14,
        },
      ];
      const ollama = {
        isAvailable: vi.fn().mockResolvedValue(true),
        generate: vi.fn()
          .mockResolvedValueOnce(JSON.stringify({ mentions: ollamaMentions })),
        listModels: vi.fn().mockResolvedValue([]),
        embed: vi.fn(),
        chat: vi.fn(),
      } as unknown as OllamaClient;

      const extractor = createActionExtractor({ ollama });
      const mentions = await extractor.extractEntityMentions(
        "Meeting with Jean about the project.",
        CANDIDATE_ENTITIES,
      );
      expect(mentions.some((m) => m.source === "ollama")).toBe(true);
    });
  });
});
