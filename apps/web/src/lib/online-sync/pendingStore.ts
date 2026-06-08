/**
 * pendingStore — durable journal of locally-produced sync ops that have not
 * been acknowledged by the server yet.
 *
 * Why: the OnlineSyncClient buffers ops in memory behind a debounce. A tab
 * closed (or crashed) right after an edit would lose those ops FOREVER —
 * the worker never re-emits them and the device has already been seeded, so
 * the server would simply never learn about that edit. Persisting the buffer
 * lets the next session push what the previous one couldn't.
 *
 * Bounded: payloads embed full entity bodies, and localStorage is ~5 MB. If
 * the journal outgrows the budget (long offline streak with heavy edits), it
 * is cheaper to throw it away and re-seed the whole vault on next connect —
 * the server dedupes by opId, so over-pushing is harmless while under-pushing
 * loses data. `save` reports that via "overflow".
 */

import type { EntityOp } from "@supernote/sync";

const MAX_OPS = 500;
const MAX_BYTES = 2 * 1024 * 1024;

function storageKey(vaultKey: string): string {
  return `supernote.onlineSync.pending.${vaultKey}`;
}

export type PendingSaveResult = "ok" | "overflow";

/** Load the journal for a vault. Corrupt/absent → empty. */
export function loadPendingOps(vaultKey: string): EntityOp[] {
  try {
    const raw = localStorage.getItem(storageKey(vaultKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (op): op is EntityOp =>
        !!op &&
        typeof op === "object" &&
        typeof (op as EntityOp).opId === "string" &&
        typeof (op as EntityOp).entityId === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Persist the journal. On overflow the journal is CLEARED (caller should
 * schedule a full re-seed instead — see module doc).
 */
export function savePendingOps(vaultKey: string, ops: EntityOp[]): PendingSaveResult {
  try {
    if (ops.length === 0) {
      localStorage.removeItem(storageKey(vaultKey));
      return "ok";
    }
    if (ops.length > MAX_OPS) {
      localStorage.removeItem(storageKey(vaultKey));
      return "overflow";
    }
    const json = JSON.stringify(ops);
    if (json.length > MAX_BYTES) {
      localStorage.removeItem(storageKey(vaultKey));
      return "overflow";
    }
    localStorage.setItem(storageKey(vaultKey), json);
    return "ok";
  } catch {
    // Quota error and the like — same policy as a size overflow.
    try {
      localStorage.removeItem(storageKey(vaultKey));
    } catch {
      /* nothing left to do */
    }
    return "overflow";
  }
}

/** Drop the journal (after a successful push of everything). */
export function clearPendingOps(vaultKey: string): void {
  try {
    localStorage.removeItem(storageKey(vaultKey));
  } catch {
    /* ignore */
  }
}
