/**
 * mail-assistant — questions en langage naturel sur SA PROPRE boîte.
 *
 * « Qu'est-ce que j'ai raté cette semaine ? », « où en est le devis Dupont ? ».
 * Le chemin est volontairement simple et vérifiable :
 *   1. on extrait des mots-clés de la question (et une éventuelle borne de
 *      date : « cette semaine », « hier »…) ;
 *   2. on interroge le MIRROR LOCAL — donc aucun email n'est envoyé nulle part
 *      pour chercher ;
 *   3. on donne au modèle LOCAL les quelques fils retenus, et on lui demande de
 *      répondre EN CITANT les objets utilisés.
 *
 * Les fils remontés sont affichés comme sources cliquables : une réponse d'IA
 * sur des emails ne vaut que si on peut aller vérifier dans le fil d'origine.
 *
 * Tout ce qui est calcul (mots-clés, fenêtre de temps, prompt) est PUR ;
 * l'appel réseau/mirror est isolé dans `askMailbox`.
 */

import { runLocalPrompt } from "./mail-ai";
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

/** Tronque un texte pour le prompt. PUR. */
function clip(text: string, max: number): string {
  const t = (text ?? "").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * Prompt de l'assistant. On impose de s'appuyer UNIQUEMENT sur les fils
 * fournis et de dire quand la réponse ne s'y trouve pas : un assistant de boîte
 * qui invente est pire qu'un assistant muet. PUR.
 */
export function buildAssistantPrompt(question: string, threads: readonly ThreadListItem[]): string {
  const corpus = threads
    .map((t, i) => {
      const who = t.from.name ? `${t.from.name} <${t.from.email}>` : t.from.email;
      return [
        `[${i + 1}] Objet : ${clip(t.subject, 160)}`,
        `    De : ${clip(who, 120)}`,
        `    Date : ${t.date}`,
        `    Extrait : ${clip(t.snippet, 400)}`,
      ].join("\n");
    })
    .join("\n\n");
  return [
    "Tu réponds à une question sur la boîte email de l'utilisateur.",
    "Tu ne disposes QUE des fils ci-dessous : n'invente aucun fait, aucune date, aucun nom.",
    "Si la réponse ne s'y trouve pas, dis-le clairement en une phrase.",
    "",
    "Fils disponibles :",
    corpus || "(aucun fil trouvé)",
    "",
    `Question : ${question}`,
    "",
    "Réponds en français, en 3 phrases maximum, et cite les numéros des fils utilisés entre crochets.",
  ].join("\n");
}

/** Réponse de l'assistant + les fils sur lesquels elle s'appuie. */
export interface MailboxAnswer {
  answer: string;
  sources: ThreadListItem[];
  /** Fenêtre de temps appliquée à la recherche, si détectée. */
  window: TimeWindow;
}

/** Nombre de fils injectés dans le prompt (budget de contexte d'un modèle local). */
const MAX_SOURCES = 6;

/**
 * Répond à une question sur la boîte. Recherche LOCALE (mirror) puis génération
 * LOCALE : rien ne sort de la machine.
 *
 * La recherche est dégressive : tous les mots-clés d'abord (précis), puis les
 * deux plus significatifs si ça ne ramène rien — une question formulée en
 * phrase ne doit pas renvoyer « je n'ai rien trouvé » pour une histoire de mot
 * en trop.
 */
export async function askMailbox(
  accountId: string,
  question: string,
  now: Date = new Date(),
): Promise<MailboxAnswer> {
  const window = detectTimeWindow(question, now);
  const keywords = extractKeywords(question);

  const search = (terms: string[]) =>
    mirrorSearchThreads(accountId, {
      terms,
      ...(window.after !== undefined ? { after: window.after } : {}),
      limit: MAX_SOURCES,
    });

  let sources: ThreadListItem[] = [];
  if (keywords.length > 0) {
    sources = await search(keywords);
    if (sources.length === 0 && keywords.length > 2) sources = await search(keywords.slice(0, 2));
    if (sources.length === 0 && keywords.length > 1) sources = await search([keywords[0]!]);
  }
  // Question sans mot-clé exploitable (« qu'est-ce que j'ai raté cette
  // semaine ? ») → les fils les plus récents de la fenêtre.
  if (sources.length === 0) {
    sources = await mirrorSearchThreads(accountId, {
      terms: [],
      ...(window.after !== undefined ? { after: window.after } : {}),
      limit: MAX_SOURCES,
    });
  }

  const answer = await runLocalPrompt(buildAssistantPrompt(question, sources), 0.2);
  return { answer, sources, window };
}
