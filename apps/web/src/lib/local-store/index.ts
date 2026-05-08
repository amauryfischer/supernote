"use client";

/**
 * localStorage-backed mock store for degraded browser mode.
 *
 * Stores all entities under a single key `supernote.localEntities` as a
 * flat dict keyed by entity id. React integration uses useSyncExternalStore
 * so any change triggers a re-render in subscribed components.
 */

import { useSyncExternalStore } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LocalEntity {
  id: string;
  typeId: string;
  fields: Record<string, unknown>;
  body?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LocalStore {
  list(typeId: string): LocalEntity[];
  get(id: string): LocalEntity | null;
  create(
    typeId: string,
    fields: Record<string, unknown>,
    opts?: { body?: string; tags?: string[] },
  ): LocalEntity;
  update(id: string, patch: Partial<LocalEntity>): LocalEntity;
  remove(id: string): void;
  clear(typeId?: string): void;
  subscribe(listener: () => void): () => void;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

const STORAGE_KEY = "supernote.localEntities";

function readStorage(): Record<string, LocalEntity> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, LocalEntity>) : {};
  } catch {
    return {};
  }
}

function writeStorage(dict: Record<string, LocalEntity>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dict));
  } catch {
    // quota exceeded or private browsing — silent fail
  }
}

function generateId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Store implementation ──────────────────────────────────────────────────────

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

/**
 * Per-typeId snapshot cache for `useSyncExternalStore`.
 *
 * `getSnapshot` MUST return the same reference between calls when the
 * underlying data hasn't changed, otherwise React throws
 * "The result of getSnapshot should be cached to avoid an infinite loop".
 *
 * We rebuild the cached array for a given typeId only when entities of
 * that typeId actually change (create/update/remove/clear).
 */
const snapshotCache = new Map<string, LocalEntity[]>();

function buildSnapshot(typeId: string): LocalEntity[] {
  const dict = readStorage();
  return Object.values(dict).filter((e) => e.typeId === typeId);
}

function invalidateSnapshot(typeId: string): void {
  snapshotCache.delete(typeId);
}

function invalidateAllSnapshots(): void {
  snapshotCache.clear();
}

function list(typeId: string): LocalEntity[] {
  // Imperative read: always fresh, never cached. Cache is only for the
  // React hook path (getSnapshot) where referential stability matters.
  return buildSnapshot(typeId);
}

function get(id: string): LocalEntity | null {
  const dict = readStorage();
  return dict[id] ?? null;
}

function create(
  typeId: string,
  fields: Record<string, unknown>,
  opts?: { body?: string; tags?: string[] },
): LocalEntity {
  const now = new Date().toISOString();
  const entity: LocalEntity = {
    id: generateId(),
    typeId,
    fields,
    body: opts?.body,
    tags: opts?.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
  const dict = readStorage();
  dict[entity.id] = entity;
  writeStorage(dict);
  invalidateSnapshot(typeId);
  notify();
  return entity;
}

function update(id: string, patch: Partial<LocalEntity>): LocalEntity {
  const dict = readStorage();
  const existing = dict[id];
  if (!existing) throw new Error(`LocalStore: entity ${id} not found`);
  const updated: LocalEntity = {
    ...existing,
    ...patch,
    id,
    updatedAt: new Date().toISOString(),
  };
  dict[id] = updated;
  writeStorage(dict);
  // Invalidate both the previous and new typeId in case `patch` migrated it.
  invalidateSnapshot(existing.typeId);
  if (updated.typeId !== existing.typeId) invalidateSnapshot(updated.typeId);
  notify();
  return updated;
}

function remove(id: string): void {
  const dict = readStorage();
  const existing = dict[id];
  delete dict[id];
  writeStorage(dict);
  if (existing) invalidateSnapshot(existing.typeId);
  else invalidateAllSnapshots();
  notify();
}

function clear(typeId?: string): void {
  if (!typeId) {
    writeStorage({});
    invalidateAllSnapshots();
  } else {
    const dict = readStorage();
    for (const key of Object.keys(dict)) {
      if (dict[key]?.typeId === typeId) delete dict[key];
    }
    writeStorage(dict);
    invalidateSnapshot(typeId);
  }
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const localStore: LocalStore = {
  list,
  get,
  create,
  update,
  remove,
  clear,
  subscribe,
};

// ── React hook ────────────────────────────────────────────────────────────────

/**
 * Returns a cached snapshot for the given typeId. The same array reference
 * is returned across calls until a mutation invalidates the cache entry.
 * This is required by `useSyncExternalStore`, which compares snapshot
 * references to decide whether to re-render — returning a fresh array on
 * every call triggers React's "infinite loop" guard.
 */
function getSnapshot(typeId: string): LocalEntity[] {
  let cached = snapshotCache.get(typeId);
  if (!cached) {
    cached = buildSnapshot(typeId);
    snapshotCache.set(typeId, cached);
  }
  return cached;
}

// Stable empty array for the SSR fallback path so React sees a single
// reference across renders.
const EMPTY_SNAPSHOT: LocalEntity[] = [];

/**
 * Reactive hook: returns LocalEntity[] for a typeId.
 * Re-renders whenever the store changes.
 */
export function useLocalEntities(typeId: string): LocalEntity[] {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot(typeId),
    () => EMPTY_SNAPSHOT,
  );
}
