/**
 * mail-outgoing — file d'envoi différé : « Annuler l'envoi » et « Envoyer plus tard ».
 *
 * Pourquoi une file plutôt qu'un envoi direct : une fois `messages.send` parti
 * chez Gmail, plus rien n'est rattrapable. On retarde donc le départ réel de
 * quelques secondes (réglage `undoSendSeconds`) — le message est en file, pas
 * chez le destinataire — et le même mécanisme sert l'envoi programmé à une date
 * choisie.
 *
 * La file est PERSISTÉE (localStorage) : fermer l'onglet pendant la fenêtre
 * d'annulation ne perd pas le message, il partira à la prochaine ouverture.
 * C'est aussi la limite honnête du procédé : sans l'app ouverte, rien ne part à
 * l'heure dite — un envoi programmé part à la première ouverture qui suit
 * l'échéance, et l'UI le dit.
 *
 * Les pièces jointes voyagent en base64 dans la file. Au-delà de
 * `MAX_QUEUED_BYTES`, on refuse la mise en file (`queueTooLarge`) et l'appelant
 * envoie immédiatement plutôt que de saturer le stockage du navigateur.
 */

import type { OutgoingAttachment } from "./gmail";

const KEY = "supernote.mail.outgoing";

/** Au-delà, on n'écrit pas dans localStorage (quota ~5 Mo tous usages). */
export const MAX_QUEUED_BYTES = 1_500_000;

/** Nombre de tentatives réseau avant de marquer l'envoi en échec. */
export const MAX_ATTEMPTS = 5;

/** Émis à chaque changement de la file (badge, liste des envois programmés). */
export const MAIL_OUTGOING_EVENT = "supernote:mail-outgoing";

export interface OutgoingMessage {
  id: string;
  /** `reply` porte threadId / inReplyTo ; `message` est un envoi hors fil. */
  kind: "message" | "reply";
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  html?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: OutgoingAttachment[];
  /** Date de départ réel (epoch ms). */
  sendAt: number;
  createdAt: number;
  attempts: number;
  lastError?: string;
  /** Vrai quand les tentatives sont épuisées : plus de départ automatique. */
  failed?: boolean;
}

function emit(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MAIL_OUTGOING_EVENT));
  }
}

/** Identifiant d'envoi. */
export function newOutgoingId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `out_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

/** Lit la file. Tolérant : contenu illisible → file vide. */
export function loadOutgoing(): OutgoingMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is OutgoingMessage =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as OutgoingMessage).id === "string" &&
        typeof (v as OutgoingMessage).sendAt === "number",
    );
  } catch {
    return [];
  }
}

function writeOutgoing(items: OutgoingMessage[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items));
    emit();
    return true;
  } catch {
    return false;
  }
}

/** Taille approximative d'un envoi une fois sérialisé. PUR. */
export function outgoingSize(msg: Omit<OutgoingMessage, "id" | "createdAt" | "attempts">): number {
  try {
    return JSON.stringify(msg).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** L'envoi est-il trop volumineux pour la file (→ envoi immédiat) ? PUR. */
export function queueTooLarge(
  msg: Omit<OutgoingMessage, "id" | "createdAt" | "attempts">,
): boolean {
  return outgoingSize(msg) > MAX_QUEUED_BYTES;
}

/**
 * Met un message en file. Renvoie son id, ou `null` si l'écriture a échoué
 * (quota) — l'appelant envoie alors immédiatement plutôt que de perdre le
 * message.
 */
export function enqueueOutgoing(
  msg: Omit<OutgoingMessage, "id" | "createdAt" | "attempts">,
): string | null {
  const entry: OutgoingMessage = {
    ...msg,
    id: newOutgoingId(),
    createdAt: Date.now(),
    attempts: 0,
  };
  const ok = writeOutgoing([...loadOutgoing(), entry]);
  return ok ? entry.id : null;
}

/** Retire un envoi de la file (annulation). Vrai s'il y était encore. */
export function cancelOutgoing(id: string): boolean {
  const all = loadOutgoing();
  const next = all.filter((m) => m.id !== id);
  if (next.length === all.length) return false;
  writeOutgoing(next);
  return true;
}

/** L'envoi est-il encore en file (donc annulable) ? */
export function isPending(id: string): boolean {
  return loadOutgoing().some((m) => m.id === id);
}

/** Envois dont l'heure est venue et qui ne sont pas en échec définitif. PUR. */
export function dueOutgoing(nowMs: number, items = loadOutgoing()): OutgoingMessage[] {
  return items.filter((m) => !m.failed && m.sendAt <= nowMs);
}

/** Envois encore à venir (programmés), les plus proches d'abord. PUR. */
export function scheduledOutgoing(nowMs: number, items = loadOutgoing()): OutgoingMessage[] {
  return items.filter((m) => !m.failed && m.sendAt > nowMs).sort((a, b) => a.sendAt - b.sendAt);
}

/** Envois en échec définitif (à reprendre à la main). PUR. */
export function failedOutgoing(items = loadOutgoing()): OutgoingMessage[] {
  return items.filter((m) => m.failed);
}

/** Marque une tentative ratée (échec définitif au-delà de `MAX_ATTEMPTS`). */
export function recordFailure(id: string, error: string): void {
  writeOutgoing(
    loadOutgoing().map((m) =>
      m.id === id
        ? {
            ...m,
            attempts: m.attempts + 1,
            lastError: error,
            failed: m.attempts + 1 >= MAX_ATTEMPTS,
            // Backoff simple : on re-tente un peu plus tard, pas en boucle.
            sendAt: Date.now() + Math.min(60_000, 2 ** m.attempts * 2_000),
          }
        : m,
    ),
  );
}

/** Remet un envoi échoué en file, tout de suite. */
export function retryOutgoing(id: string): void {
  writeOutgoing(
    loadOutgoing().map((m) =>
      m.id === id ? { ...m, failed: false, attempts: 0, sendAt: Date.now() } : m,
    ),
  );
}

/** Reprogramme un envoi en attente à une nouvelle date. */
export function rescheduleOutgoing(id: string, sendAt: number): void {
  writeOutgoing(loadOutgoing().map((m) => (m.id === id ? { ...m, sendAt } : m)));
}
