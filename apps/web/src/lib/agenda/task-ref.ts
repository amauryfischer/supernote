import type { CalEventRow } from "@supernote/ipc";
import { buildGmailThreadUrl } from "@/lib/gmail";

export const TASK_DRAG_MIME = "application/x-supernote-task";

interface TaskRow {
  id: string;
  sourceNoteId: string | null;
  blockId: string | null;
}

/** Tâche de note : hash du texte seul (suffixe du blockId), pour que déplacer la ligne ne casse pas le lien. */
export function taskRefOf(row: TaskRow): string {
  if (row.id.startsWith("mail:")) return row.id;
  if (row.sourceNoteId && row.blockId) {
    return `checklist:${row.sourceNoteId}:${row.blockId.slice(row.blockId.indexOf(":") + 1)}`;
  }
  return `todo:${row.id}`;
}

export function taskSourcePath(ref: string): string | null {
  const [kind = "", id = ""] = ref.split(":");
  if (!id) return null;
  if (kind === "todo") return `/todos?edit=${encodeURIComponent(id)}`;
  if (kind === "mail") return `/mail?thread=${encodeURIComponent(id)}`;
  if (kind === "checklist") return `/notes/${id}`;
  return null;
}

/** Lien écrit dans la description du bloc, pour rouvrir la tâche depuis Google Agenda. */
export function taskSourceUrl(ref: string): string {
  if (ref.startsWith("mail:")) return buildGmailThreadUrl(ref.slice("mail:".length));
  const path = taskSourcePath(ref);
  return path ? `${window.location.origin}${path}` : "";
}

export function withScheduledAt<T extends TaskRow & { scheduledAt?: number | null }>(
  rows: T[],
  blocks: ReadonlyMap<string, CalEventRow>,
): T[] {
  if (blocks.size === 0) return rows;
  return rows.map((r) => {
    const block = blocks.get(taskRefOf(r));
    return block ? { ...r, scheduledAt: block.startAt } : r;
  });
}
