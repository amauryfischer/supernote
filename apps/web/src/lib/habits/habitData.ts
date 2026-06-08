/**
 * habitData — logique pure du tracker d'habitudes (« jardin de pixels »).
 *
 * Une habitude = une entité `habit`. Les check-ins quotidiens vivent dans
 * `fields.checkins`, une map JSON-encodée `{ "YYYY-MM-DD": count }` — le
 * schéma IPC (`FieldValueSchema`) n'accepte que des scalaires/string[],
 * donc la map voyage en string et est (dé)sérialisée ici.
 *
 * Toutes les dates sont des clés locales (pas d'UTC) : une habitude cochée
 * à 23 h doit colorer le pixel du jour vécu, pas celui de Greenwich.
 */

export const HABIT_TYPE_ID = "habit";

export interface Habit {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** Nombre de check-ins requis pour valider la journée (≥ 1). */
  target: number;
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

export function parseHabit(e: HabitEntityLike): Habit {
  const f = e.fields;
  const target = typeof f["target"] === "number" && f["target"] >= 1 ? Math.floor(f["target"]) : 1;
  return {
    id: e.id,
    name: typeof f["name"] === "string" && f["name"].length > 0 ? f["name"] : "Sans nom",
    icon: typeof f["icon"] === "string" && f["icon"].length > 0 ? f["icon"] : DEFAULT_HABIT_ICON,
    color: typeof f["color"] === "string" && f["color"].length > 0 ? f["color"] : DEFAULT_HABIT_COLOR,
    target,
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
