/**
 * heuristicFilter — deterministic, zero-IA filter for checklist items.
 *
 * Replaces the previous Ollama "is this a real todo?" verifier. A line is
 * surfaced as a todo unless it matches one of the cheap rules below:
 *
 *   1. Sits under a "rhetorical" heading (Vu/Lu/À voir/Idées/Watchlist…) —
 *      these sections collect references, not actions. Heading depth is
 *      respected: a deeper heading nests, an equal-or-shallower one closes
 *      the previous scope.
 *
 *   2. Body text shorter than `MIN_TEXT_LENGTH` characters — a stray
 *      "ok", "tbd", or single-letter list entry isn't an actionable todo.
 *
 * Pure function, no deps. The full body is needed because heading context
 * is line-relative.
 */

import type { ChecklistItem } from "./extractChecklists";

const MIN_TEXT_LENGTH = 4;

/**
 * Heading titles (lowercased, accent-stripped) that flag a section as
 * "rhetorical" — checklist items inside are reference-style, not actions.
 */
const RHETORICAL_HEADINGS = new Set<string>([
  "vu",
  "vus",
  "vues",
  "lu",
  "lus",
  "lectures",
  "a voir",
  "a lire",
  "a regarder",
  "a ecouter",
  "watchlist",
  "wishlist",
  "idees",
  "references",
  "inspiration",
  "inspirations",
  "ressources",
  "bookmarks",
]);

const HEADING_RE = /^(\s*)(#{1,6})\s+(.+?)\s*$/;

function normalizeHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

/**
 * Returns the subset of `items` that should become real todos. Items are
 * dropped when their source line is inside a rhetorical section or when
 * the trimmed text is too short.
 */
export function filterChecklistsHeuristic(
  body: string,
  items: ChecklistItem[],
): ChecklistItem[] {
  if (items.length === 0) return [];

  // Walk the body once, tracking the active heading stack per line so we
  // can answer "is line N inside a rhetorical section?" in O(1).
  const lines = body.split(/\r?\n/);
  const rhetoricalAtLine: boolean[] = new Array(lines.length).fill(false);

  const stack: Array<{ depth: number; key: string; rhetorical: boolean }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i] ?? "");
    if (m) {
      const depth = (m[2] ?? "#").length;
      const key = normalizeHeading(m[3] ?? "");
      while (stack.length && stack[stack.length - 1]!.depth >= depth) {
        stack.pop();
      }
      stack.push({ depth, key, rhetorical: RHETORICAL_HEADINGS.has(key) });
    }
    rhetoricalAtLine[i] = stack.some((h) => h.rhetorical);
  }

  return items.filter((it) => {
    if (it.text.trim().length < MIN_TEXT_LENGTH) return false;
    if (rhetoricalAtLine[it.line]) return false;
    return true;
  });
}
