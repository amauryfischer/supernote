export type AgendaView = "day" | "week" | "month" | "list";

export const DAY_MS = 86_400_000;

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Ajout calendaire (et non +24 h) : un passage à l'heure d'été garde minuit à minuit. */
export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  d.setMonth(d.getMonth() + n, 1);
  return d.getTime();
}

/** Lundi 0 h de la semaine de `ms`. */
export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  return addDays(d.getTime(), -((d.getDay() + 6) % 7));
}

export function dateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDateKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime();
}

export function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

export function isSameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

export function viewRange(view: AgendaView, anchor: number): { from: number; to: number; days: number[] } {
  let first: number;
  let count: number;
  if (view === "day") {
    first = startOfDay(anchor);
    count = 1;
  } else if (view === "week") {
    first = startOfWeek(anchor);
    count = 7;
  } else if (view === "month") {
    const d = new Date(anchor);
    first = startOfWeek(new Date(d.getFullYear(), d.getMonth(), 1).getTime());
    count = 42;
  } else {
    first = startOfDay(anchor);
    count = 14;
  }
  const days = Array.from({ length: count }, (_, i) => addDays(first, i));
  return { from: first, to: addDays(first, count) - 1, days };
}

/** Pas de navigation (précédent/suivant) propre à chaque vue. */
export function stepAnchor(view: AgendaView, anchor: number, dir: -1 | 1): number {
  if (view === "day") return addDays(anchor, dir);
  if (view === "week") return addDays(anchor, 7 * dir);
  if (view === "month") return addMonths(anchor, dir);
  return addDays(anchor, 14 * dir);
}

const TIME = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
export function formatTime(ms: number): string {
  return TIME.format(ms);
}

const DAY_LONG = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
export function formatDayLong(ms: number): string {
  return DAY_LONG.format(ms);
}

export function formatRangeTitle(view: AgendaView, anchor: number): string {
  if (view === "day") return formatDayLong(anchor);
  if (view === "month") return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(anchor);
  const { days } = viewRange(view, anchor);
  const fmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
  return `${fmt.format(days[0] ?? anchor)} – ${fmt.format(days[days.length - 1] ?? anchor)}`;
}

/** « 14:00 – 15:30 », ou « Journée » pour un événement sur la journée entière. */
export function formatSpan(ev: { allDay: boolean; startAt: number; endAt: number }): string {
  return ev.allDay ? "Journée" : `${formatTime(ev.startAt)} – ${formatTime(ev.endAt)}`;
}
