import { useCallback, useEffect, useMemo, useRef } from "react";
import { trpc } from "@/lib/trpc/client";
import type { EmailThread } from "@/lib/gmail";
import { isAiConfigured } from "@/lib/mail-ai";
import { isAiRuntimeAllowed } from "@/lib/ai/ai-runtime";
import {
  MAIL_COMMITMENTS_EVENT,
  MAIL_COMMITMENT_TYPE_ID,
  analyzeAndSave,
  commitmentsEnabled,
  fromEntity,
  isStale,
  threadFingerprint,
  type ThreadCommitments,
} from "@/lib/mail-commitments";

export function useMailCommitments() {
  // Les écritures d'un autre appareil n'invalident pas les requêtes : le poll local est gratuit (worker).
  const query = trpc.entities.list.useQuery(
    { typeId: MAIL_COMMITMENT_TYPE_ID, limit: 1000 },
    { refetchInterval: 60_000 },
  );
  const { refetch } = query;
  useEffect(() => {
    const on = () => void refetch();
    window.addEventListener(MAIL_COMMITMENTS_EVENT, on);
    return () => window.removeEventListener(MAIL_COMMITMENTS_EVENT, on);
  }, [refetch]);

  const all = useMemo(
    () => (query.data?.items ?? []).map(fromEntity).filter((x): x is ThreadCommitments => x !== null),
    [query.data],
  );
  const byThread = useMemo(() => new Map(all.map((tc) => [tc.threadId, tc])), [all]);
  const refresh = useCallback(() => void refetch(), [refetch]);
  return { all, byThread, refresh };
}

export function useThreadCommitments(
  thread: EmailThread | null,
  accountId: string,
  selfEmails: readonly string[],
): ThreadCommitments | undefined {
  const { byThread } = useMailCommitments();
  const current = thread ? byThread.get(thread.id) : undefined;
  const inFlight = useRef<string | null>(null);
  const last = thread?.messages[thread.messages.length - 1];
  const fp = last ? threadFingerprint(last.snippet) : "";

  useEffect(() => {
    if (!thread || !last || !accountId) return;
    if (!isAiRuntimeAllowed() || !isAiConfigured() || !commitmentsEnabled()) return;
    if (!isStale(current, fp) || inFlight.current === `${thread.id}:${fp}`) return;
    inFlight.current = `${thread.id}:${fp}`;
    void analyzeAndSave(thread, accountId, selfEmails, fp).catch(() => {
      // Ollama injoignable : rien à afficher ; le runner retentera après son cooldown.
    });
  }, [thread, last, accountId, selfEmails, current, fp]);

  return current;
}
