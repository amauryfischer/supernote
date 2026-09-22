"use client";

/**
 * useMailSummaries — passe de mini-résumés IA pour la liste d'emails.
 *
 * Même posture que `useMailAutoLabel` : petits lots, en série (un modèle local
 * sérialise de toute façon ses requêtes), déclenchés après stabilisation de la
 * liste. Chaque résumé prêt est publié immédiatement — la liste se remplit fil
 * par fil au lieu d'attendre le lot entier.
 *
 * Le corps du fil vient du MIROIR LOCAL (`mirrorGetThread`) : aucun appel Gmail
 * n'est ajouté par la fonctionnalité, donc aucun quota consommé. Quand le fil
 * n'est pas encore mirroré, on résume le snippet — moins bon, mais jamais faux.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ThreadListItem } from "@/lib/gmail";
import { mirrorAvailable, mirrorGetThread, mirrorSetAiSummary } from "@/lib/mail-mirror";
import { isNoteToSelf } from "@/lib/mail-ai";
import {
  buildThreadBody,
  cachedSummary,
  pendingForSummary,
  summarizeForList,
  threadFingerprint,
} from "@/lib/mail-summary";

/** Fils résumés par passe (borne le coût d'un premier chargement). */
const BATCH = 6;
/** Délai d'inactivité avant une passe automatique. */
const IDLE_MS = 2500;
/** Après un échec (Ollama coupé), on laisse respirer avant de réessayer. */
const COOLDOWN_MS = 60_000;

/** Identité stable pour le cas « réglage coupé » (évite un rendu par render). */
const EMPTY_SUMMARIES: ReadonlyMap<string, string> = new Map();

export interface UseMailSummariesOptions {
  enabled: boolean;
  /** Compte Gmail mirroré (vide → on résume les snippets). */
  accountId: string;
  /** Adresses « à moi » (compte connecté + alias). */
  selfEmails: readonly string[];
  /** Fils de la boîte, dans l'ordre affiché. */
  items: ThreadListItem[];
}

export interface UseMailSummariesResult {
  /** threadId → résumé (≈30 mots). Absent = pas encore résumé. */
  summaries: ReadonlyMap<string, string>;
  busy: boolean;
  /** Fils encore sans résumé. */
  remaining: number;
  /** Dernier échec d'appel à l'IA locale (null après une réussite). */
  error: string | null;
  /** Lance une passe sans attendre (et réessaye les fils en échec). */
  runNow: () => void;
}

export function useMailSummaries({
  enabled,
  accountId,
  selfEmails,
  items,
}: UseMailSummariesOptions): UseMailSummariesResult {
  const [summaries, setSummaries] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  /** Fils dont le résumé a échoué : on ne les repropose pas en boucle. */
  const failedRef = useRef<Set<string>>(new Set());
  /** Fin du délai de garde après un échec réseau (0 = pas de garde). */
  const cooldownUntilRef = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Hydratation depuis les colonnes AI de mail_thread (arrivées via listThreads).
  useEffect(() => {
    if (!enabled) return;
    setSummaries((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const it of items) {
        const hit = cachedSummary(it);
        if (hit !== undefined && next.get(it.id) !== hit) {
          next.set(it.id, hit);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [enabled, items]);

  /** Corps du fil, miroir d'abord ; snippet en repli. Jamais d'appel Gmail. */
  const resolveBody = useCallback(
    async (item: ThreadListItem): Promise<{ body: string; noteToSelf: boolean }> => {
      if (mirrorAvailable() && accountId) {
        try {
          const cached = await mirrorGetThread(accountId, item.id);
          if (cached && cached.thread.messages.length > 0) {
            const messages = cached.thread.messages;
            const body = buildThreadBody(messages, selfEmails);
            if (body) return { body, noteToSelf: isNoteToSelf(messages, selfEmails) };
          }
        } catch {
          /* miroir indisponible → snippet */
        }
      }
      return { body: item.snippet, noteToSelf: false };
    },
    [accountId, selfEmails],
  );

  const run = useCallback(async () => {
    if (runningRef.current) return;
    if (Date.now() < cooldownUntilRef.current) return;
    const pending = pendingForSummary(
      itemsRef.current,
      failedRef.current,
    ).slice(0, BATCH);
    if (pending.length === 0) return;

    runningRef.current = true;
    setBusy(true);
    const useMirror = mirrorAvailable();
    try {
      for (const item of pending) {
        let text: string;
        try {
          text = await summarizeForList({
            subject: item.subject,
            from: item.from,
            selfEmails,
            ...(await resolveBody(item)),
          });
        } catch (err) {
          cooldownUntilRef.current = Date.now() + COOLDOWN_MS;
          const message = err instanceof Error ? err.message : String(err);
          errorRef.current = message;
          setError(message);
          break;
        }
        errorRef.current = null;
        setError(null);
        if (!text) {
          failedRef.current.add(item.id);
          continue;
        }
        setSummaries((prev) => new Map(prev).set(item.id, text));
        if (useMirror && accountId) {
          try {
            await mirrorSetAiSummary(accountId, item.id, text, threadFingerprint(item));
          } catch { /* best-effort */ }
        }
      }
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }, [resolveBody, selfEmails, accountId]);

  /** Passe manuelle : réessaye aussi les fils en échec. */
  const runNow = useCallback(() => {
    failedRef.current = new Set();
    cooldownUntilRef.current = 0;
    void run();
  }, [run]);

  // Passe automatique après stabilisation de la liste, puis en chaîne tant
  // qu'il reste des fils (le lot est borné, pas la boîte).
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setTimeout(() => void run(), IDLE_MS);
    return () => clearTimeout(id);
  }, [enabled, items, busy, run]);

  const remaining = enabled
    ? items.reduce((n, it) => (summaries.has(it.id) ? n : n + 1), 0)
    : 0;

  // Réglage coupé → la liste retrouve immédiatement ses snippets Gmail (on ne
  // vide pas la map : rallumer le réglage réaffiche les résumés sans recalcul).
  return { summaries: enabled ? summaries : EMPTY_SUMMARIES, busy, remaining, error, runNow };
}
