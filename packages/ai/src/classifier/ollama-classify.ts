// ============================================================
// Ollama-based entity type classification
// ============================================================

import { z } from "zod";
import type { OllamaClient } from "../ollama/types.js";
import type { EntityTypeInfo, TypeSuggestion } from "./types.js";
import { ENTITY_TYPE_PROMPT_V1 } from "../prompts/index.js";

const OllamaClassifySchema = z.object({
  suggestions: z.array(
    z.object({
      typeId: z.string(),
      typeName: z.string(),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
    }),
  ),
});

function buildPrompt(noteContent: string, types: EntityTypeInfo[]): string {
  const typesText = types
    .map(
      (t) =>
        `- id: "${t.id}", name: "${t.name}"${t.description ? `, description: "${t.description}"` : ""}`,
    )
    .join("\n");

  return ENTITY_TYPE_PROMPT_V1
    .replace("{{availableTypes}}", typesText)
    .replace("{{noteContent}}", noteContent.slice(0, 3000));
}

function parseResponse(raw: string): TypeSuggestion[] {
  let parsed: unknown;
  try {
    const cleaned = raw.replace(/```(?:json)?\n?/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  const result = OllamaClassifySchema.safeParse(parsed);
  if (!result.success) return [];

  return result.data.suggestions.map((s) => ({
    typeId: s.typeId,
    typeName: s.typeName,
    confidence: s.confidence,
    reason: s.reason,
    source: "ollama" as const,
  }));
}

export async function ollamaClassify(
  noteContent: string,
  availableTypes: EntityTypeInfo[],
  client: OllamaClient,
): Promise<TypeSuggestion[]> {
  const prompt = buildPrompt(noteContent, availableTypes);
  const raw = await client.generate({ prompt, format: "json", temperature: 0.1 });
  return parseResponse(raw);
}
