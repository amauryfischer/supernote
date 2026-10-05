/**
 * mail-sync — reconciliation engine between the local Gmail mirror and Gmail.
 *
 * Gmail is the source of truth. This engine keeps the mirror tables in step:
 *
 *  - fullSync       — seed the inbox + labels, stamp the account historyId cursor.
 *  - incrementalSync — pull deltas via history.list since the stored historyId,
 *                      re-fetch only the touched threads, upsert. Falls back to
 *                      a full sync when the historyId expired (404).
 *  - ensureThread     — read a thread mirror-first: zero Gmail calls when the
 *                      mirror is complete, else fetch + background-mirror.
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
  searchThreadsPage,
  listLabels,
  getThread,
  getThreadsFull,
  modifyThreadLabels,
  trashThread,
  untrashThread,
  isTransientGmailError,
  type ThreadListItem,
  type EmailThread,
  type GmailLabel,
} from "@/lib/gmail";
import { trpcVanillaClient } from "@/lib/trpc/client";
import {
  emitOutboxChange,
  mirrorAvailable,
  mirrorGetThread,
  MAIL_SYNCED_EVENT,
  MAIL_SYNC_STATE_EVENT,
} from "@/lib/mail-mirror";
import { swKvSet } from "@/lib/sw-kv";

/** Gmail query that defines what the mirror seeds + tracks as "the list". */
export const MIRROR_SYNC_QUERY = "in:inbox";
/** Pages of 50 threads seeded on a full sync (cap to bound the cold-start cost). */
const FULL_SYNC_PAGES = 4;
// Un fil raté par l'historique Gmail (changement pas encore visible au moment
// de la lecture) resterait périmé partout : l'adoption du curseur partagé
// empêche les autres appareils de le revoir. Le full sync le rattrape.
const FULL_RECONCILE_MS = 6 * 60 * 60_000;
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
    historyId: it.historyId ?? undefined,
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

/**
 * Full reseed of the inbox + labels; stamps the historyId cursor. Chaque page
 * est écrite dès sa lecture : un refus de quota en cours de route garde ce qui
 * est lu, et le curseur n'est posé que sur une passe complète. Seuls les fils
 * dont le historyId diffère du miroir sont relus (threads.get coûte 10 unités).
 */
export async function fullSync(clientId: string, accountId: string): Promise<void> {
  const profile = await getGmailProfileFull(clientId);
  const labels = await listLabels(clientId).catch(() => [] as GmailLabel[]);
  const mirrorHistory = new Map(
    await trpcVanillaClient.mail.listThreads
      .query({ accountId, labelId: "INBOX", limit: 500 })
      .then((r) => r.items.map((it) => [it.id, it.historyId ?? null] as const))
      .catch(() => []),
  );

  const fetchedIds: string[] = [];
  let pageToken: string | undefined;
  let reachedEnd = false;
  let firstFailure: Error | undefined;
  for (let i = 0; i < FULL_SYNC_PAGES; i++) {
    let page: Awaited<ReturnType<typeof searchThreadsPage>>;
    let summaries: Awaited<ReturnType<typeof getThreadSummaries>>;
    try {
      page = await searchThreadsPage(clientId, MIRROR_SYNC_QUERY, { maxResults: PAGE_SIZE, pageToken });
      const stale = page.items.filter((t) => !t.historyId || mirrorHistory.get(t.id) !== t.historyId).map((t) => t.id);
      summaries = await getThreadSummaries(clientId, stale);
    } catch (err) {
      firstFailure = err instanceof Error ? err : new Error(String(err));
      break;
    }
    firstFailure ??= summaries.failed[0];
    const missing = new Set(summaries.missing);
    fetchedIds.push(...page.items.map((t) => t.id).filter((id) => !missing.has(id)));
    await trpcVanillaClient.mail.syncUpsert.mutate({
      accountId,
      threads: summaries.items.map(toThreadInput),
      ...(i === 0 && labels.length ? { labels: labels.map(toLabelInput) } : {}),
    });
    if (firstFailure) break;
    pageToken = page.nextPageToken;
    if (!pageToken) {
      reachedEnd = true;
      break;
    }
  }
  if (firstFailure) throw firstFailure;

  // Strip inbox threads that vanished since the last seed (only when we saw the
  // whole inbox — otherwise we'd wrongly evict threads beyond the fetch window).
  const existing = await trpcVanillaClient.mail.listThreads
    .query({ accountId, labelId: "INBOX", limit: 500 })
    .then((r) => r.items.map((it) => it.id))
    .catch(() => [] as string[]);

  await trpcVanillaClient.mail.syncUpsert.mutate({
    accountId,
    removeThreadIds: computeFullSyncRemovals(existing, fetchedIds, reachedEnd),
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
  // L'historique couvre toute la boîte (envoyés, archives, labels) : relire chaque fil
  // touché dépassait le quota Gmail par minute, figeait le curseur et rejouait la même
  // rafale à chaque passe. Seuls comptent les fils du miroir et ceux qui touchent l'INBOX.
  const mirrored = new Set(
    await trpcVanillaClient.mail.listThreads
      .query({ accountId, labelId: "INBOX", limit: 500 })
      .then((r) => r.items.map((it) => it.id)),
  );
  const inbox = new Set(hist.inboxThreadIds ?? []);
  hist.changedThreadIds = hist.changedThreadIds.filter((id) => mirrored.has(id) || inbox.has(id));
  if (hist.changedThreadIds.length > FULL_SYNC_PAGES * PAGE_SIZE) return false;

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

  const { items, missing, failed } = await getThreadSummaries(clientId, hist.changedThreadIds);
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
    // Curseur figé tant qu'un fil n'a pu être relu : le prochain passage le reprend.
    historyId: failed.length ? undefined : hist.historyId,
  });
  if (failed[0]) throw failed[0];
  return true;
}

