export interface Note {
  id: string;
  title: string;
  body: string;
  folderPath: string;
  updatedAt: string;
  tags: string[];
  /**
   * Raw entity field bag — exposes things like `canvas` (JSON-serialized
   * CanvasDocument) so views can read/write them without a second fetch.
   * Optional because the demo fixtures (used in fallback mode) don't carry
   * vault metadata; consumers should treat a missing bag as `{}`.
   */
  fields?: Record<string, unknown>;
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

export function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  // Floor at 0: clock skew or a freshly-written timestamp slightly in the
  // future would otherwise render "Il y a -1 jours".
  const diffDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays} jours`;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
