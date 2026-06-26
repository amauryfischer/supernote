/**
 * mail-reply — helpers PURS pour répondre dans un fil Gmail : sujet « Re: »,
 * choix du destinataire, en-têtes de threading (In-Reply-To / References).
 * Aucune I/O ; l'envoi réel vit dans `gmail.ts` (`sendReply` / `createDraft`).
 */

import type { EmailThread, EmailMessage, EmailAddress } from "./gmail";
import { classifyBubble } from "./gmail";
import { dedupeEmails } from "./mail-recipients";

/** Préfixe « Re: » si absent (insensible à la casse, tolère les espaces). */
export function ensureRe(subject: string): string {
  const s = (subject ?? "").trim();
  if (!s) return "Re:";
  return /^re\s*:/i.test(s) ? s : `Re: ${s}`;
}

function lastMessage(thread: EmailThread): EmailMessage | undefined {
  return thread.messages[thread.messages.length - 1];
}

/**
 * « Externe » = ni moi, ni un collègue/associé du MÊME domaine que le compte
 * connecté (cf. `classifyBubble` → "external"). On répond à l'externe.
 */
function isExternal(email: string, selfEmail?: string): boolean {
  return !!email && classifyBubble(email, selfEmail) === "external";
}

/**
 * Destinataire d'une réponse simple. On vise l'INTERLOCUTEUR EXTERNE, pas un
 * associé/collègue de notre organisation (même domaine) :
 *  1. expéditeur externe le plus récent (la personne X qui nous écrit) ;
 *  2. sinon (c'est NOTRE côté — moi ou mon associé — qui a écrit à X), le
 *     destinataire externe le plus récent → on répond à X ;
 *  3. sinon (tout le monde est interne, ex. seulement mon associé et moi) :
 *     comportement classique = expéditeur du dernier message s'il n'est pas moi,
 *     sinon 1er destinataire ≠ moi.
 * "" si indéterminable. `selfEmail` absent → tout est « externe » (legacy).
 */
export function pickReplyTo(thread: EmailThread, selfEmail?: string): string {
  const last = lastMessage(thread);
  if (!last) return "";
  // 1. Expéditeur externe le plus récent.
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const from = thread.messages[i]!.from.email;
    if (isExternal(from, selfEmail)) return from;
  }
  // 2. Aucun expéditeur externe → destinataire externe le plus récent.
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const ext = thread.messages[i]!.to.find((a) => isExternal(a.email, selfEmail));
    if (ext) return ext.email;
  }
  // 3. Fil 100 % interne → fallback historique.
  const self = (selfEmail ?? "").toLowerCase();
  const from = last.from.email;
  if (from && from.toLowerCase() !== self) return from;
  const other = last.to.find((a) => a.email && a.email.toLowerCase() !== self);
  return other?.email ?? last.to[0]?.email ?? from ?? "";
}

/**
 * « Répondre à tous » : agrège TOUS les participants (From + To) de TOUT le fil,
 * sauf soi-même, dédupliqués (insensible à la casse). Le destinataire principal
 * (`to`) est celui de la réponse simple (`pickReplyTo`) ; tous les autres
 * participants passent en copie (`cc`). Si `pickReplyTo` est vide (fil sans
 * adresse exploitable), `to` reste "" et `cc` reprend tous les participants.
 * Pur, testable.
 */
export function pickReplyAll(
  thread: EmailThread,
  selfEmail?: string,
): { to: string; cc: string[] } {
  const self = (selfEmail ?? "").toLowerCase();
  const primary = pickReplyTo(thread, selfEmail);
  const primaryKey = primary.toLowerCase();
  // Collecte de toutes les adresses From/To du fil, dans l'ordre d'apparition.
  const all: EmailAddress[] = [];
  for (const m of thread.messages) {
    if (m.from) all.push(m.from);
    for (const a of m.to) all.push(a);
  }
  const everyone = dedupeEmails(all.map((a) => a.email)).filter((e) => {
    const k = e.toLowerCase();
    return k !== self && k !== primaryKey;
  });
  return { to: primary, cc: everyone };
}

/**
 * Corps cité d'un message pour une réponse : ligne d'attribution
 * « Le <date locale>, <nom ou email> a écrit : » puis chaque ligne du corps
 * préfixée « > ». Le corps est `bodyText` (sinon `snippet`). Date formatée en
 * locale via `toLocaleString` ; absente/illisible → omise. Pur, testable.
 */
export function buildQuotedBody(message: EmailMessage): string {
  const who = message.from.name || message.from.email || "?";
  const ts = message.date ? Date.parse(message.date) : NaN;
  const when = Number.isNaN(ts) ? "" : new Date(ts).toLocaleString();
  const attribution = when ? `Le ${when}, ${who} a écrit :` : `${who} a écrit :`;
  const source = message.bodyText || message.snippet || "";
  const quoted = source
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
  return `${attribution}\n${quoted}`;
}

/** En-têtes de threading dérivés du dernier message (vide si pas de Message-ID). */
export function replyHeaders(thread: EmailThread): { inReplyTo?: string; references?: string } {
  const last = lastMessage(thread);
  const mid = last?.messageId?.trim();
  if (!mid) return {};
  const prev = last?.references?.trim();
  return { inReplyTo: mid, references: prev ? `${prev} ${mid}` : mid };
}

export interface ReplyParams {
  threadId: string;
  to: string;
  subject: string;
  inReplyTo?: string;
  references?: string;
}

/** Paramètres complets d'une réponse threadée (sujet basé sur le 1ᵉʳ message). */
export function buildReplyParams(thread: EmailThread, selfEmail?: string): ReplyParams {
  return {
    threadId: thread.id,
    to: pickReplyTo(thread, selfEmail),
    subject: ensureRe(thread.messages[0]?.subject ?? ""),
    ...replyHeaders(thread),
  };
}
