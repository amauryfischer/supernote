// ============================================================
// Ollama-based action and mention extraction
// ============================================================

import { z } from "zod";
import type { OllamaClient } from "../ollama/types.js";
import type { ExtractedAction, EntityRef, MentionMatch } from "./types.js";
import { MENTION_EXTRACT_PROMPT_V1 } from "../prompts/index.js";
import { ACTION_EXTRACT_PROMPT_V2 } from "./prompts.js";
import { resolveFrenchDeadline, toIsoDate } from "./deadline-fr.js";

/**
 * Longueur maximale envoyée au modèle. Au-delà, la fin du texte n'est vue par
 * personne : le repli heuristique ne joue que si Ollama ne rend rien. Exporté
 * pour que l'UI puisse l'annoncer sans redire la valeur.
 */
export const OLLAMA_EXTRACT_TEXT_LIMIT = 4000;

// Tolérant à dessein : un champ manquant ou d'un type inattendu ne doit pas
// faire échouer TOUTE la réponse — une action sans date vaut mieux qu'aucune.
const ActionSchema = z.object({
  text: z.string(),
  assignee: z.unknown(),
  deadlineText: z.unknown(),
  deadline: z.unknown(),
  priority: z.unknown(),
});

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asPriority(value: unknown): "high" | "medium" | "low" {
  return value === "high" || value === "low" ? value : "medium";
}

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
  now: Date = new Date(),
): Promise<ExtractedAction[]> {
  const prompt = ACTION_EXTRACT_PROMPT_V2
    .replace("{{today}}", toIsoDate(now))
    .replace("{{noteContent}}", noteContent.slice(0, OLLAMA_EXTRACT_TEXT_LIMIT));

  const raw = await client.generate({ prompt, format: "json", temperature: 0.1 });
  const parsed = parseJson(raw, ActionsResponseSchema);
  if (!parsed) return [];

  return parsed.actions.map((a) => ({
    text: a.text,
    assignee: asText(a.assignee),
    // L'expression brute prime : le modèle n'a pas de calendrier fiable, la
    // conversion se fait ici. Sa date ISO ne sert que de dernier recours
    // (validée par `plausibleIsoDeadline` en aval).
    deadline: resolveFrenchDeadline(asText(a.deadlineText), now) ?? asText(a.deadline),
    priority: asPriority(a.priority),
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
