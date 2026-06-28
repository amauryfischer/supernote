/**
 * mail-sync — reconciliation engine between the local Gmail mirror and Gmail.
 *
 * Gmail is the source of truth. This engine keeps the mirror tables in step:
 *
 *  - fullSync       — seed the inbox + labels, stamp the account historyId cursor.
 *  - incrementalSync — pull deltas via history.list since the stored historyId,
 *                      re-fetch only the touched threads, upsert. Falls back to
 *                      a full sync when the historyId expired (404).
 *  - syncThreadDetail — fetch + mirror a single thread's full message set.
 *  - flushOutbox    — push pending optimistic mutations to Gmail, then ack/fail.
 *  - syncMailbox    — the orchestrator: flush outbox, then pull (incremental or full).
 *
 * Network I/O reuses gmail.ts primitives; persistence goes through the mail.*
 * tRPC procedures. A per-account in-flight guard prevents overlapping syncs.
 */

import {
  getGmailProfileFull,
  listHistory,
  getThreadSummaries,
  listThreadSummariesPage,
  listLabels,
  getThread,
  modifyThreadLabels,
  trashThread,
  untrashThread,
  type ThreadListItem,
  type EmailThread,
  type GmailLabel,
} from "@/lib/gmail";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { emitOutboxChange } from "@/lib/mail-mirror";

/** Gmail query that defines what the mirror seeds + tracks as "the list". */
export const MIRROR_SYNC_QUERY = "in:inbox";
/** Pages of 50 threads seeded on a full sync (cap to bound the cold-start cost). */
const FULL_SYNC_PAGES = 4;
const PAGE_SIZE = 50;

/** Map a Gmail list item to the mirror's thread-upsert shape. */
function toThreadInput(it: ThreadListItem) {
  return {
    id: it.id,
    subject: it.subject,
    from: it.from,
    snippet: it.snippet,
    date: it.date,
    internalDate: Date.parse(it.date) || 0,
    labelIds: it.labelIds,
  };
}

function toLabelInput(l: GmailLabel) {
  return { id: l.id, name: l.name, ...(l.color ? { color: l.color } : {}) };
}

/**
 * Pure: which mirrored inbox threads must drop their stale state after a
 * COMPLETE full sync (we saw the whole inbox). A mirror thread that no longer
 * appears in the freshly fetched set has left the inbox → remove it. Skipped
 * when the sync was truncated (more inbox pages exist than we fetched), since we
 * can't tell absence from "beyond the fetch window".
 */
export function computeFullSyncRemovals(
  mirrorInboxIds: readonly string[],
  fetchedIds: readonly string[],
  reachedEnd: boolean,
): string[] {
  if (!reachedEnd) return [];
  const fetched = new Set(fetchedIds);
  return mirrorInboxIds.filter((id) => !fetched.has(id));
}

// ── Per-account in-flight guard ─────────────────────────────────────────────
const inFlight = new Map<string, Promise<void>>();

/** Full reseed of the inbox + labels; stamps the historyId cursor. */
export async function fullSync(clientId: string, accountId: string): Promise<void> {
  const profile = await getGmailProfileFull(clientId);
  const labels = await listLabels(clientId).catch(() => [] as GmailLabel[]);

  const all: ThreadListItem[] = [];
  let pageToken: string | undefined;
  let reachedEnd = false;
  for (let i = 0; i < FULL_SYNC_PAGES; i++) {
    const page = await listThreadSummariesPage(clientId, MIRROR_SYNC_QUERY, {
      maxResults: PAGE_SIZE,
      pageToken,
    });
    all.push(...page.items);
    pageToken = page.nextPageToken;
    if (!pageToken) {
      reachedEnd = true;
      break;
    }
  }

  // Strip inbox threads that vanished since the last seed (only when we saw the
  // whole inbox — otherwise we'd wrongly evict threads beyond the fetch window).
  const existing = await trpcVanillaClient.mail.listThreads
    .query({ accountId, labelId: "INBOX", limit: 500 })
    .then((r) => r.items.map((it) => it.id))
    .catch(() => [] as string[]);
  const removeThreadIds = computeFullSyncRemovals(
    existing,
    all.map((it) => it.id),
    reachedEnd,
  );

  await trpcVanillaClient.mail.syncUpsert.mutate({
    accountId,
    threads: all.map(toThreadInput),
    labels: labels.map(toLabelInput),
    removeThreadIds,
    historyId: profile.historyId || undefined,
    markFullSync: true,
  });
}

/**
 * Pull deltas since `startHistoryId`. Returns false when the cursor expired
 * (caller should fall back to a full sync).
 */
