import { createActionExtractor, createOllamaClient, findNewPersonCandidates } from "@supernote/ai";
import type {
  EntityRef,
  ExtractedAction,
  MentionMatch,
  PersonCandidate,
} from "@supernote/ai";
import { DAILY_JOURNAL } from "@supernote/templates";
import { getAiSettings } from "./settings";
import { isAiRuntimeAllowed } from "./ai-runtime";

export interface JournalExtractionResult {
  mentions: MentionMatch[];
  actions: ExtractedAction[];
  /** Noms de personnes cités mais absents du coffre. */
  people: PersonCandidate[];
  /** Longueur du texte réellement soumis au modèle (gabarit retiré). */
  analysedLength: number;
}

/** Toujours un objet neuf : la fonction est rejouable, un singleton partagé
 *  se ferait muter par un appelant et empoisonnerait les appels suivants. */
function emptyResult(): JournalExtractionResult {
  return { mentions: [], actions: [], people: [], analysedLength: 0 };
}

/**
 * Une ligne du gabarit du jour, en motif : la date interpolée change chaque
 * jour, seule la partie littérale est comparable. `- [ ]` vide en fait partie —
 * pas les cases que l'utilisateur remplit ensuite.
 */
const TEMPLATE_LINE_PATTERNS: RegExp[] = DAILY_JOURNAL.body
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && line !== "{{cursor}}")
  .map((line) => {
    const source = line
      .split(/\{\{[^}]*\}\}/g)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${source}$`);
  });

/**
 * Le gabarit d'une journée est du texte, mais personne ne l'a écrit : laissé
 * en place, il faisait proposer « ## Personnes croisées » comme tâche sur une
 * entrée vierge. Retiré ligne à ligne — jamais par troncature, une ligne du
 * corps peut ressembler à une ligne de gabarit sans en être une.
 */
export function stripDailyTemplate(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return true;
      return !TEMPLATE_LINE_PATTERNS.some((re) => re.test(trimmed));
    })
    .join("\n");
}

/** Au moins quelques caractères de vraie prose — sinon rien à analyser. */
function hasSubstance(markdown: string): boolean {
  return markdown.replace(/[^\p{L}\p{N}]/gu, "").length >= 3;
}

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
  if (!isAiRuntimeAllowed()) return emptyResult();
  if (!text.trim()) return emptyResult();

  // Les offsets rendus portent sur CE texte-ci, pas sur `text` : le consommateur
  // relocalise déjà toute mention sur `matchedText` avant d'écrire.
  const analysable = stripDailyTemplate(text);
  if (!hasSubstance(analysable)) return emptyResult();

  const { baseUrl, model } = getAiSettings();
  if (!model?.trim()) return emptyResult();

  const ollama = createOllamaClient({ baseUrl, defaultModel: model });
  const extractor = createActionExtractor({ ollama });

  const [mentions, actions] = await Promise.all([
    extractor.extractEntityMentions(analysable, candidates),
    extractor.extractActions(analysable),
  ]);

  return {
    mentions,
    actions,
    people: findNewPersonCandidates(analysable, candidates),
    analysedLength: analysable.length,
  };
}
