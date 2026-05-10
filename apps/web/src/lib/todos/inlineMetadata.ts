/**
 * inlineMetadata — parse / serialize Obsidian-Tasks-style metadata that
 * lives directly on a checklist line.
 *
 * Supported tokens (always at the trailing end of the line, any order):
 *   `!P1`–`!P9`             priority 1–9  (default 5 = absent)
 *   `🔴` / `🟠` / `🟡` / `🔵`   importance critical / high / medium / low
 *                              (medium is the default — emit nothing)
 *   `🟢 YYYY-MM-DD`           start date (ISO calendar date, green = "go")
 *   `📅 YYYY-MM-DD`           due date (ISO calendar date)
 *
 * Examples:
 *   `Faire X`                               → priority 5,  importance medium, no date
 *   `Urgent !P1 🔴`                        → priority 1,  importance critical
 *   `Deadline 📅 2026-06-30`               → priority 5,  due 2026-06-30
 *   `Plage 🟢 2026-05-01 📅 2026-05-15`   → start 2026-05-01, due 2026-05-15
 *   `Tout !P3 🟠 📅 2026-12-31`           → priority 3,  high,  due 2026-12-31
 *
 * Canonical token order: `!P{n} <importance> 🟢 startDate 📅 dueDate`
 * (start before due, chronological reading order).
 *
 * Round-trip guarantee: `format(parse(s)) === s.trimEnd()` for any input
 * built by `format()` itself; arbitrary user input is normalized (token
 * order, single-space separation).
 *
 * Pure functions, zero deps. The full body is never needed — these helpers
 * operate on a single trimmed checklist line text (without the `- [ ] `
 * prefix; that part is already handled by extractChecklists).
 */

export type TodoImportance = "low" | "medium" | "high" | "critical";

export interface TodoMetadata {
  /** Clean text with all metadata tokens stripped. */
  cleanText: string;
  /** 1–9, defaults to 5 when no `!P{n}` token is present. */
  priority: number;
  /** Defaults to "medium" when no importance emoji is present. */
  importance: TodoImportance;
  /** ISO YYYY-MM-DD or null when no `🟢` token is present. */
  startDate: string | null;
  /** ISO YYYY-MM-DD or null when no `📅` token is present. */
  dueDate: string | null;
}

const DEFAULT_PRIORITY = 5;
const DEFAULT_IMPORTANCE: TodoImportance = "medium";

const IMPORTANCE_BY_EMOJI: Record<string, TodoImportance> = {
  "🔴": "critical",
  "🟠": "high",
  "🟡": "medium",
  "🔵": "low",
};

const EMOJI_BY_IMPORTANCE: Record<TodoImportance, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
};

const PRIORITY_RE = /(?:^|\s)!P([1-9])(?=\s|$)/u;
const IMPORTANCE_RE = /(?:^|\s)(🔴|🟠|🟡|🔵)(?=\s|$)/u;
const STARTDATE_RE = /(?:^|\s)🟢\s+(\d{4}-\d{2}-\d{2})(?=\s|$)/u;
const DUEDATE_RE = /(?:^|\s)📅\s+(\d{4}-\d{2}-\d{2})(?=\s|$)/u;

/**
 * Extract metadata from a checklist line's text. Tokens are removed in-place
 * and the surrounding whitespace is collapsed. Defaults fill any missing
 * token so callers always receive a complete `TodoMetadata`.
 */
export function parseInlineMetadata(text: string): TodoMetadata {
  let working = text ?? "";

  let priority = DEFAULT_PRIORITY;
  const pm = PRIORITY_RE.exec(working);
  if (pm) {
    priority = Number.parseInt(pm[1] ?? "5", 10);
    working = working.replace(PRIORITY_RE, "");
  }

  let importance: TodoImportance = DEFAULT_IMPORTANCE;
  const im = IMPORTANCE_RE.exec(working);
  if (im) {
    const emoji = im[1] ?? "";
    importance = IMPORTANCE_BY_EMOJI[emoji] ?? DEFAULT_IMPORTANCE;
    working = working.replace(IMPORTANCE_RE, "");
  }

  let startDate: string | null = null;
  const sm = STARTDATE_RE.exec(working);
  if (sm) {
    startDate = sm[1] ?? null;
    working = working.replace(STARTDATE_RE, "");
  }

  let dueDate: string | null = null;
  const dm = DUEDATE_RE.exec(working);
  if (dm) {
    dueDate = dm[1] ?? null;
    working = working.replace(DUEDATE_RE, "");
  }

  return {
    cleanText: working.replace(/\s{2,}/g, " ").trim(),
    priority,
    importance,
    startDate,
    dueDate,
  };
}

/**
 * Serialize metadata back into the canonical `text + tokens` form. Tokens
 * are appended in priority → importance → date order so two equivalent
 * metadata objects always produce byte-identical output.
 *
 * Default values are omitted entirely (priority 5, importance medium,
 * null date) — the resulting line stays clean for the common case.
 */
export function formatInlineMetadata(
  cleanText: string,
  meta: {
    priority: number;
    importance: TodoImportance;
    startDate?: string | null;
    dueDate: string | null;
  },
): string {
  const tokens: string[] = [];
  // Priority — clamp defensively in case callers pass out-of-range values.
  const p = Math.min(9, Math.max(1, Math.round(meta.priority)));
  if (p !== DEFAULT_PRIORITY) tokens.push(`!P${p}`);
  if (meta.importance !== DEFAULT_IMPORTANCE) {
    tokens.push(EMOJI_BY_IMPORTANCE[meta.importance]);
  }
  // Canonical order: startDate before dueDate (chronological reading)
  if (meta.startDate && /^\d{4}-\d{2}-\d{2}$/.test(meta.startDate)) {
    tokens.push(`🟢 ${meta.startDate}`);
  }
  if (meta.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(meta.dueDate)) {
    tokens.push(`📅 ${meta.dueDate}`);
  }
  const base = (cleanText ?? "").trim();
  if (tokens.length === 0) return base;
  return base.length > 0 ? `${base} ${tokens.join(" ")}` : tokens.join(" ");
}

export const TODO_METADATA_DEFAULTS = {
  priority: DEFAULT_PRIORITY,
  importance: DEFAULT_IMPORTANCE,
  startDate: null as string | null,
  dueDate: null as string | null,
};
