"use client";

import { useEffect, useRef } from "react";
import { useSettings } from "@/components/settings/SettingsContext";
import { getThread, searchThreadsPage } from "@/lib/gmail";
import { isAiConfigured } from "@/lib/mail-ai";
import { isAiRuntimeAllowed } from "@/lib/ai/ai-runtime";
import { MAIL_SYNCED_EVENT } from "@/lib/mail-mirror";
import {
  analyzeAndSave,
  commitmentsEnabled,
  isStale,
  threadFingerprint,
} from "@/lib/mail-commitments";
import { useMailCommitments } from "./useMailCommitments";

const QUERY = "newer_than:14d (in:inbox OR in:sent) -in:chats";
const BATCH = 4;
const IDLE_MS = 60_000;
const COOLDOWN_MS = 60_000;

/** Passe de fond : fils récents reçus ET envoyés, analysés au repos, sur PC seulement. */
export function CommitmentsRunner() {
  const { settings } = useSettings();
  const clientId = settings.googleDrive.clientId.trim();
  const accountId = settings.gmail.connectedEmail;
  const { byThread } = useMailCommitments();
  const byThreadRef = useRef(byThread);
  byThreadRef.current = byThread;
  const selfRef = useRef<string[]>([]);
  selfRef.current = [accountId, ...settings.gmail.aliases];

  useEffect(() => {
    if (!clientId || !accountId) return undefined;
    let running = false;
    let cooldownUntil = 0;
    let lastInput = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const pass = async () => {
      if (running || document.hidden || Date.now() < cooldownUntil) return;
      if (!isAiRuntimeAllowed() || !isAiConfigured() || !commitmentsEnabled()) return;
      running = true;
      try {
        const page = await searchThreadsPage(clientId, QUERY, { maxResults: 30 });
        const stale = page.items
          .filter((t) => isStale(byThreadRef.current.get(t.id), threadFingerprint(t.snippet)))
          .slice(0, BATCH);
        for (const t of stale) {
          if (Date.now() - lastInput < 2_000) break;
          const thread = await getThread(clientId, t.id);
          await analyzeAndSave(thread, accountId, selfRef.current, threadFingerprint(t.snippet));
        }
      } catch {
        // Ollama éteint ou quota Gmail : on se tait une minute (le coupe-circuit Gmail fait le reste).
        cooldownUntil = Date.now() + COOLDOWN_MS;
      } finally {
        running = false;
      }
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void pass(), IDLE_MS);
    };
    const onInput = () => {
      lastInput = Date.now();
      schedule();
    };

    window.addEventListener(MAIL_SYNCED_EVENT, schedule);
    window.addEventListener("keydown", onInput, { passive: true });
    window.addEventListener("pointerdown", onInput, { passive: true });
    schedule();
    return () => {
      clearTimeout(timer);
      window.removeEventListener(MAIL_SYNCED_EVENT, schedule);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("pointerdown", onInput);
    };
  }, [clientId, accountId]);

  return null;
}
