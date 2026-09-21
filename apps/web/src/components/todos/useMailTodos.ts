"use client";

/**
 * useMailTodos — les emails rangés dans un label `Todo/…` (cf. mail-eisenhower),
 * lus dans le mirror local et projetés en `TodoRowData` pour /todos. Rien sans
 * Gmail connecté ni coffre worker : la page n'affiche alors que ses todos.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSettings } from "@/components/settings";
import { useMailMirror } from "@/components/mail/useMailMirror";
import { useGmailConnected } from "@/hooks/useGmailConnected";
import { hasGmailToken, modifyThreadLabels, type GmailLabel, type ThreadListItem } from "@/lib/gmail";
import {
  QUADRANTS,
  applyLabelChange,
  ensureTodoLabels,
  quadrantOfLabels,
  resolveTodoLabelIds,
  todoLabelChange,
  todoLabelIdSet,
} from "@/lib/mail-eisenhower";
import { mirrorAvailable, mirrorListLabels, mirrorListThreads } from "@/lib/mail-mirror";
import { syncMailbox } from "@/lib/mail-sync";
import { INBOX_LABEL, actionToLabelOps } from "@/lib/mail-triage";
import { isWorkerReady } from "@/lib/trpc/browser-link";
import { importanceForAxis, type TodoRowData } from "./TodoRow";

const MAIL_ROW_PREFIX = "mail:";

export function mailThreadIdOf(rowId: string): string | null {
  return rowId.startsWith(MAIL_ROW_PREFIX) ? rowId.slice(MAIL_ROW_PREFIX.length) : null;
}

// Laisse la coche se dessiner avant que la ligne ne quitte la vue.
const DONE_LINGER_MS = 700;

export interface MailTodosApi {
  rows: TodoRowData[];
  markDone: (rowId: string) => void;
  move: (rowId: string, target: { urgent: boolean; important: boolean }) => void;
}

export function useMailTodos(onError: (message: string) => void): MailTodosApi {
  const { settings } = useSettings();
  const connected = useGmailConnected();
  const clientId = settings.googleDrive.clientId.trim();
  const accountId = settings.gmail.connectedEmail;
  const { commitMutation } = useMailMirror(clientId, accountId);

  const [workerReady, setWorkerReady] = useState(
    () => typeof window !== "undefined" && isWorkerReady(),
  );
  useEffect(() => {
    if (isWorkerReady()) setWorkerReady(true);
    const onReady = () => setWorkerReady(true);
    const onUnready = () => setWorkerReady(false);
    window.addEventListener("supernote:vault-ready", onReady);
    window.addEventListener("supernote:vault-unready", onUnready);
    return () => {
      window.removeEventListener("supernote:vault-ready", onReady);
      window.removeEventListener("supernote:vault-unready", onUnready);
    };
  }, []);

  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (!connected || !workerReady || !accountId || !mirrorAvailable()) {
      setThreads([]);
      return;
    }
    let cancelled = false;
    const read = async () => {
      const [items, ls] = await Promise.all([
        mirrorListThreads(accountId, { labelId: INBOX_LABEL, limit: 500 }),
        mirrorListLabels(accountId),
      ]);
      if (cancelled) return;
      setThreads(items);
      setLabels(ls);
    };
    void read().catch(() => {
      /* mirror illisible : la page reste sur ses seules todos */
    });
    // Hors geste utilisateur, un token froid ouvrirait une popup OAuth : on ne
    // resynchronise que si Gmail a déjà un token en cache.
    if (hasGmailToken(clientId)) {
      void syncMailbox(clientId, accountId)
        .then(read)
        .catch(() => {
          /* best-effort : le mirror déjà lu reste affiché */
        });
    }
    return () => {
      cancelled = true;
    };
  }, [connected, workerReady, clientId, accountId]);

  const todoLabelIds = useMemo(
    () => resolveTodoLabelIds(labels.map((l) => [l.id, l.name] as const)),
    [labels],
  );

  const rows = useMemo<TodoRowData[]>(() => {
    const out: Array<{ order: number; row: TodoRowData }> = [];
    for (const t of threads) {
      const q = quadrantOfLabels(t.labelIds, todoLabelIds);
      const order = QUADRANTS.findIndex((d) => d.id === q);
      const def = QUADRANTS[order];
      if (!def) continue;
      out.push({
        order,
        row: {
          id: MAIL_ROW_PREFIX + t.id,
          text: t.subject || "Email sans sujet",
          done: doneIds.has(t.id),
          sourceNoteId: null,
          line: null,
          blockId: null,
          startDate: null,
          dueDate: null,
          priority: null,
          importance: importanceForAxis(null, def.important),
          urgent: def.urgent,
          sourceThreadId: t.id,
          sourceFromName: t.from.name || t.from.email || null,
          sourceSummary: t.snippet || null,
        },
      });
    }
    return out.sort((a, b) => a.order - b.order).map((o) => o.row);
  }, [threads, todoLabelIds, doneIds]);

  const markDone = useCallback(
    (rowId: string) => {
      const thread = threads.find((t) => t.id === mailThreadIdOf(rowId));
      if (!thread || !clientId) return;
      // Même « Fait » que /mail : retrait des labels todo ET sortie de l'inbox.
      const todoIds = todoLabelIdSet(todoLabelIds);
      const removeLabelIds = [
        ...thread.labelIds.filter((l) => todoIds.has(l)),
        ...actionToLabelOps("done").removeLabelIds,
      ];
      setDoneIds((prev) => new Set(prev).add(thread.id));
      const timer = window.setTimeout(
        () => setThreads((prev) => prev.filter((t) => t.id !== thread.id)),
        DONE_LINGER_MS,
      );
      commitMutation({ threadId: thread.id, kind: "modifyLabels", removeLabelIds }, () =>
        modifyThreadLabels(clientId, thread.id, { removeLabelIds }),
      ).catch((err) => {
        window.clearTimeout(timer);
        setThreads((prev) => (prev.some((t) => t.id === thread.id) ? prev : [...prev, thread]));
        setDoneIds((prev) => {
          const next = new Set(prev);
          next.delete(thread.id);
          return next;
        });
        onError(`Email non marqué fait : ${err instanceof Error ? err.message : String(err)}`);
      });
    },
    [threads, clientId, todoLabelIds, commitMutation, onError],
  );

  const move = useCallback(
    (rowId: string, target: { urgent: boolean; important: boolean }) => {
      const thread = threads.find((t) => t.id === mailThreadIdOf(rowId));
      const quadrant = QUADRANTS.find(
        (d) => d.urgent === target.urgent && d.important === target.important,
      );
      if (!thread || !quadrant || !clientId) return;
      void (async () => {
        const todoLabels = await ensureTodoLabels(
          clientId,
          labels.map((l) => [l.id, l.name] as const),
        );
        const fresh = Object.values(todoLabels).filter((l) => !labels.some((k) => k.id === l.id));
        if (fresh.length > 0) setLabels((prev) => [...prev, ...fresh]);
        const change = todoLabelChange(todoLabels, quadrant.id);
        const patch = (labelIds: string[]) =>
          setThreads((prev) => prev.map((t) => (t.id === thread.id ? { ...t, labelIds } : t)));
        patch(applyLabelChange(thread.labelIds, change));
        try {
          await commitMutation({ threadId: thread.id, kind: "modifyLabels", ...change }, () =>
            modifyThreadLabels(clientId, thread.id, change),
          );
        } catch (err) {
          patch(thread.labelIds);
          throw err;
        }
      })().catch((err) => {
        onError(`Email non déplacé : ${err instanceof Error ? err.message : String(err)}`);
      });
    },
    [threads, labels, clientId, commitMutation, onError],
  );

  return { rows, markDone, move };
}
