/**
 * extractChecklists — markdown checklist line parser.
 *
 * Scans a note's body for GitHub-flavored checklist items:
 *   - [ ] todo
 *   - [x] done
 *   * [ ] also valid (asterisk bullet)
 *   1. [ ] also valid (ordered list)
 *
 * Each line is parsed for inline metadata tokens (`!P{n}`, importance
 * emoji, `📅 YYYY-MM-DD`) — see `inlineMetadata.ts` for the grammar. The
 * parsed line therefore carries the four metadata fields directly,
 * removing the need for a separate `todo` entity per item.
 *
 * Returns one entry per detected line so the consumer (the /todos page or
 * AssociatedTodos) can render rows, build deep links and round-trip a
 * `done` toggle into the source markdown.
 *
 * No npm deps. Pure function — easy to unit-test.
 */

import {
  parseInlineMetadata,
  type TodoImportance,
} from "./inlineMetadata";

export interface ChecklistItem {
  /** Zero-based line index in the source markdown. */
  line: number;
  /**
   * Display text — metadata tokens have been stripped. This is what the
   * /todos page and the in-note summary render.
   */
  text: string;
  /**
   * Raw text as it appears between the `]` and the trailing newline. Useful
   * for the toggle helper which wants to preserve whatever metadata was on
   * the line without re-formatting it.
   */
  rawText: string;
  /** Whether the box was already checked in the source. */
  done: boolean;
  /** 1–9, defaults to 5 when the line carries no `!P{n}` token. */
  priority: number;
  /** Defaults to "medium" when no importance emoji is present. */
  importance: TodoImportance;
  /** Eisenhower urgency axis — true when the `🔥` token is present. */
  urgent: boolean;
  /** ISO YYYY-MM-DD or null when no `🟢` token is present. */
  startDate: string | null;
  /** ISO YYYY-MM-DD or null when no `📅` token is present. */
  dueDate: string | null;
  /**
   * Stable identifier for this line within the note. Used as a deduplication
   * key by AssociatedTodos and as a routing key for toggle/edit operations.
   *
   * Format: `${line}:${djb2(cleanText)}` — line index disambiguates duplicate
   * texts; the hash disambiguates moves of the same line index. Note that
   * because the hash uses the *clean* text (metadata stripped), changing
   * only the priority/dueDate of a line preserves its blockId.
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
 * as "this note has no todos".
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
    const rawText = (m[3] ?? "").trim();
    if (!rawText) continue;
    const meta = parseInlineMetadata(rawText);
    if (!meta.cleanText) continue;
    out.push({
      line: i,
      text: meta.cleanText,
      rawText,
      done: mark.toLowerCase() === "x",
      priority: meta.priority,
      importance: meta.importance,
      urgent: meta.urgent,
      startDate: meta.startDate,
      dueDate: meta.dueDate,
      blockId: `${i}:${djb2(meta.cleanText.toLowerCase())}`,
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
 * no longer matches, fall back to scanning by clean text (the user may
 * have inserted/removed lines above). Returns `null` when no matching
 * line is found so the caller can decide whether to drop the cache or
 * recompute.
 *
 * The replacement preserves the original prefix, indent, trailing
 * whitespace AND any inline metadata tokens — we only flip the
 * `[ ]` ↔ `[x]` marker.
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

  // Compare against the *clean* form so a metadata-only edit doesn't
  // make us miss the line.
  const wantClean = parseInlineMetadata(target.text).cleanText.toLowerCase();

  // Fast path: index match (and the cleaned text still matches so we
  // don't toggle the wrong line if the user reordered things).
  if (target.line >= 0 && target.line < lines.length) {
    const candidate = lines[target.line] ?? "";
    const m = CHECKLIST_RE.exec(candidate);
    if (m) {
      const candClean = parseInlineMetadata((m[3] ?? "").trim()).cleanText.toLowerCase();
      if (candClean === wantClean) {
        if (rewrite(target.line)) return lines.join("\n");
      }
    }
  }

  // Slow path: scan for the first checklist line whose clean text matches.
  for (let i = 0; i < lines.length; i++) {
    const m = CHECKLIST_RE.exec(lines[i] ?? "");
    if (!m) continue;
    const candClean = parseInlineMetadata((m[3] ?? "").trim()).cleanText.toLowerCase();
    if (candClean === wantClean) {
      if (rewrite(i)) return lines.join("\n");
    }
  }

  return null;
}

/**
 * Replace the inline-metadata tokens of a checklist line, preserving the
 * box state (`[ ]` / `[x]`) and the prefix. Used by the EditTodoModal when
 * the user changes priority/importance/dueDate from the /todos panel.
 *
 * `nextRawText` should already be the formatted text (call `formatInlineMetadata`
 * yourself). Returns the new body string, or `null` when no matching line
 * was found (the caller should surface a "source line gone" error).
 */
export function rewriteChecklistLine(
  body: string,
  target: { line: number; cleanText: string },
  nextRawText: string,
): string | null {
  const lines = body.split(/\r?\n/);
  const wantClean = target.cleanText.toLowerCase();

  function rewrite(idx: number): boolean {
    const line = lines[idx];
    if (line === undefined) return false;
    const m = CHECKLIST_RE.exec(line);
    if (!m) return false;
    const prefix = m[1] ?? "";
    const mark = m[2] ?? " ";
    lines[idx] = `${prefix}[${mark}] ${nextRawText}`;
    return true;
  }

  if (target.line >= 0 && target.line < lines.length) {
    const candidate = lines[target.line] ?? "";
    const m = CHECKLIST_RE.exec(candidate);
    if (m) {
      const candClean = parseInlineMetadata((m[3] ?? "").trim()).cleanText.toLowerCase();
      if (candClean === wantClean) {
        if (rewrite(target.line)) return lines.join("\n");
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const m = CHECKLIST_RE.exec(lines[i] ?? "");
    if (!m) continue;
    const candClean = parseInlineMetadata((m[3] ?? "").trim()).cleanText.toLowerCase();
    if (candClean === wantClean) {
      if (rewrite(i)) return lines.join("\n");
    }
  }

  return null;
}

/**
 * djb2 hash of the full body. No longer used by the new pipeline (which
 * has no cache), but exported for the migration script which needs a
 * cheap fingerprint to spot already-migrated notes.
 */
export function hashBody(body: string): string {
  return djb2(body);
}
