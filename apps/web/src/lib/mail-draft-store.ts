/**
 * mail-draft-store — sauvegarde automatique des brouillons EN COURS DE SAISIE.
 *
 * Problème réglé : fermer le composeur (ou recharger l'onglet) perdait la
 * frappe. Le brouillon Gmail n'est créé que sur action explicite ; entre les
 * deux, rien ne retenait le texte.
 *
 * Portée volontairement locale : un brouillon par « contexte » (le composeur
 * global, ou un fil précis), dans le localStorage du navigateur. Ce n'est pas
 * une synchronisation — c'est un filet de sécurité, purgé à l'envoi.
 */

const KEY = "supernote.mail.autodrafts";

/** Durée de rétention : au-delà, un brouillon oublié n'est plus proposé (7 j). */
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export interface AutoDraft {
  /** Contexte : "compose" pour le composeur global, `t:<threadId>` pour un fil. */
  key: string;
  subject?: string;
  body: string;
  to?: string[];
  /** Horodatage de la dernière frappe (epoch ms). */
  savedAt: number;
}

/** Clé de contexte d'un fil. PUR. */
export function threadDraftKey(threadId: string): string {
  return `t:${threadId}`;
}

/** Clé du composeur global. */
export const COMPOSE_DRAFT_KEY = "compose";

function readAll(): Record<string, AutoDraft> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const now = Date.now();
    const out: Record<string, AutoDraft> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "object" || v === null) continue;
      const d = v as AutoDraft;
      if (typeof d.body !== "string" || typeof d.savedAt !== "number") continue;
      if (now - d.savedAt > MAX_AGE_MS) continue; // périmé → oublié
      out[k] = { ...d, key: k };
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, AutoDraft>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* quota / storage désactivé — best-effort */
  }
}

/** Brouillon auto-sauvegardé d'un contexte, ou null. */
export function loadAutoDraft(key: string): AutoDraft | null {
  return readAll()[key] ?? null;
}

/**
 * Écrit (ou remplace) le brouillon d'un contexte. Un contenu vide SUPPRIME
 * l'entrée : on ne propose jamais de restaurer du vide.
 */
export function saveAutoDraft(draft: Omit<AutoDraft, "savedAt">): void {
  const all = readAll();
  const empty = !draft.body.trim() && !draft.subject?.trim() && !(draft.to ?? []).length;
  if (empty) {
    delete all[draft.key];
  } else {
    all[draft.key] = { ...draft, savedAt: Date.now() };
  }
  writeAll(all);
}

/** Supprime le brouillon d'un contexte (envoi réussi, abandon explicite). */
export function clearAutoDraft(key: string): void {
  const all = readAll();
  if (key in all) {
    delete all[key];
    writeAll(all);
  }
}
