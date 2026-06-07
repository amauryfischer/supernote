/**
 * Pure op-log reducer logic — shared by the client (deciding which incoming
 * ops to apply) and exercised directly in tests. No I/O, no globals.
 */

import type { EntityOp, StoredOp } from "./types.js";

/**
 * Strict "is `a` newer than `b`" ordering used for last-write-wins.
 *
 * Primary key is the producer wall-clock `ts`. Ties (same millisecond, or
 * clocks that happen to agree) fall back to a lexicographic `opId` compare so
 * the result is deterministic across devices — every peer picks the same
 * winner regardless of arrival order.
 */
export function isOpNewer(a: EntityOp, b: EntityOp): boolean {
  if (a.ts !== b.ts) return a.ts > b.ts;
  return a.opId > b.opId;
}

/**
 * Collapse a batch of ops to the latest op per entity. Used when seeding a
 * fresh peer from a full op history (or a snapshot) so we apply one write per
 * entity instead of replaying every historical revision.
 */
export function reduceLatestPerEntity<T extends EntityOp>(ops: readonly T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const op of ops) {
    const prev = latest.get(op.entityId);
    if (!prev || isOpNewer(op, prev)) latest.set(op.entityId, op);
  }
  return latest;
}

/**
 * Drop ops we've already seen by `opId`, preserving order. The op-log is an
 * at-least-once channel (a reconnect can replay the tail), so consumers must
 * dedupe before applying.
 */
export function dedupeByOpId<T extends EntityOp>(ops: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const op of ops) {
    if (seen.has(op.opId)) continue;
    seen.add(op.opId);
    out.push(op);
  }
  return out;
}

/**
 * Filter out ops a device produced itself — a peer's own writes come back on
 * the stream and must not be re-applied (they're already on disk locally).
 */
export function rejectOwnOps<T extends EntityOp>(ops: readonly T[], clientId: string): T[] {
  return ops.filter((op) => op.clientId !== clientId);
}

/** Highest sequence seen in a batch, or `fallback` when the batch is empty. */
export function maxSeq(ops: readonly StoredOp[], fallback = 0): number {
  let max = fallback;
  for (const op of ops) if (op.seq > max) max = op.seq;
  return max;
}

/** Default no-arg id generator (ULID-ish, sortable-enough, collision-safe). */
export function newOpId(): string {
  const rand =
    typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${rand}`;
}
