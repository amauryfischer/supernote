/**
 * mail-assistant — recherche des fils du miroir local à partir d'une question
 * en langage naturel (« qu'est-ce que j'ai raté cette semaine ? »). Sert
 * l'outil `searchMail` de l'assistant /ai : aucun email ne part sur le réseau.
 */

import { mirrorSearchThreads } from "./mail-mirror";
import type { ThreadListItem } from "./gmail";

/** Mots vides français/anglais : bruit pur pour une recherche par mots-clés. */
const STOP_WORDS = new Set([
  "le","la","les","un","une","des","de","du","au","aux","et","ou","à","a","en","dans","sur","pour",
  "par","avec","sans","que","qui","quoi","quel","quelle","quels","quelles","est","sont","été","être",
  "ai","as","ont","avons","avez","je","tu","il","elle","on","nous","vous","ils","elles","mon","ma",
  "mes","ton","ta","tes","son","sa","ses","notre","votre","leur","leurs","ce","cet","cette","ces",
  "me","moi","se","y","ne","pas","plus","moins","tout","tous","toute","toutes","dernier","derniers",
  "dernière","dernières","quoi","comment","pourquoi","quand","où","ou","the","of","to","and","in",
  "is","are","was","were","my","me","i","what","when","where","who","how","about","from","for",
  "email","emails","mail","mails","message","messages","fil","fils",
]);

/** Fenêtre de temps déduite de la question (borne basse, epoch ms). */
export interface TimeWindow {
  after?: number;
  /** Libellé lisible de la fenêtre, pour l'afficher dans l'UI. */
  label?: string;
}

/** Début de journée, `days` jours avant `now`. PUR. */
function daysAgo(days: number, now: Date): number {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Déduit une fenêtre de temps des formulations courantes. Rien de reconnu →
 * pas de borne (toute la boîte mirrorée). PUR (horloge injectée).
 */
export function detectTimeWindow(question: string, now: Date = new Date()): TimeWindow {
  const q = question.toLowerCase();
  if (/\b(aujourd'hui|aujourdhui|today)\b/.test(q)) {
    return { after: daysAgo(0, now), label: "aujourd'hui" };
  }
  if (/\b(hier|yesterday)\b/.test(q)) return { after: daysAgo(1, now), label: "depuis hier" };
  if (/\b(cette semaine|this week|ces jours)\b/.test(q)) {
    return { after: daysAgo(7, now), label: "sur 7 jours" };
  }
  if (/\b(ce mois|this month|30 jours)\b/.test(q)) {
    return { after: daysAgo(30, now), label: "sur 30 jours" };
  }
  return {};
}

/**
 * Mots-clés retenus d'une question : mots de plus de 2 caractères, hors mots
 * vides, dédoublonnés, au plus 6 (au-delà, la recherche ne ramène plus rien
 * puisque les termes sont cumulatifs). PUR.
 */
export function extractKeywords(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@._-]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 6);
}

/** Fils renvoyés par défaut (budget de contexte d'un modèle local). */
const MAX_SOURCES = 6;

/**
 * Fils du miroir local pertinents pour une question : mots-clés, repli sur
 * moins de mots, puis les plus récents de la fenêtre si rien ne ressort.
 */
export async function findMailThreads(
  accountId: string,
  question: string,
  limit = MAX_SOURCES,
  now: Date = new Date(),
): Promise<{ sources: ThreadListItem[]; window: TimeWindow }> {
  const window = detectTimeWindow(question, now);
  const keywords = extractKeywords(question);

  const search = (terms: string[]) =>
    mirrorSearchThreads(accountId, {
      terms,
      ...(window.after !== undefined ? { after: window.after } : {}),
      limit,
    });

  let sources: ThreadListItem[] = [];
  if (keywords.length > 0) {
    sources = await search(keywords);
    if (sources.length === 0 && keywords.length > 2) sources = await search(keywords.slice(0, 2));
    if (sources.length === 0 && keywords.length > 1) sources = await search([keywords[0]!]);
  }
  // Question sans mot-clé exploitable (« qu'est-ce que j'ai raté cette
  // semaine ? ») → les fils les plus récents de la fenêtre.
  if (sources.length === 0) sources = await search([]);
  return { sources, window };
}
