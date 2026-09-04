import { createActionExtractor, createOllamaClient } from "@supernote/ai";
import type { EntityRef, ExtractedAction, MentionMatch } from "@supernote/ai";
import { getAiSettings } from "./settings";

export interface JournalExtractionResult {
  mentions: MentionMatch[];
  actions: ExtractedAction[];
}

const EMPTY_RESULT: JournalExtractionResult = { mentions: [], actions: [] };

/**
 * Passe d'extraction sur le texte du jour. Dégrade silencieusement (résultat
 * vide) si l'IA locale n'est pas configurée du tout — `createActionExtractor`
 * gère déjà en interne le repli heuristique quand Ollama tourne mais ne
 * répond pas / n'a pas de résultat.
 */
export async function runJournalExtraction(
  text: string,
  candidates: EntityRef[],
): Promise<JournalExtractionResult> {
  if (!text.trim()) return EMPTY_RESULT;

  const { baseUrl, model } = getAiSettings();
  if (!baseUrl?.trim() || !model?.trim()) return EMPTY_RESULT;

  const ollama = createOllamaClient({ baseUrl, defaultModel: model });
  const extractor = createActionExtractor({ ollama });

  const [mentions, actions] = await Promise.all([
    candidates.length > 0 ? extractor.extractEntityMentions(text, candidates) : Promise.resolve([]),
    extractor.extractActions(text),
  ]);

  return { mentions, actions };
}
