/**
 * mail-summary — mini-résumés de fils générés par l'IA LOCALE (Ollama), pour la
 * LISTE d'emails.
 *
 * Le snippet Gmail affiché aujourd'hui sous l'objet est le début brut du corps :
 * souvent une salutation, un en-tête de newsletter ou un bloc de liens. Il ne dit
 * pas ce que l'email VEUT. Ici, une phrase d'une trentaine de mots dit l'intention
 * de l'expéditeur, à côté de l'objet — c'est ce qui permet de trancher sans ouvrir.
 *
 * Trois garde-fous assumés :
 *  - CACHE OBLIGATOIRE. Un résumé coûte un appel au modèle local ; sans cache, un
 *    simple retour sur /mail relancerait toute la boîte. Le cache est invalidé par
 *    l'empreinte du fil (sa date la plus récente change dès qu'un message arrive).
 *  - JAMAIS de HTML dans le prompt (corps text/plain uniquement, comme `mail-ai`).
 *  - Rien n'est deviné : sans corps exploitable on résume l'objet, et un fil dont
 *    le résumé échoue garde simplement son snippet Gmail.
 *
 * Tout ici est PUR sauf `summarizeForList` (appel Ollama) et les accès au cache.
 */

import { isSelfAddress, runLocalPrompt } from "./mail-ai";

/** Budget de mots d'un résumé de liste (la demande : « une trentaine de mots »). */
export const SUMMARY_MAX_WORDS = 30;

/** Corps total injecté dans le prompt, tous messages confondus. */
const MAX_BODY_CHARS = 1_500;
/** Corps max retenu par message (les plus récents priment). */
const MAX_MESSAGE_CHARS = 600;
/** Nombre de messages du fil sérialisés (les plus récents). */
const MAX_MESSAGES = 3;

// ── Sérialisation (pure) ────────────────────────────────────────────────────

/** Message minimal nécessaire au résumé (aucun HTML). */
export interface SummarizableMessage {
  from: { name: string; email: string };
  /** Corps text/plain. Vide accepté (on retombe sur le snippet). */
  bodyText: string;
  snippet?: string;
}

/** Fil minimal accepté par le builder de prompt. */
export interface SummarizableThread {
  subject: string;
  from: { name: string; email: string };
  /** Contenu texte du fil, déjà aplati. Peut être vide. */
  body: string;
  /** Adresses « à moi » (compte connecté + alias). */
  selfEmails?: readonly string[];
  /** Fil envoyé de moi à moi seul (cf. `isNoteToSelf`). */
  noteToSelf?: boolean;
}

/** Aplatit sur une ligne et borne la longueur. PUR. */
function clip(text: string, max: number): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
}

/**
 * Borne la longueur SANS aplatir : garde les sauts de ligne qui séparent les
 * messages du fil (un modèle lit mieux « un message par ligne » qu'un pavé). PUR.
 */
function cap(text: string, max: number): string {
  const t = (text ?? "").trim();
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
}

/**
 * Aplati les messages d'un fil en un texte brut borné : on garde les
 * `MAX_MESSAGES` plus récents, chacun tronqué, l'ensemble plafonné. Le corps
 * text/plain prime ; à défaut le snippet du message. PUR.
 */
export function buildThreadBody(
  messages: readonly SummarizableMessage[],
  selfEmails?: readonly string[],
): string {
  const recent = messages.slice(-MAX_MESSAGES);
  const parts: string[] = [];
  for (const m of recent) {
    const raw = m.bodyText?.trim() || m.snippet?.trim() || "";
    if (!raw) continue;
    const who = isSelfAddress(m.from?.email ?? "", selfEmails)
      ? "Moi"
      : m.from?.name?.trim() || m.from?.email?.trim() || "";
    const text = clip(raw, MAX_MESSAGE_CHARS);
    parts.push(who ? `${who} : ${text}` : text);
  }
  return cap(parts.join("\n"), MAX_BODY_CHARS);
}

/**
 * Prompt de mini-résumé. Deux exigences qui font la différence avec un petit
 * modèle local : interdire les formules d'annonce (« Cet email parle de… »), qui
 * mangent un tiers du budget de mots, et imposer une réponse d'UNE phrase, sans
 * quoi le modèle rend une liste à puces inutilisable sur une ligne. PUR.
 */
