export interface Note {
  id: string;
  title: string;
  body: string;
  folderPath: string;
  updatedAt: string;
  tags: string[];
}

export interface Folder {
  name: string;
  path: string;
  children?: Folder[];
}

export const FOLDERS: Folder[] = [];

export const NOTES: Note[] = [];

export function getNotesForFolder(folderPath: string): Note[] {
  return NOTES.filter((n) => n.folderPath === folderPath);
}

export function getNoteById(id: string): Note | undefined {
  return NOTES.find((n) => n.id === id);
}

export function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date("2026-05-07T12:00:00Z");
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays} jours`;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
