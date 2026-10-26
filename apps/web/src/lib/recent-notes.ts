/**
 * Notes ouvertes récemment, de la plus récente à la plus ancienne.
 *
 * Distinct de `navigation/recents` (frecency, toutes pages) : ici l'ordre est
 * strictement chronologique, ce qui donne « Récents » de Ctrl+K et « note
 * précédente » (Ctrl+Tab). Préférence UI par appareil : localStorage, chaque
 * accès sous try/catch.
 */

const KEY = "supernote.notes.recent";
const MAX_ENTRIES = 20;

export interface RecentNote {
  id: string;
  title: string;
  folder: string;
  openedAt: number;
}

function sanitize(raw: unknown): RecentNote | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { id, title, folder, openedAt } = raw as Record<string, unknown>;
  if (typeof id !== "string" || !id) return null;
  return {
    id,
    title: typeof title === "string" ? title : "",
    folder: typeof folder === "string" ? folder : "",
    openedAt: typeof openedAt === "number" && Number.isFinite(openedAt) ? openedAt : 0,
  };
}

function load(): RecentNote[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitize).filter((n): n is RecentNote => n !== null);
  } catch {
    return [];
  }
}

/** Place la note en tête (dédoublonnée par id) ; met à jour titre et dossier. */
export function trackNoteOpen(note: { id: string; title: string; folder: string }): void {
  if (!note.id) return;
  const rest = load().filter((n) => n.id !== note.id);
  const next = [{ ...note, openedAt: Date.now() }, ...rest].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / stockage désactivé — non bloquant */
  }
}

export function forgetRecentNote(id: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(load().filter((n) => n.id !== id)));
  } catch {
    /* stockage désactivé — non bloquant */
  }
}

export function getRecentNotes(): RecentNote[] {
  return load();
}

/**
 * Id de la note ouverte juste avant `currentId`. Hors d'une note
 * (`currentId` null), c'est la dernière note ouverte.
 */
export function getPreviousNoteId(currentId: string | null): string | null {
  return load().find((n) => n.id !== currentId)?.id ?? null;
}
