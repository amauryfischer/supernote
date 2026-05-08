/**
 * extractChecklists — markdown checklist line parser.
 *
 * Scans a note's body for GitHub-flavored checklist items:
 *   - [ ] todo
 *   - [x] done
 *   * [ ] also valid (asterisk bullet)
 *   1. [ ] also valid (ordered list)
 *
 * Returns one entry per detected line so we can:
 *   1. Feed the texts to the LLM ("is this a real todo?")
 *   2. Round-trip a "done" toggle from the /todos panel back into the
 *      markdown body (replace `[ ]` ↔ `[x]` at the recorded line).
 *
 * No npm deps. Pure function — easy to unit-test.
 */

export interface ChecklistItem {
  /** Zero-based line index in the source markdown. */
  line: number;
  /** Trimmed text of the checkbox item (without the `- [ ]` prefix). */
  text: string;
  /** Whether the box was already checked in the source. */
  done: boolean;
  /**
   * Stable identifier for this line within the note. Used as the entity-id
   * suffix so we can re-find the same todo across reruns even if other
   * checklist items were inserted before it.
   *
   * Format: `${line}:${djb2(text)}` — line index disambiguates duplicate
   * texts; the body hash disambiguates moves.
   */
  blockId: string;
  /** The exact prefix matched (e.g. "- ", "* ", "1. ") — preserved so we
   *  can reconstruct the line verbatim when toggling state. */
  prefix: string;
  /** The whole raw line — kept so the toggle helper can reproduce trailing
   *  whitespace, formatting, etc. */
  raw: string;
}

// Capture three groups:
//   1) the bullet/ordered prefix (incl. trailing space)
//   2) the literal " " or "x" or "X" between the brackets
//   3) the text after `] `
//
// We allow leading whitespace so nested checklists work too.
const CHECKLIST_RE = /^(\s*(?:[-*+]|\d+\.)\s+)\[( |x|X)\]\s+(.+?)\s*$/;

/** Cheap stable hash matching the `useAutoTitle` helper so id derivation is
 *  consistent across the codebase. */
function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

/**
 * Extract every checklist line from a markdown body. Returns an empty
 * array if no checklist syntax is found — the caller should treat that
 * as "this note has no todos" (skip the AI call entirely).
 */
export function extractChecklists(body: string): ChecklistItem[] {
  if (!body || typeof body !== "string") return [];
  const lines = body.split(/\r?\n/);
  const out: ChecklistItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = CHECKLIST_RE.exec(line);
    if (!m) continue;
    const prefix = m[1] ?? "";
    const mark = m[2] ?? " ";
    const text = (m[3] ?? "").trim();
    if (!text) continue;
    out.push({
      line: i,
      text,
      done: mark.toLowerCase() === "x",
      blockId: `${i}:${djb2(text.toLowerCase())}`,
      prefix,
      raw: line,
    });
  }
  return out;
}

/**
 * Toggle the checked state of a single checklist line in `body`.
 *
 * Strategy: locate by `line` first (fast path); if the line at that index
 * no longer matches, fall back to scanning by `text` (the user may have
 * inserted/removed lines above). Returns `null` when no matching line is
 * found so the caller can decide whether to drop the cache or recompute.
 *
 * The replacement preserves the original prefix, indent and trailing
 * whitespace — we only flip the `[ ]` ↔ `[x]` marker.
 */
export function toggleChecklistLine(
  body: string,
  target: { line: number; text: string },
  done: boolean,
): string | null {
  const lines = body.split(/\r?\n/);
  const want = done ? "x" : " ";

  function rewrite(idx: number): boolean {
    const line = lines[idx];
    if (line === undefined) return false;
    const m = CHECKLIST_RE.exec(line);
    if (!m) return false;
    const prefix = m[1] ?? "";
    const text = m[3] ?? "";
    lines[idx] = `${prefix}[${want}] ${text}`;
    return true;
  }

  // Fast path: index match (and the text still roughly matches so we
  // don't toggle the wrong line if the user reordered things).
  if (target.line >= 0 && target.line < lines.length) {
    const candidate = lines[target.line] ?? "";
    const m = CHECKLIST_RE.exec(candidate);
    if (m && (m[3] ?? "").trim().toLowerCase() === target.text.trim().toLowerCase()) {
      if (rewrite(target.line)) return lines.join("\n");
    }
  }

  // Slow path: scan for the first checklist line whose text matches.
  // Case-insensitive comparison; we don't care about exact whitespace.
  const want_text = target.text.trim().toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const m = CHECKLIST_RE.exec(lines[i] ?? "");
    if (!m) continue;
    if ((m[3] ?? "").trim().toLowerCase() === want_text) {
      if (rewrite(i)) return lines.join("\n");
    }
  }

  return null;
}

/**
 * djb2 hash of the full body — used as the cache key. Re-exported so
 * callers (useTodoSync) don't reinvent it.
 */
export function hashBody(body: string): string {
  return djb2(body);
}
