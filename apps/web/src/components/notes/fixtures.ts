export interface Note {
  id: string;
  title: string;
  body: string;
  folderPath: string;
  /**
   * Full on-disk path relative to the vault root (e.g. "Travail/note.md").
   * Used by the move-to-folder action which needs the original filename
   * — recomputing it via `slugify(title)` would drift if the title was
   * edited after creation. Optional because the demo fixtures (used in
   * fallback mode) don't carry vault metadata.
   */
  filePath?: string;
  updatedAt: string;
  tags: string[];
  /**
   * Raw entity field bag — exposes things like `canvas` (JSON-serialized
   * CanvasDocument) so views can read/write them without a second fetch.
   * Optional because the demo fixtures (used in fallback mode) don't carry
   * vault metadata; consumers should treat a missing bag as `{}`.
   */
  fields?: Record<string, unknown>;
  /**
   * ISO timestamp set when the user archives a note. `null`/`undefined`
   * means active. Hoisted out of `fields` for ergonomics — every list
   * filter and the /archive page reads this thousands of times per render
   * and the indirection got noisy. Persisted in `fields.archivedAt`.
   */
  archivedAt?: string | null;
}

export interface Folder {
  name: string;
  path: string;
  children?: Folder[];
  /**
   * Optional CSS color string (hex / hsl / css var) applied to the folder
   * icon in the FileTree. Persisted via `vault.folders.update`.
   */
  color?: string;
  /**
   * Optional phosphor icon name (e.g. "Briefcase", "Star"). Resolved by
   * `getFolderIcon` in FileTree; unknown names fall back to the default
   * Folder/FolderOpen pair.
   */
  icon?: string;
  /**
   * Optional manual sort position. When present on all siblings, the folder
   * tree sorts by this value instead of alphabetically.
   */
  sortOrder?: number;
}

export const FOLDERS: Folder[] = [];

export const NOTES: Note[] = [];

export function getNotesForFolder(folderPath: string): Note[] {
  // Recursive: include direct notes plus those in any sub-folder so the
  // middle pane shows the whole folder subtree (matches worker-backed mode).
  return NOTES.filter(
    (n) => n.folderPath === folderPath || n.folderPath.startsWith(`${folderPath}/`),
  );
}

export function getNoteById(id: string): Note | undefined {
  return NOTES.find((n) => n.id === id);
}

/**
 * Format a date as a fixed pattern matching the user's preference
 * (Settings → Général → Format de date). Recognized values:
 *   "DD/MM/YYYY" — European default
 *   "MM/DD/YYYY" — US
 *   "YYYY-MM-DD" — ISO 8601
 * Falls back to DD/MM/YYYY when the value is unknown.
 */
export function formatDateWithPattern(isoDate: string, pattern: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  switch (pattern) {
    case "MM/DD/YYYY":
      return `${mm}/${dd}/${yyyy}`;
    case "YYYY-MM-DD":
      return `${yyyy}-${mm}-${dd}`;
    case "DD/MM/YYYY":
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

/**
 * Relative-then-absolute date formatter. Within a week, returns a French
 * friendly relative label ("Aujourd'hui", "Hier", "Il y a 3 jours");
 * older dates fall through to the user's chosen calendar pattern.
 *
 * `dateFormat` is read from `settings.general.dateFormat` by callers (the
 * settings store) — defaults to DD/MM/YYYY when not provided so existing
 * usages without a pattern still render a sensible value.
 */
export function formatRelativeDate(isoDate: string, dateFormat: string = "DD/MM/YYYY"): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  // Floor at 0: clock skew or a freshly-written timestamp slightly in the
  // future would otherwise render "Il y a -1 jours".
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays} jours`;
  // Older than a week: render with the user-chosen calendar pattern.
  // The list-row badge stays compact thanks to small font + tabular nums;
  // we ship the FULL pattern (with year) here because it's the only place
  // the year is otherwise hidden behind the relative branch.
  return formatDateWithPattern(isoDate, dateFormat);
}