export function buildListSummaryPrompt(thread: SummarizableThread): string {
  const fromSelf = isSelfAddress(thread.from.email, thread.selfEmails);
  const name = thread.from.name?.trim() || thread.from.email?.trim() || "(inconnu)";
  const sender = fromSelf ? `moi (${name})` : name;
  const body = thread.body.trim();
  const intent = thread.noteToSelf
    ? "- c'est une note que je me suis envoyée à moi-même : dis ce que je dois retenir ou faire ;"
    : fromSelf
      ? "- c'est moi qui écris : dis ce que je demande ou annonce, et à qui ; les lignes « Moi » sont les miennes ;"
      : "- dis ce que l'expéditeur demande, annonce ou attend de moi ; les lignes « Moi » sont les miennes ;";
  return [
    "Tu résumes un email pour l'afficher dans une liste de boîte de réception.",
    "",
    "Email :",
    `Expéditeur : ${clip(sender, 120)}`,
    `Objet : ${clip(thread.subject, 200) || "(sans objet)"}`,
    body ? `Contenu :\n${body}` : "Contenu : (indisponible — résume l'objet)",
    "",
    "Contraintes :",
    `- ${SUMMARY_MAX_WORDS} mots maximum, UNE seule phrase, en français ;`,
    intent,
    "- n'écris pas « cet email », « ce message », « l'expéditeur » : va droit au fait ;",
    "- n'invente aucune information absente du contenu ;",
    "- pas de guillemets, pas de liste, pas de commentaire de ta part ;",
    "- réponds uniquement par le résumé.",
  ].join("\n");
}

/** Tronque un texte à `max` mots, avec un marqueur explicite si coupé. PUR. */
export function clipWords(text: string, max: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return `${words.slice(0, max).join(" ")}…`;
}

/**
 * Lit la réponse du modèle. Tolérant : un petit modèle préfixe volontiers son
 * résumé (« Résumé : », un tiret, une phrase d'annonce terminée par « : »). On
 * retient la première ligne qui ressemble à une phrase, puis on borne à
 * `SUMMARY_MAX_WORDS`. Chaîne vide = pas de résumé exploitable. PUR.
 */
export function parseListSummary(raw: string): string {
  const lines = (raw ?? "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^```.*$/, "")
        .replace(/^[-*•]\s*/, "")
        .replace(/^\d+[.)]\s*/, "")
        .replace(/^(r[ée]sum[ée]|summary)\s*:\s*/i, "")
        .replace(/^["«“\s]+|["»”\s]+$/g, "")
        .trim(),
    )
    .filter((line) => line.length > 0 && !line.endsWith(":"));
  // Une ligne trop courte est un reliquat de préambule, pas un résumé.
  const picked = lines.find((line) => line.length >= 15) ?? lines[0] ?? "";
  return clipWords(picked.replace(/\s+/g, " ").trim(), SUMMARY_MAX_WORDS);
}

/** Résume un fil via l'IA locale. Lève si Ollama est injoignable. */
export async function summarizeForList(thread: SummarizableThread): Promise<string> {
  const raw = await runLocalPrompt(buildListSummaryPrompt(thread), 0.2);
  return parseListSummary(raw);
}

// ── Cache : résumés stockés sur mail_thread (SQLite + entity sync) ─────────
// Plus de localStorage — les résumés vivent dans les colonnes aiSummary /
// aiSummaryFp / aiSummaryAt de mail_thread, synchronisées entre devices via
// l'entity email_ai_cache.

/**
 * Empreinte d'un fil : sa date la plus récente. Dès qu'un message arrive, la
 * date bouge et le résumé en cache devient caduc — exactement la granularité
 * voulue (un fil inchangé n'est jamais re-résumé). PUR.
 */
export function threadFingerprint(item: { date: string }): string {
  return item.date ?? "";
}

/** Résumé déjà stocké sur l'item, si l'empreinte correspond toujours. PUR. */
export function cachedSummary(
  item: { date: string; aiSummary?: string | null; aiSummaryFp?: string | null },
): string | undefined {
  if (!item.aiSummary || !item.aiSummaryFp) return undefined;
  if (item.aiSummaryFp !== threadFingerprint(item)) return undefined;
  return item.aiSummary;
}

/**
 * Fils restant à résumer : pas de résumé à jour, et pas déjà tentés en échec
 * pendant cette session. PUR.
 */
export function pendingForSummary<
  T extends { id: string; date: string; aiSummary?: string | null; aiSummaryFp?: string | null },
>(items: readonly T[], failed: ReadonlySet<string>): T[] {
  return items.filter((it) => !failed.has(it.id) && cachedSummary(it) === undefined);
}

/** @deprecated Conservée pour la migration one-shot (vidage localStorage). */
export function clearSummaryCacheLegacy(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem("supernote.mail.listSummaries.v2");
  } catch { /* best-effort */ }
}
