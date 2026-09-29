/**
 * habitData — logique pure du tracker d'habitudes (« jardin de pixels »).
 *
 * Une habitude = une entité `habit`, à tenir `target` fois par période
 * (jour, semaine lun→dim, mois calendaire). Les check-ins vivent dans
 * `fields.checkins`, une map JSON-encodée `{ "YYYY-MM-DD": count }` — le
 * schéma IPC (`FieldValueSchema`) n'accepte que des scalaires/string[],
 * donc la map voyage en string et est (dé)sérialisée ici.
 *
 * Toutes les dates sont des clés locales (pas d'UTC) : une habitude cochée
 * à 23 h doit colorer le pixel du jour vécu, pas celui de Greenwich.
 */

export const HABIT_TYPE_ID = "habit";

export type HabitPeriod = "day" | "week" | "month";
export const HABIT_PERIODS: readonly HabitPeriod[] = ["day", "week", "month"];

/** Heures entre deux rappels ; 0 = désactivé, 24 = une fois par jour à `remindFrom`. */
export type RemindEvery = 0 | 1 | 2 | 3 | 24;
export const REMIND_EVERY: readonly RemindEvery[] = [0, 1, 2, 3, 24];

export interface Habit {
  id: string;
  name: string;
  icon: string;
  color: string;
  period: HabitPeriod;
  /** Nombre de check-ins requis pour valider la période (≥ 1). */
  target: number;
  remindEvery: RemindEvery;
  /** Plage des rappels, heures locales 0-23, bornes incluses. */
  remindFrom: number;
  remindTo: number;
  /** Unité affichée ("verres", "min", …) — vide = simple compteur. */
  unit: string;
  archived: boolean;
  checkins: Record<string, number>;
  createdAt: string;
}

/** Shape minimale acceptée — évite de coupler au type IPC complet. */
export interface HabitEntityLike {
  id: string;
  fields: Record<string, unknown>;
  createdAt: string;
}

export const DEFAULT_HABIT_COLOR = "#8b5cf6";
export const DEFAULT_HABIT_ICON = "✦";

// ── Dates locales ────────────────────────────────────────────────────────────

/** Clé locale YYYY-MM-DD (PAS toISOString — décalerait après 23 h UTC+2). */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

// ── Sérialisation ────────────────────────────────────────────────────────────

export function parseCheckins(raw: unknown): Record<string, number> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof v === "number" && v > 0) {
        out[k] = Math.floor(v);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeCheckins(checkins: Record<string, number>): string {
  // Les zéros sont élagués : une clé absente == jour vide, la map reste
  // compacte même après des années d'usage.
  const compact: Record<string, number> = {};
  for (const [k, v] of Object.entries(checkins)) {
    if (v > 0) compact[k] = v;
  }
  return JSON.stringify(compact);
}

function hourField(raw: unknown, fallback: number): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : fallback;
}

export function parseHabit(e: HabitEntityLike): Habit {
  const f = e.fields;
  const target = typeof f["target"] === "number" && f["target"] >= 1 ? Math.floor(f["target"]) : 1;
  const period = HABIT_PERIODS.find((p) => p === f["period"]) ?? "day";
  // Absent = 0 : une habitude d'avant les rappels ne se met pas à notifier toute seule.
  const remindEvery = REMIND_EVERY.find((r) => r === f["remindEvery"]) ?? 0;
  const remindFrom = hourField(f["remindFrom"], 8);
  return {
    id: e.id,
    name: typeof f["name"] === "string" && f["name"].length > 0 ? f["name"] : "Sans nom",
    icon: typeof f["icon"] === "string" && f["icon"].length > 0 ? f["icon"] : DEFAULT_HABIT_ICON,
    color: typeof f["color"] === "string" && f["color"].length > 0 ? f["color"] : DEFAULT_HABIT_COLOR,
    period,
    target,
    remindEvery,
    remindFrom,
    remindTo: Math.max(remindFrom, hourField(f["remindTo"], 22)),
    unit: typeof f["unit"] === "string" ? f["unit"] : "",
    archived: f["archived"] === true,
    checkins: parseCheckins(f["checkins"]),
    createdAt: e.createdAt,
  };
}

// ── Check-ins ────────────────────────────────────────────────────────────────

/**
 * Cycle d'un clic sur un pixel : 0 → 1 → … → target → 0.
 * Une journée déjà validée repasse à vide (annulation d'un faux clic).
 */
