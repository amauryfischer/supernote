/**
 * Persist recently + frequently visited pages in localStorage ("frecency").
 *
 * Powers the Cmd+K palette empty state: instead of a static command list, the
 * palette opens on the pages you actually revisit. Same trust boundary and
 * defensive conventions as `components/search/storage.ts` — a tiny per-device
 * UI preference, SSR-guarded, try/catch on every read, hard-capped so a runaway
 * entry can't grow unbounded.
 *
 * Visits are recorded from the shell chrome (breadcrumb / mobile title) using
 * data those components already resolved, so recording never triggers a network
 * request. `Date.now()` is intentional here — this is app UI code, not a
 * deterministic worker path.
 */

const KEY = "supernote.nav.recents";

/** Hard cap so the store stays a small, bounded UI preference. */
const MAX_ENTRIES = 40;

const DAY_MS = 86_400_000;

export interface RecentEntry {
  /** Route this entry navigates to (upsert key). */
  href: string;
  /** Entity ULID when the page is an entity detail — enables palette preview. */
  entityId?: string;
  /** Display label (already resolved by the caller). */
  title: string;
  /** Entity type id when known (drives the palette icon). */
  typeId?: string;
  /** Epoch ms of the most recent visit. */
  lastVisitedAt: number;
  /** Total number of recorded visits. */
  visitCount: number;
}

/** Fields the caller supplies; counters are managed internally. */
export interface RecentVisit {
  href: string;
  title: string;
  entityId?: string;
  typeId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitize(raw: unknown): RecentEntry | null {
  if (!isRecord(raw)) return null;
  const { href, title, entityId, typeId, lastVisitedAt, visitCount } = raw;
  if (typeof href !== "string" || !href) return null;
  if (typeof title !== "string") return null;
  return {
    href,
    title,
    entityId: typeof entityId === "string" && entityId ? entityId : undefined,
    typeId: typeof typeId === "string" && typeId ? typeId : undefined,
    lastVisitedAt:
      typeof lastVisitedAt === "number" && Number.isFinite(lastVisitedAt) ? lastVisitedAt : 0,
    visitCount:
      typeof visitCount === "number" && Number.isFinite(visitCount) && visitCount > 0
        ? Math.floor(visitCount)
        : 1,
  };
}

function load(): RecentEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitize)
      .filter((e): e is RecentEntry => e !== null)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function save(entries: RecentEntry[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

/**
 * Firefox-style frecency: a recency weight (stepped by how long ago the last
 * visit was) multiplied by the visit count. We only keep an aggregate
 * `lastVisitedAt` + `visitCount` (not a per-visit history), so this is the
 * documented single-bucket approximation of Firefox's per-visit sum:
 *
 *   weight(age) = 100 (≤4d) · 70 (≤14d) · 50 (≤31d) · 30 (≤90d) · 10 (older)
 *   score       = weight(now − lastVisitedAt) × visitCount
 */
function recencyWeight(ageMs: number): number {
  if (ageMs <= 4 * DAY_MS) return 100;
  if (ageMs <= 14 * DAY_MS) return 70;
  if (ageMs <= 31 * DAY_MS) return 50;
  if (ageMs <= 90 * DAY_MS) return 30;
  return 10;
}

function frecencyScore(entry: RecentEntry, now: number): number {
  return recencyWeight(Math.max(0, now - entry.lastVisitedAt)) * entry.visitCount;
}

/**
 * Record a visit to `href`. Upserts by href: bumps `visitCount` and refreshes
 * `lastVisitedAt`, and fills in `entityId` / `typeId` / `title` when the caller
 * has them (without ever clobbering a value already stored — a lower-fidelity
 * mobile visit won't wipe the entityId a desktop visit resolved).
 */
export function recordVisit(visit: RecentVisit): void {
  if (typeof localStorage === "undefined") return;
  if (!visit.href || !visit.title) return;

  const now = Date.now();
  const entries = load();
  const idx = entries.findIndex((e) => e.href === visit.href);
  const existing = idx >= 0 ? entries[idx] : undefined;

  const merged: RecentEntry = {
    href: visit.href,
    title: visit.title || existing?.title || visit.href,
    entityId: visit.entityId ?? existing?.entityId,
    typeId: visit.typeId ?? existing?.typeId,
    lastVisitedAt: now,
    visitCount: (existing?.visitCount ?? 0) + 1,
  };

  if (idx >= 0) entries[idx] = merged;
  else entries.push(merged);

  // Sort by frecency and cap so the lowest-value entries fall off first.
  entries.sort((a, b) => frecencyScore(b, now) - frecencyScore(a, now));
  save(entries.slice(0, MAX_ENTRIES));
}

/** Recent entries sorted by descending frecency (most useful first). */
export function getRecents(limit = 20): RecentEntry[] {
  const now = Date.now();
  return load()
    .sort((a, b) => {
      const diff = frecencyScore(b, now) - frecencyScore(a, now);
      return diff !== 0 ? diff : b.lastVisitedAt - a.lastVisitedAt;
    })
    .slice(0, Math.max(0, limit));
}

/**
 * Map of entityId → frecency score, for boosting search results that point at a
 * frequently visited entity. Only entries carrying an `entityId` are included.
 */
export function getFrecencyMap(): Map<string, number> {
  const now = Date.now();
  const map = new Map<string, number>();
  for (const entry of load()) {
    if (entry.entityId) map.set(entry.entityId, frecencyScore(entry, now));
  }
  return map;
}
