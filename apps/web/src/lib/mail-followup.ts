/**
 * mail-followup — rappels de relance : « reviens me voir si personne n'a
 * répondu ».
 *
 * Le report (snooze) ramène un fil à une date, quoi qu'il arrive. Un rappel de
 * relance ne se déclenche QUE si le fil est resté sans réponse : c'est ce qui
 * sert après avoir envoyé un devis, une demande, une relance. S'il y a eu une
 * réponse entre-temps, le rappel s'efface tout seul — sinon il ferait du bruit
 * exactement quand il ne faut pas.
 *
 * Détection de réponse : on mémorise le nombre de messages du fil au moment où
 * le rappel est posé ; à l'échéance, un fil plus long veut dire que quelqu'un a
 * écrit. Simple, sans faux négatif qui compte (Gmail ne perd pas de messages),
 * et lisible à la relecture.
 *
 * Store local (localStorage) : aucun contenu d'email n'y est écrit, juste des
 * identifiants de fil, un objet et une échéance.
 */

const KEY = "supernote.mail.followups";

/** Émis à chaque changement (badge, listes). */
export const MAIL_FOLLOWUP_EVENT = "supernote:mail-followup";

export interface FollowupEntry {
  threadId: string;
  /** Objet du fil, pour l'affichage de la liste et du rappel. */
  subject: string;
  /** Nombre de messages du fil à la pose du rappel (détection de réponse). */
  messageCount: number;
  /** Échéance (epoch ms). */
  dueAt: number;
  createdAt: number;
}

function emit(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(MAIL_FOLLOWUP_EVENT));
  }
}

function isEntry(v: unknown): v is FollowupEntry {
  if (typeof v !== "object" || v === null) return false;
  const o = v as FollowupEntry;
  return (
    typeof o.threadId === "string" &&
    o.threadId.length > 0 &&
    typeof o.dueAt === "number" &&
    Number.isFinite(o.dueAt) &&
    typeof o.messageCount === "number"
  );
}

/** Lit les rappels posés. Tolérant aux données cassées. */
export function loadFollowups(): FollowupEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function write(entries: FollowupEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
    emit();
  } catch {
    /* quota / storage désactivé — best-effort */
  }
}

/** Pose (ou remplace) un rappel sur un fil. */
export function addFollowup(entry: Omit<FollowupEntry, "createdAt">): void {
  write([
    ...loadFollowups().filter((e) => e.threadId !== entry.threadId),
    { ...entry, createdAt: Date.now() },
  ]);
}

/** Retire le rappel d'un fil (no-op s'il n'y en a pas). */
export function removeFollowup(threadId: string): void {
  const all = loadFollowups();
  const next = all.filter((e) => e.threadId !== threadId);
  if (next.length !== all.length) write(next);
}

/** Rappel posé sur un fil, ou null. PUR (lecture du store). */
export function getFollowup(threadId: string): FollowupEntry | null {
  return loadFollowups().find((e) => e.threadId === threadId) ?? null;
}

/** Rappels dont l'échéance est atteinte. PUR par rapport à `nowMs`. */
export function dueFollowups(nowMs: number, entries = loadFollowups()): FollowupEntry[] {
  return entries.filter((e) => e.dueAt <= nowMs);
}

/** Rappels encore à venir, du plus proche au plus lointain. PUR. */
export function pendingFollowups(nowMs: number, entries = loadFollowups()): FollowupEntry[] {
  return entries.filter((e) => e.dueAt > nowMs).sort((a, b) => a.dueAt - b.dueAt);
}

/**
 * Le fil a-t-il reçu du nouveau depuis la pose du rappel ? PUR.
 * Un fil plus long = quelqu'un a écrit → le rappel n'a plus lieu d'être.
 */
export function hasNewMessages(entry: FollowupEntry, currentCount: number): boolean {
  return currentCount > entry.messageCount;
}

// ── Échéances proposées ─────────────────────────────────────────────────────

export interface FollowupPreset {
  id: string;
  label: string;
  /** Décalage en jours à partir de maintenant. */
  days: number;
}

/** Délais proposés par le menu « Me rappeler si pas de réponse ». */
export const FOLLOWUP_PRESETS: readonly FollowupPreset[] = [
  { id: "d2", label: "Dans 2 jours", days: 2 },
  { id: "d3", label: "Dans 3 jours", days: 3 },
  { id: "w1", label: "Dans 1 semaine", days: 7 },
  { id: "w2", label: "Dans 2 semaines", days: 14 },
];

/** Échéance (epoch ms) à `days` jours, à 9 h locale. PUR (horloge injectée). */
export function inDaysAt9(days: number, now: Date = new Date()): number {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  // Un délai de 0 jour tomberait dans le passé si on est après 9 h : on cale au
  // plus tôt sur « maintenant + 1 h ».
  return Math.max(d.getTime(), now.getTime() + 3600_000);
}