export async function incrementalSync(
  clientId: string,
  accountId: string,
  startHistoryId: string,
): Promise<boolean> {
  const hist = await listHistory(clientId, startHistoryId);
  if (!hist.ok) return false;

  // Rafraîchir AUSSI la liste des labels : l'historique Gmail couvre les
  // changements d'appartenance (label posé/retiré sur un fil) mais PAS la
  // CRÉATION/le renommage d'un label. Un label créé dans Gmail après le dernier
  // full sync n'atteindrait jamais le mirror → les fils qui le portent ont un
  // labelId sans nom → ils ne se regroupent pas (buildMailOverlay skippe) et le
  // label est absent du picker des groupes. Un seul appel léger (`labels.list`).
  const labels = await listLabels(clientId).catch(() => [] as GmailLabel[]);
  const labelInput = labels.length ? labels.map(toLabelInput) : undefined;

  if (hist.changedThreadIds.length === 0) {
    // Aucun fil changé — on avance le curseur + lastSyncAt, mais on pousse quand
    // même les labels rafraîchis (ils ont pu changer sans toucher un fil).
    await trpcVanillaClient.mail.syncUpsert.mutate({
      accountId,
      labels: labelInput,
      historyId: hist.historyId,
    });
    return true;
  }

  const { items, missing } = await getThreadSummaries(clientId, hist.changedThreadIds);
  // "Inbox zero" model: the mirror only holds threads still to handle (in:inbox).
  // A touched thread that left the inbox is "done"/archived → drop it from the
  // mirror (row + messages) to reclaim space, instead of keeping a stale row.
  const stillInbox = items.filter((it) => it.labelIds.includes("INBOX"));
  const leftInbox = items.filter((it) => !it.labelIds.includes("INBOX")).map((it) => it.id);
  await trpcVanillaClient.mail.syncUpsert.mutate({
    accountId,
    threads: stillInbox.map(toThreadInput),
    labels: labelInput,
    removeThreadIds: [...missing, ...leftInbox],
    historyId: hist.historyId,
  });
  return true;
}

/** Fetch + mirror a single thread's full message set. Returns the live thread. */
export async function syncThreadDetail(
  clientId: string,
  accountId: string,
  threadId: string,
): Promise<EmailThread> {
  const t = await getThread(clientId, threadId);
  await trpcVanillaClient.mail.syncUpsert.mutate({
    accountId,
    messages: [
      {
        threadId,
        labelIds: t.labelIds,
        items: t.messages.map((m) => ({
          ...m,
          // EmailMessage carries no per-message labels; fill with the thread
          // union so optimistic label patches on messages stay coherent.
          labelIds: t.labelIds,
          internalDate: Date.parse(m.date) || 0,
        })),
      },
    ],
  });
  return t;
}

// Per-account in-flight guard so concurrent pushes (e.g. a bulk action firing
// one per thread) coalesce instead of double-pushing the same outbox ops.
const outboxInFlight = new Map<string, Promise<void>>();

/** Push pending optimistic mutations to Gmail, then ack/fail each outbox op. */
export function flushOutbox(clientId: string, accountId: string): Promise<void> {
  if (!clientId || !accountId) return Promise.resolve();
  const running = outboxInFlight.get(accountId);
  if (running) return running;
  const task = flushOutboxInner(clientId, accountId).finally(() => {
    outboxInFlight.delete(accountId);
  });
  outboxInFlight.set(accountId, task);
  return task;
}

async function flushOutboxInner(clientId: string, accountId: string): Promise<void> {
  const { items } = await trpcVanillaClient.mail.listOutbox.query({ accountId });
  if (items.length === 0) return;
  // Refresh the badge after the queue is drained / some ops fail.
  let changed = false;
  const acked: string[] = [];
  for (const op of items) {
    try {
      if (op.kind === "trash") {
        await trashThread(clientId, op.threadId);
      } else if (op.kind === "untrash") {
        await untrashThread(clientId, op.threadId);
      } else {
        await modifyThreadLabels(clientId, op.threadId, {
          addLabelIds: op.addLabelIds,
          removeLabelIds: op.removeLabelIds,
        });
      }
      acked.push(op.opId);
    } catch (err) {
      changed = true;
      await trpcVanillaClient.mail.resolveOutbox
        .mutate({
          opIds: [op.opId],
          outcome: "fail",
          error: err instanceof Error ? err.message : String(err),
        })
        .catch(() => {
          /* best-effort: a failed fail-record retries next flush */
        });
    }
  }
  if (acked.length > 0) {
    changed = true;
    await trpcVanillaClient.mail.resolveOutbox.mutate({ opIds: acked, outcome: "ack" });
  }
  if (changed) emitOutboxChange();
}

/**
 * Full reconciliation pass: flush the outbox first (so Gmail reflects local
 * intent before we pull), then pull deltas (incremental, or full when there's
 * no cursor / the cursor expired). De-duped per account.
 */
export function syncMailbox(clientId: string, accountId: string): Promise<void> {
  if (!clientId || !accountId) return Promise.resolve();
  const running = inFlight.get(accountId);
  if (running) return running;

  const task = (async () => {
    await flushOutbox(clientId, accountId).catch(() => {
      /* outbox push is best-effort; the pull still proceeds */
    });
    const state = await trpcVanillaClient.mail.getState.query({ accountId });
    if (!state.historyId || state.threadCount === 0) {
      await fullSync(clientId, accountId);
    } else {
      const ok = await incrementalSync(clientId, accountId, state.historyId);
      if (!ok) await fullSync(clientId, accountId);
    }
  })().finally(() => {
    inFlight.delete(accountId);
  });

  inFlight.set(accountId, task);
  return task;
}