// Dédup des lectures Gmail concurrentes du même fil (montage + clic rapide,
// plusieurs lecteurs sur le même thread) par "accountId:threadId".
const threadFetchInFlight = new Map<string, Promise<EmailThread>>();

/**
 * Lit un fil miroir-d'abord : renvoie le mirror SANS appel Gmail quand il est
 * complet (sauf `opts.refresh`). Sinon fetch Gmail (dédupliqué) et renvoie
 * immédiatement — la persistance mirror part en tâche de fond, l'affichage n'attend
 * pas l'écriture worker. En mode dégradé (pas de mirror), fetch Gmail direct.
 */
export async function ensureThread(
  clientId: string,
  accountId: string,
  threadId: string,
  opts: { refresh?: boolean } = {},
): Promise<EmailThread> {
  const canMirror = mirrorAvailable() && !!accountId;
  let cached: { thread: EmailThread; complete: boolean } | null = null;
  if (canMirror) {
    cached = await mirrorGetThread(accountId, threadId).catch(() => null);
    if (cached?.complete && !opts.refresh) return cached.thread;
  }

  const key = `${accountId}:${threadId}`;
  let fetch = threadFetchInFlight.get(key);
  if (!fetch) {
    fetch = getThread(clientId, threadId).finally(() => {
      threadFetchInFlight.delete(key);
    });
    threadFetchInFlight.set(key, fetch);
  }
  const t = await fetch;

  // Persiste seulement les fils déjà suivis par le mirror (résumé existant) :
  // un fil hors mirror (ex. envoyé, contact externe) n'a pas de ligne mail_thread
  // à mettre à jour côté worker → les messages écrits resteraient orphelins,
  // jamais relus ni purgés (mailGetThread renvoie null pour un fil sans résumé).
  if (canMirror && cached !== null) {
    trpcVanillaClient.mail.syncUpsert
      .mutate({
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
      })
      .catch((err) => console.warn("[mail] ensureThread: échec persistance mirror", err));
  }

  return t;
}

/** `navigator.connection` (Network Information API) n'est pas dans lib.dom.ts. */
interface NetworkInformationLike {
  saveData?: boolean;
}

/** Nombre de fils dont le corps est anticipé après un sync (tête de la liste affichée). */
export const PREFETCH_THREAD_COUNT = 20;

/**
 * Précharge en tâche de fond le corps complet des `threadIds` pas encore
 * mirrorés (ou dont seul le résumé l'est) : ouvrir le fil ensuite lit le
 * miroir au lieu d'attendre Gmail. Best-effort — appelé fire-and-forget par
 * les déclencheurs (après `syncMailbox`, sur `MAIL_MIRROR_RECEIVED_EVENT`),
 * l'appelant journalise l'échec (`console.warn`) plutôt que de le propager.
 */
