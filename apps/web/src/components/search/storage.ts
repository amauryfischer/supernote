/**
 * Persist saved + recent searches in localStorage.
 *
 * The search page (`app/recherche/page.tsx`) used to hold these in ephemeral
 * React state seeded with hardcoded fixtures, so anything the user saved was
 * lost on reload. This module is the durable home, following the same
 * convention as `online-sync/config-storage.ts` and `ai/settings.ts`:
 * dependency-free `load`/`save` helpers, SSR-guarded, defensive on read.
 *
 * localStorage (not the worker vault) on purpose: saved searches are a small,
 * per-device UI preference — same trust boundary as the search filters and the
 * sync config already living there. No need to round-trip the worker.
 */

import type { ActiveFilter, RecentSearch, SavedSearch, SearchMode } from "./types";

const SAVED_KEY = "supernote.search.saved";
const RECENT_KEY = "supernote.search.recent";

/** Hard cap so a runaway localStorage entry can't grow unbounded. */
const MAX_SAVED = 50;
const MAX_RECENT = 20;

const VALID_MODES: ReadonlySet<SearchMode> = new Set(["fts", "semantic", "hybrid"]);
const VALID_FILTER_KEYS: ReadonlySet<ActiveFilter["key"]> = new Set([
  "type",
  "tag",
  "in",
  "relation",
  "created",
  "modified",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeFilters(value: unknown): ActiveFilter[] {
  if (!Array.isArray(value)) return [];
  const out: ActiveFilter[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const { key, value: filterValue } = raw;
    if (typeof key !== "string" || typeof filterValue !== "string") continue;
    if (!VALID_FILTER_KEYS.has(key as ActiveFilter["key"])) continue;
    out.push({ key: key as ActiveFilter["key"], value: filterValue });
  }
  return out;
}

function sanitizeSaved(raw: unknown): SavedSearch | null {
  if (!isRecord(raw)) return null;
  const { id, label, query, mode, savedAt } = raw;
  if (typeof id !== "string" || typeof label !== "string" || typeof query !== "string") {
    return null;
  }
  const safeMode: SearchMode = VALID_MODES.has(mode as SearchMode)
    ? (mode as SearchMode)
    : "hybrid";
  return {
    id,
    label,
    query,
    filters: sanitizeFilters(raw.filters),
    mode: safeMode,
    savedAt: typeof savedAt === "string" ? savedAt : new Date(0).toISOString(),
  };
}

function sanitizeRecent(raw: unknown): RecentSearch | null {
  if (!isRecord(raw)) return null;
  const { id, query, usedAt } = raw;
  if (typeof id !== "string" || typeof query !== "string") return null;
  return {
    id,
    query,
    usedAt: typeof usedAt === "string" ? usedAt : new Date(0).toISOString(),
  };
}

// ── Saved searches ─────────────────────────────────────────────────────────

export function loadSavedSearches(): SavedSearch[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeSaved)
      .filter((s): s is SavedSearch => s !== null)
      .slice(0, MAX_SAVED);
  } catch {
    return [];
  }
}

export function saveSavedSearches(searches: SavedSearch[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(searches.slice(0, MAX_SAVED)));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

// ── Recent searches ────────────────────────────────────────────────────────

export function loadRecentSearches(): RecentSearch[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeRecent)
      .filter((r): r is RecentSearch => r !== null)
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function saveRecentSearches(searches: RecentSearch[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(searches.slice(0, MAX_RECENT)));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}