export function cycleCount(count: number, target: number): number {
  return count >= target ? 0 : count + 1;
}

/** Niveau d'intensité du pixel — 0 vide, 1-2 partiel, 3 validé, 4 dépassé. */
export function dayLevel(count: number, target: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count > target) return 4;
  if (count >= target) return 3;
  return count / target < 0.5 ? 1 : 2;
}

export function isDayComplete(checkins: Record<string, number>, key: string, target: number): boolean {
  return (checkins[key] ?? 0) >= target;
}

// ── Streaks & stats ──────────────────────────────────────────────────────────

export interface StreakInfo {
  /** Série en cours. Aujourd'hui non coché ne casse PAS la série (elle ne
   *  meurt qu'à minuit) — il ne l'allonge juste pas encore. */
  current: number;
  best: number;
}

export function computeStreaks(
  checkins: Record<string, number>,
  target: number,
  today: Date,
): StreakInfo {
  const todayKey = toDateKey(today);

  // Série courante : on remonte depuis aujourd'hui (ou hier si aujourd'hui
  // n'est pas encore validé) tant que les jours sont complets.
  let current = 0;
  let cursor = isDayComplete(checkins, todayKey, target) ? today : addDays(today, -1);
  while (isDayComplete(checkins, toDateKey(cursor), target)) {
    current++;
    cursor = addDays(cursor, -1);
  }

  // Record : pour chaque début de série (la veille n'est pas complète), on
  // compte vers l'avant. O(n) sur les jours cochés.
  let best = current;
  for (const key of Object.keys(checkins)) {
    if (!isDayComplete(checkins, key, target)) continue;
    const day = parseDateKey(key);
    if (isDayComplete(checkins, toDateKey(addDays(day, -1)), target)) continue; // pas un début
    let run = 0;
    let fwd = day;
    while (isDayComplete(checkins, toDateKey(fwd), target)) {
      run++;
      fwd = addDays(fwd, 1);
    }
    if (run > best) best = run;
  }

  return { current, best };
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export interface HabitStats {
  /** Jours validés au total. */
  totalDays: number;
  /** Taux de validation sur les 30 derniers jours (0-100). */
  rate30: number;
}

export function computeStats(
  checkins: Record<string, number>,
  target: number,
  today: Date,
): HabitStats {
  let totalDays = 0;
  for (const [key, count] of Object.entries(checkins)) {
    if (count >= target) totalDays++;
    void key;
  }
  let done30 = 0;
  for (let i = 0; i < 30; i++) {
    if (isDayComplete(checkins, toDateKey(addDays(today, -i)), target)) done30++;
  }
  return { totalDays, rate30: Math.round((done30 / 30) * 100) };
}

/** Jalons de série qui méritent une petite fanfare. */
export const STREAK_MILESTONES = [7, 14, 30, 50, 100, 200, 365] as const;

export function isStreakMilestone(streak: number): boolean {
  return (STREAK_MILESTONES as readonly number[]).includes(streak);
}

// ── Grille de pixels ─────────────────────────────────────────────────────────

/**
 * Nombre de colonnes (semaines) à afficher pour une habitude : de la semaine
 * de sa création à la semaine courante, plafonné à `maxWeeks`. La grille
 * « pousse » d'une colonne chaque lundi au lieu d'ouvrir sur une année de
 * cases vides — le passé d'avant l'habitude n'existe pas, il ne culpabilise
 * pas.
 */
export function gridWeeks(createdAt: string, today: Date, maxWeeks = 53): number {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return maxWeeks;
  const mondayOf = (d: Date): Date => addDays(d, -((d.getDay() + 6) % 7));
  const start = mondayOf(created);
  const end = mondayOf(today);
  const weeks = Math.round((end.getTime() - start.getTime()) / (7 * 24 * 3600 * 1000)) + 1;
  return Math.min(maxWeeks, Math.max(1, weeks));
}

export interface GridCell {
  key: string;
  /** Date après aujourd'hui — rendue invisible mais occupe la place. */
  future: boolean;
}

/**
 * Construit la grille façon GitHub : `weeks` colonnes (semaines lun→dim),
 * la dernière colonne contient aujourd'hui. Retourne aussi les étiquettes
 * de mois positionnées sur la colonne contenant un 1er du mois.
 */
export function buildGrid(
  today: Date,
  weeks: number,
): { columns: GridCell[][]; monthLabels: Array<{ week: number; label: string }> } {
  const mondayOffset = (today.getDay() + 6) % 7; // 0 = lundi
  const start = addDays(today, -mondayOffset - (weeks - 1) * 7);
  const todayKey = toDateKey(today);

  const columns: GridCell[][] = [];
  const monthLabels: Array<{ week: number; label: string }> = [];
  let lastMonth = -1;

  for (let w = 0; w < weeks; w++) {
    const col: GridCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, w * 7 + d);
      const key = toDateKey(date);
      col.push({ key, future: key > todayKey });
      if (date.getDate() === 1 && date.getMonth() !== lastMonth && !col[col.length - 1]!.future) {
        lastMonth = date.getMonth();
        monthLabels.push({
          week: w,
          label: date.toLocaleDateString("fr-FR", { month: "short" }),
        });
      }
    }
    columns.push(col);
  }

  return { columns, monthLabels };
}

