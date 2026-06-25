/**
 * mail-reply — helpers PURS pour répondre dans un fil Gmail : sujet « Re: »,
 * choix du destinataire, en-têtes de threading (In-Reply-To / References).
 * Aucune I/O ; l'envoi réel vit dans `gmail.ts` (`sendReply` / `createDraft`).
 */

import type { EmailThread, EmailMessage } from "./gmail";

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
 * Destinataire d'une réponse simple : l'expéditeur du dernier message s'il n'est
 * pas « moi » ; sinon (dernier message envoyé par moi) le premier destinataire
 * de ce message qui n'est pas moi. "" si indéterminable.
 */
export function pickReplyTo(thread: EmailThread, selfEmail?: string): string {
  const self = (selfEmail ?? "").toLowerCase();
  const last = lastMessage(thread);
  if (!last) return "";
  const from = last.from.email;
  if (from && from.toLowerCase() !== self) return from;
  const other = last.to.find((a) => a.email && a.email.toLowerCase() !== self);
  return other?.email ?? last.to[0]?.email ?? from ?? "";
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
