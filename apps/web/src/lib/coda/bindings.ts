/**
 * Per-base Coda bindings registry (localStorage).
 *
 * A base imported from Coda keeps a binding: which doc/table it came from and
 * the column→field mapping, so it can be refreshed (re-pull → upsert by Coda
 * rowId) and rendered read-only. There is no native read-only flag on an
 * EntityType (cf. mounts, which enforce read-only as an app-level invariant);
 * the bases UI consults this registry to decide that a base is Coda-sourced.
 *
 * Stored under a single key, mirroring `online-sync/config-storage`.
 */

import type { MappedColumn } from "./mapping";

const BINDINGS_KEY = "supernote.coda.bindings";

export interface CodaBinding {
  /** Coda doc the table lives in. */
  docId: string;
  docName: string;
  /** Coda table this base mirrors. */
  tableId: string;
  tableName: string;
  /** The column→field mapping, replayed on refresh so field ids stay stable. */
  columns: MappedColumn[];
  /** Epoch ms of the original import. */
  importedAt: number;
  /** Epoch ms of the last successful refresh, if any. */
  lastRefreshedAt?: number;
}

function loadAll(): Record<string, CodaBinding> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(BINDINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, CodaBinding>;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, CodaBinding>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(BINDINGS_KEY, JSON.stringify(map));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

/** All Coda-sourced bases, keyed by EntityType id. */
export function listCodaBindings(): Record<string, CodaBinding> {
  return loadAll();
}

/** The binding for a base, or null if the base is not Coda-sourced. */
export function getCodaBinding(baseId: string): CodaBinding | null {
  return loadAll()[baseId] ?? null;
}

/** True when the base is a read-only Coda mirror. */
export function isCodaBase(baseId: string): boolean {
  return baseId in loadAll();
}

/** Insert or update a base's binding. */
export function saveCodaBinding(baseId: string, binding: CodaBinding): void {
  const map = loadAll();
  map[baseId] = binding;
  writeAll(map);
}

/** Drop a base's binding (e.g. when the base is deleted). */
export function removeCodaBinding(baseId: string): void {
  const map = loadAll();
  if (baseId in map) {
    delete map[baseId];
    writeAll(map);
  }
}