export async function prefetchThreadBodies(
  clientId: string,
  accountId: string,
  threadIds: readonly string[],
): Promise<void> {
  if (!clientId || !accountId || threadIds.length === 0) return;
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (connection?.saveData) return;

  const toFetch: string[] = [];
  for (const id of threadIds) {
    const cached = await mirrorGetThread(accountId, id).catch(() => null);
    if (!cached || cached.complete !== true) toFetch.push(id);
  }
  if (toFetch.length === 0) return;

  const { items } = await getThreadsFull(clientId, toFetch);
  if (items.length === 0) return;
  await trpcVanillaClient.mail.syncUpsert.mutate({
    accountId,
    messages: items.map((t) => ({
      threadId: t.id,
      labelIds: t.labelIds,
      items: t.messages.map((m) => ({ ...m, labelIds: t.labelIds, internalDate: Date.parse(m.date) || 0 })),
    })),
  });
}

// Per-account in-flight guard so concurrent pushes (e.g. a bulk action firing
// one per thread) coalesce instead of double-pushing the same outbox ops.
const outboxInFlight = new Map<string, Promise<void>>();

// Backoff par op après un refus de Gmail (4xx) : 5 s, 10 s, 20 s… plafonné à 10 min.
const opRetryAt = new Map<string, number>();
const opBackoffMs = (attempts: number) => Math.min(10 * 60_000, 5_000 * 2 ** attempts);

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
  // Un fil dont une op attend garde ses ops suivantes en file : l'ordre compte
  // (archiver puis annuler ne doit pas s'inverser).
  const heldThreads = new Set<string>();
  for (const op of items) {
    if (heldThreads.has(op.threadId) || (opRetryAt.get(op.opId) ?? 0) > Date.now()) {
      heldThreads.add(op.threadId);
      continue;
    }
    try {
      if (op.kind === "trash") {
        await trashThread(clientId, op.threadId);
        // trash/untrash only move to/from Trash; any label deltas (e.g. re-adding
        // INBOX when undoing a delete) must be applied separately, else the
        // incremental pull sees the thread out of inbox and drops it again.
        if (op.addLabelIds.length > 0 || op.removeLabelIds.length > 0) {
          await modifyThreadLabels(clientId, op.threadId, {
            addLabelIds: op.addLabelIds,
            removeLabelIds: op.removeLabelIds,
          });
        }
      } else if (op.kind === "untrash") {
        await untrashThread(clientId, op.threadId);
        if (op.addLabelIds.length > 0 || op.removeLabelIds.length > 0) {
          await modifyThreadLabels(clientId, op.threadId, {
            addLabelIds: op.addLabelIds,
            removeLabelIds: op.removeLabelIds,
          });
        }
      } else {
        await modifyThreadLabels(clientId, op.threadId, {
          addLabelIds: op.addLabelIds,
          removeLabelIds: op.removeLabelIds,
        });
      }
      acked.push(op.opId);
      opRetryAt.delete(op.opId);
    } catch (err) {
      // Réseau, jeton ou quota : l'op n'y est pour rien, elle ne consomme pas de
      // tentative, et les suivantes échoueraient pareil. Relance au prochain
      // déclencheur (online, retour d'onglet, reconnexion, sync).
      if (isTransientGmailError(err)) break;
      changed = true;
      heldThreads.add(op.threadId);
      opRetryAt.set(op.opId, Date.now() + opBackoffMs(op.attempts));
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
    if (!state.historyId || state.threadCount === 0 || Date.now() - (state.lastFullSyncAt ?? 0) > FULL_RECONCILE_MS) {
      await fullSync(clientId, accountId);
    } else {
      const ok = await incrementalSync(clientId, accountId, state.historyId);
      if (!ok) await fullSync(clientId, accountId);
    }
    const after = await trpcVanillaClient.mail.getState.query({ accountId });
    if (after.historyId) void swKvSet("mailHistoryId", after.historyId).catch(() => undefined);
    lastSyncFailed = false;
    window.dispatchEvent(new CustomEvent(MAIL_SYNCED_EVENT));
  })()
    .catch((err: unknown) => {
      lastSyncFailed = true;
      throw err;
    })
    .finally(() => {
      inFlight.delete(accountId);
      window.dispatchEvent(new CustomEvent(MAIL_SYNC_STATE_EVENT));
    });

  inFlight.set(accountId, task);
  window.dispatchEvent(new CustomEvent(MAIL_SYNC_STATE_EVENT));
  return task;
}

let lastSyncFailed = false;

/** La dernière tentative de synchro a échoué (quota, jeton, réseau…). */
export function mailSyncFailed(): boolean {
  return lastSyncFailed;
}

export function isMailSyncing(): boolean {
  return inFlight.size > 0;
}
