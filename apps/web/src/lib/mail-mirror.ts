/**
 * mail-mirror — client access to the local Gmail mirror (vault worker tables).
 *
 * Thin wrappers over the `mail.*` tRPC procedures plus an availability guard.
 * The mirror lives in the vault SQLite DB, so it's only usable when a worker
 * backend is mounted AND ready (local / git / cloud vault). In "mode limité"
 * (no vault) the caller falls back to live Gmail fetches — see page.tsx.
 *
 * Row shapes returned by the mirror are intentionally structurally identical to
 * `gmail.ts`'s `ThreadListItem` / `EmailThread` / `EmailMessage`, so no mapping
 * is needed at the call sites.
 */

import { trpcVanillaClient, hasWorkerBackend } from "@/lib/trpc/client";
import { isWorkerReady } from "@/lib/trpc/browser-link";
import type { ThreadListItem, EmailThread, GmailLabel } from "@/lib/gmail";

/** True when the local mirror can be read/written (worker mounted + ready). */
export function mirrorAvailable(): boolean {
  return typeof window !== "undefined" && hasWorkerBackend() && isWorkerReady();
}

/** Generate an idempotent outbox op id (matches the worker's opId column). */
function newOpId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `op_${Date.now()}_${Math.round(Math.random() * 1e9)}`;
}

export interface MirrorThreadFilter {
  labelId?: string;
  isUnread?: boolean;
  isStarred?: boolean;
  limit?: number;
  offset?: number;
}

/** Read mirrored thread summaries for the list view (already ThreadListItem-shaped). */
export async function mirrorListThreads(
  accountId: string,
  filter: MirrorThreadFilter = {},
): Promise<ThreadListItem[]> {
  const res = await trpcVanillaClient.mail.listThreads.query({ accountId, ...filter });
  return res.items;
}

/** Read mirrored Gmail labels (GmailLabel-shaped). */
export async function mirrorListLabels(accountId: string): Promise<GmailLabel[]> {
  const res = await trpcVanillaClient.mail.getLabels.query({ accountId });
  return res.labels;
}

/**
 * Read a mirrored thread's messages. Returns null when the thread isn't
 * mirrored yet, or `{ thread, complete }` — `complete=false` means only the
 * summary is cached (messages not fetched), so the caller should background-sync
 * the full thread.
 */
export async function mirrorGetThread(
  accountId: string,
  threadId: string,
): Promise<{ thread: EmailThread; complete: boolean } | null> {
  const res = await trpcVanillaClient.mail.getThread.query({ accountId, threadId });
  if (!res.thread) return null;
  const { id, messages, labelIds, complete } = res.thread;
  return { thread: { id, messages, labelIds }, complete };
}

export interface MirrorMutation {
  threadId: string;
  /** Pusher kind: "modifyLabels" | "trash" | "untrash". */
  kind: string;
  addLabelIds?: string[];
  removeLabelIds?: string[];
  /** Remove the thread from the mirror entirely (archive/trash leaving the list). */
  dropThread?: boolean;
  /**
   * Enqueue an outbox op (default true). Pass false to patch the mirror only,
   * when the UI itself issues the direct Gmail call (avoids double-push).
   */
  enqueue?: boolean;
}

/**
 * Optimistically apply a label change to the mirror AND enqueue an outbox op for
 * the background pusher. Returns the generated opId. Atomic worker-side.
 */
export async function mirrorApplyMutation(
  accountId: string,
  m: MirrorMutation,
): Promise<string> {
  const opId = newOpId();
  await trpcVanillaClient.mail.applyLocalMutation.mutate({
    accountId,
    opId,
    threadId: m.threadId,
    kind: m.kind,
    addLabelIds: m.addLabelIds ?? [],
    removeLabelIds: m.removeLabelIds ?? [],
    dropThread: m.dropThread,
    enqueue: m.enqueue ?? true,
  });
  return opId;
}
