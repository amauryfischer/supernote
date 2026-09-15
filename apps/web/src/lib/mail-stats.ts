/**
 * mail-stats — compteur local « emails traités aujourd'hui ».
 *
 * Sert l'écran inbox-zero : arriver à zéro doit VALOIR quelque chose. Le
 * compteur est volontairement trivial (localStorage, remis à zéro au changement
 * de jour) — aucune donnée d'email n'y est stockée, juste un nombre et une date.
 */

const KEY = "supernote.mail.stats";

export interface MailDayStats {
  /** Jour local au format YYYY-MM-DD. */
  day: string;
  /** Nombre d'actions de triage (fait / archivé / reporté / supprimé) du jour. */
  triaged: number;
}

/** Jour local courant (YYYY-MM-DD), sans dépendance à un fuseau externe. PUR. */
export function todayKey(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Lit les stats du jour ; toute valeur d'un autre jour est repartie à zéro. */
export function loadStats(now: Date = new Date()): MailDayStats {
  const day = todayKey(now);
  if (typeof window === "undefined") return { day, triaged: 0 };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { day, triaged: 0 };
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as MailDayStats).day === day &&
      typeof (parsed as MailDayStats).triaged === "number"
    ) {
      return { day, triaged: (parsed as MailDayStats).triaged };
    }
  } catch {
    /* storage illisible — on repart de zéro */
  }
  return { day, triaged: 0 };
}

/** Événement émis à chaque incrément (l'écran inbox-zero se rafraîchit). */
export const MAIL_STATS_EVENT = "supernote:mail-stats";

/** Incrémente le compteur du jour de `n` (défaut 1) et renvoie l'état écrit. */
export function bumpTriaged(n = 1, now: Date = new Date()): MailDayStats {
  const cur = loadStats(now);
  const next: MailDayStats = { day: cur.day, triaged: cur.triaged + n };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(MAIL_STATS_EVENT));
    } catch {
      /* quota / storage désactivé — best-effort */
    }
  }
  return next;
}
