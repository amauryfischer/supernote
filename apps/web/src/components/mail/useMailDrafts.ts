"use client";

/**
 * useMailDrafts — brouillons de réponse IA (colonne dédiée à droite du fil).
 *
 * Isolé de la page : détient les variantes générées, l'état « génération en
 * cours », l'option RAG « mes notes », et le reset au changement de fil.
 * L'injection du brouillon choisi dans la zone de réponse reste à l'appelant
 * (handle impératif d'`EmailThreadView`).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  draftReplyVariants,
  toMailAiThread,
  type MailAiThread,
  type ReplyVariant,
} from "@/lib/mail-ai";
import { pickReplyTo } from "@/lib/mail-reply";
import type { EmailThread } from "@/lib/gmail";

export interface MailDraftsApi {
  variants: ReplyVariant[];
  busy: boolean;
  error: string | null;
  useNotes: boolean;
  setUseNotes: (v: boolean) => void;
  generate: () => Promise<void>;
  clear: () => void;
  /** Fil courant converti pour les prompts (texte brut uniquement). */
  aiThread: MailAiThread | null;
}

export function useMailDrafts(
  thread: EmailThread | null,
  selfEmail: string,
  selfEmails: readonly string[],
): MailDraftsApi {
  const [variants, setVariants] = useState<ReplyVariant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useNotes, setUseNotes] = useState(false);

  const aiThread = useMemo<MailAiThread | null>(
    () => (thread ? toMailAiThread(thread, selfEmails) : null),
    [thread, selfEmails],
  );

  // Destinataire externe visé (« Nom <email> ») → oriente le brouillon vers lui,
  // pas vers un associé interne (cf. pickReplyTo).
  const recipientLabel = useMemo(() => {
    if (!thread) return "";
    const to = pickReplyTo(thread, selfEmail).toLowerCase();
    if (!to) return "";
    for (const m of thread.messages) {
      if (m.from.email.toLowerCase() === to) {
        return m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email;
      }
      const a = m.to.find((x) => x.email.toLowerCase() === to);
      if (a) return a.name ? `${a.name} <${a.email}>` : a.email;
    }
    return to;
  }, [thread, selfEmail]);

  const generate = useCallback(async () => {
    if (!aiThread || busy) return;
    setBusy(true);
    setVariants([]);
    setError(null);
    try {
      await draftReplyVariants(
        aiThread,
        { useNotes, ...(recipientLabel ? { recipient: recipientLabel } : {}) },
        (v) => setVariants((prev) => [...prev, v]),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ollama injoignable");
    } finally {
      setBusy(false);
    }
  }, [aiThread, busy, useNotes, recipientLabel]);

  const clear = useCallback(() => {
    setVariants([]);
    setError(null);
  }, []);

  // Pas de « fuite » d'un fil à l'autre.
  const threadId = thread?.id ?? null;
  useEffect(() => {
    setVariants([]);
    setBusy(false);
    setError(null);
  }, [threadId]);

  return { variants, busy, error, useNotes, setUseNotes, generate, clear, aiThread };
}