// ── Périodes ─────────────────────────────────────────────────────────────────

/** Premier jour (minuit local) de la période qui contient `d`. */
export function periodStart(period: HabitPeriod, d: Date): Date {
  if (period === "month") return new Date(d.getFullYear(), d.getMonth(), 1);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return period === "week" ? addDays(day, -((day.getDay() + 6) % 7)) : day;
}

export function addPeriods(period: HabitPeriod, start: Date, n: number): Date {
  if (period === "month") return new Date(start.getFullYear(), start.getMonth() + n, 1);
  return addDays(start, period === "week" ? 7 * n : n);
}

export interface PeriodProgress {
  done: number;
  target: number;
  complete: boolean;
}

/** Seule définition de « fait » : somme des check-ins de la période qui contient `date`. */
export function periodProgress(habit: Habit, date: Date): PeriodProgress {
  const start = periodStart(habit.period, date);
  const end = addPeriods(habit.period, start, 1);
  let done = 0;
  for (let d = start; d < end; d = addDays(d, 1)) done += habit.checkins[toDateKey(d)] ?? 0;
  return { done, target: habit.target, complete: done >= habit.target };
}

/** Prochain compteur d'un jour touché : cycle jusqu'à la cible pour `day`, bascule 0 ↔ 1 sinon (un jour = une fois). */
export function nextDayCount(habit: Habit, count: number): number {
  if (habit.period === "day") return cycleCount(count, habit.target);
  return count > 0 ? 0 : 1;
}

/** Intensité d'un pixel de jour : un jour coché est plein pour une habitude hebdo/mensuelle. */
export function habitDayLevel(habit: Habit, count: number): 0 | 1 | 2 | 3 | 4 {
  if (habit.period === "day") return dayLevel(count, habit.target);
  return count > 0 ? 3 : 0;
}

/** Série en périodes complètes consécutives ; la période en cours non tenue ne casse rien. */
export function habitStreaks(habit: Habit, today: Date): StreakInfo {
  const keys = Object.keys(habit.checkins).sort();
  if (keys.length === 0) return { current: 0, best: 0 };
  const last = periodStart(habit.period, today).getTime();
  let run = 0;
  let best = 0;
  for (let p = periodStart(habit.period, parseDateKey(keys[0]!)); p.getTime() <= last; p = addPeriods(habit.period, p, 1)) {
    if (periodProgress(habit, p).complete) {
      run++;
      best = Math.max(best, run);
    } else if (p.getTime() !== last) {
      run = 0;
    }
  }
  return { current: run, best };
}

const STATS_WINDOW: Record<HabitPeriod, { n: number; label: string }> = {
  day: { n: 30, label: "30 j" },
  week: { n: 12, label: "12 sem." },
  month: { n: 6, label: "6 mois" },
};

export interface HabitPeriodStats {
  /** Périodes validées au total. */
  total: number;
  /** Taux de validation sur la fenêtre récente (0-100). */
  rate: number;
  windowLabel: string;
}

