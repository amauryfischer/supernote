// ============================================================
// Ollama-based tag suggestion — structured JSON prompt
// ============================================================

import { z } from "zod";
import type { OllamaClient } from "../ollama/types.js";
import type { AutoTagInput, AutoTagSuggestion, TagInfo } from "./types.js";
import { AUTO_TAG_PROMPT_V2 } from "../prompts/index.js";

const OllamaTagSchema = z.object({
  tag: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reason: z.enum(["existing-match", "new-tag", "keyword-rule"]),
});

const OllamaResponseSchema = z.object({
  tags: z.array(OllamaTagSchema),
});

function buildExistingTagsJson(tags: TagInfo[]): string {
  return JSON.stringify(
    tags.map((t) => ({
      path: t.path,
      usageCount: t.usageCount,
      description: t.description ?? null,
      examples: t.recentEntities?.slice(0, 3) ?? [],
    })),
    null,
    2,
  );
}

function buildPrompt(input: AutoTagInput): string {
  return AUTO_TAG_PROMPT_V2
    .replace("{{existingTagsJson}}", buildExistingTagsJson(input.existingTags))
    .replace("{{noteTitle}}", input.noteTitle ?? "(untitled)")
    .replace("{{noteContent}}", input.noteContent.slice(0, 4000));
}

function parseOllamaResponse(raw: string): AutoTagSuggestion[] {
  let parsed: unknown;
  try {
    // Handle potential markdown code blocks
    const cleaned = raw.replace(/```(?:json)?\n?/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  const result = OllamaResponseSchema.safeParse(parsed);
  if (!result.success) return [];

  return result.data.tags.map((t) => ({
    tag: t.tag,
    confidence: t.confidence,
    reason: t.reason,
    source: "ollama" as const,
  }));
}

export async function ollamaSuggest(
  input: AutoTagInput,
  client: OllamaClient,
): Promise<AutoTagSuggestion[]> {
  const prompt = buildPrompt(input);

  const raw = await client.generate({
    prompt,
    format: "json",
    temperature: 0.1,
  });

  return parseOllamaResponse(raw);
}
