// ============================================================
// Ollama-based action and mention extraction
// ============================================================

import { z } from "zod";
import type { OllamaClient } from "../ollama/types.js";
import type { ExtractedAction, EntityRef, MentionMatch } from "./types.js";
import { ACTION_EXTRACT_PROMPT_V1, MENTION_EXTRACT_PROMPT_V1 } from "../prompts/index.js";

/**
 * Longueur maximale envoyée au modèle. Au-delà, la fin du texte n'est vue par
 * personne : le repli heuristique ne joue que si Ollama ne rend rien. Exporté
 * pour que l'UI puisse l'annoncer sans redire la valeur.
 */
export const OLLAMA_EXTRACT_TEXT_LIMIT = 4000;

const ActionSchema = z.object({
  text: z.string(),
  assignee: z.string().nullable(),
  deadline: z.string().nullable(),
  priority: z.enum(["high", "medium", "low"]),
});

const ActionsResponseSchema = z.object({
  actions: z.array(ActionSchema),
});

const MentionSchema = z.object({
  entityId: z.string(),
  entityName: z.string(),
  matchedText: z.string(),
  confidence: z.number().min(0).max(1),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
});

const MentionsResponseSchema = z.object({
  mentions: z.array(MentionSchema),
});

function parseJson<T>(
  raw: string,
  schema: z.ZodType<T>,
): T | null {
  try {
    const cleaned = raw.replace(/```(?:json)?\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const result = schema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function ollamaExtractActions(
  noteContent: string,
  client: OllamaClient,
): Promise<ExtractedAction[]> {
  const prompt = ACTION_EXTRACT_PROMPT_V1.replace(
    "{{noteContent}}",
    noteContent.slice(0, OLLAMA_EXTRACT_TEXT_LIMIT),
  );

  const raw = await client.generate({ prompt, format: "json", temperature: 0.1 });
  const parsed = parseJson(raw, ActionsResponseSchema);
  if (!parsed) return [];

  return parsed.actions.map((a) => ({
    text: a.text,
    assignee: a.assignee,
    deadline: a.deadline,
    priority: a.priority,
    source: "ollama" as const,
  }));
}

export async function ollamaExtractMentions(
  noteContent: string,
  candidateEntities: EntityRef[],
  client: OllamaClient,
): Promise<MentionMatch[]> {
  const entitiesText = candidateEntities
    .map((e) => `- id: "${e.id}", name: "${e.name}"`)
    .join("\n");

  const prompt = MENTION_EXTRACT_PROMPT_V1
    .replace("{{candidateEntities}}", entitiesText)
    .replace("{{noteContent}}", noteContent.slice(0, OLLAMA_EXTRACT_TEXT_LIMIT));

  const raw = await client.generate({ prompt, format: "json", temperature: 0.1 });
  const parsed = parseJson(raw, MentionsResponseSchema);
  if (!parsed) return [];

  return parsed.mentions.map((m) => ({
    entityId: m.entityId,
    entityName: m.entityName,
    matchedText: m.matchedText,
    confidence: m.confidence,
    startOffset: m.startOffset,
    endOffset: m.endOffset,
    source: "ollama" as const,
  }));
}