export function habitStats(habit: Habit, today: Date): HabitPeriodStats {
  const { n, label } = STATS_WINDOW[habit.period];
  const strip = periodStrip(habit, today, n);
  const keys = Object.keys(habit.checkins).sort();
  let total = 0;
  if (keys.length > 0) {
    const last = periodStart(habit.period, today).getTime();
    for (let p = periodStart(habit.period, parseDateKey(keys[0]!)); p.getTime() <= last; p = addPeriods(habit.period, p, 1)) {
      if (periodProgress(habit, p).complete) total++;
    }
  }
  const done = strip.filter((c) => c.complete).length;
  return { total, rate: Math.round((done / n) * 100), windowLabel: label };
}

export interface StripCell {
  /** Clé du premier jour de la période. */
  key: string;
  level: 0 | 1 | 2 | 3 | 4;
  complete: boolean;
  /** Libellé lisible de la période (« 29 sept. », « sem. du 22 sept. », « sept. 2026 »). */
  label: string;
}

/** Les `n` dernières périodes, de la plus ancienne à celle en cours. */
export function periodStrip(habit: Habit, today: Date, n: number): StripCell[] {
  const current = periodStart(habit.period, today);
  const cells: StripCell[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const start = addPeriods(habit.period, current, -i);
    const { done, complete } = periodProgress(habit, start);
    const dayMonth = start.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    cells.push({
      key: toDateKey(start),
      level: dayLevel(done, habit.target),
      complete,
      label:
        habit.period === "month"
          ? start.toLocaleDateString("fr-FR", { month: "short", year: "numeric" })
          : habit.period === "week"
            ? `sem. du ${dayMonth}`
            : dayMonth,
    });
  }
  return cells;
}

/** Nombre de cellules de la bande compacte d'une carte. */
export const STRIP_LENGTH: Record<HabitPeriod, number> = { day: 28, week: 16, month: 12 };

const PERIOD_WORD: Record<HabitPeriod, string> = { day: "jour", week: "semaine", month: "mois" };

/** « 8 verres / jour », « 3× / semaine », « Chaque jour ». */
export function goalLabel(habit: Habit): string {
  const per = PERIOD_WORD[habit.period];
  if (habit.unit) return `${habit.target} ${habit.unit} / ${per}`;
  if (habit.period === "day" && habit.target === 1) return "Chaque jour";
  return `${habit.target}× / ${per}`;
}

/** « toutes les 3 h », « 1× / jour à 8 h », « » si désactivé. */
export function remindLabel(habit: Habit): string {
  if (habit.remindEvery === 0) return "";
  if (habit.remindEvery === 24) return `1× / jour à ${habit.remindFrom} h`;
  if (habit.remindEvery === 1) return "toutes les heures";
  return `toutes les ${habit.remindEvery} h`;
}

const PERIOD_NOW: Record<HabitPeriod, string> = { day: "aujourd'hui", week: "cette semaine", month: "ce mois-ci" };

/** Corps de notification et sous-titre de ligne : « Pas encore fait aujourd'hui », « 1/3 cette semaine ». */
export function progressLabel(habit: Habit, today: Date): string {
  const { done, target } = periodProgress(habit, today);
  if (done === 0 && target === 1) return `Pas encore fait ${PERIOD_NOW[habit.period]}`;
  return `${done}/${target} ${PERIOD_NOW[habit.period]}`;
}

/**
 * Instants (ms) où rappeler `habit` dans `]now, now + horizonMs]`, en heure
 * locale. Un jour dont la période est déjà tenue n'a pas de créneau ; les
 * périodes futures repartent de zéro, donc sont toutes planifiées.
 */
export function reminderSlots(habit: Habit, now: Date, horizonMs: number): number[] {
  if (habit.archived || habit.remindEvery === 0) return [];
  const nowMs = now.getTime();
  const slots: number[] = [];
  const days = Math.ceil(horizonMs / 86_400_000);
  for (let i = 0; i <= days; i++) {
    const day = addDays(new Date(now.getFullYear(), now.getMonth(), now.getDate()), i);
    if (periodProgress(habit, day).complete) continue;
    const step = habit.remindEvery === 24 ? 24 : habit.remindEvery;
    for (let h = habit.remindFrom; h <= habit.remindTo; h += step) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).getTime();
      if (at > nowMs && at <= nowMs + horizonMs) slots.push(at);
    }
  }
  return slots;
}

/** Premier plan lisible sur la couleur d'une habitude (jamais `#fff` en dur : illisible sur jaune/lime). */
export function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // Seuil où les contrastes WCAG contre blanc et contre noir s'égalisent.
  return lum > 0.179 ? "#111111" : "#ffffff";
}
