// ============================================================
// Résolution des échéances exprimées en français courant
// ============================================================

import { foldForIndex } from "./text.js";

export interface DeadlineMatch {
  /** Date calendaire ISO `YYYY-MM-DD`. */
  iso: string;
  /** Bornes de l'expression dans le texte d'ORIGINE (préposition comprise). */
  start: number;
  end: number;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const out = startOfDay(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const WEEKDAYS: Record<string, number> = {
  dimanche: 0,
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
};

/** Prochaine occurrence STRICTEMENT après aujourd'hui. */
function nextWeekday(now: Date, target: number): Date {
  const delta = (target - startOfDay(now).getDay() + 7) % 7;
  return addDays(now, delta === 0 ? 7 : delta);
}

function isValidYmd(y: number, m: number, d: number): boolean {
  const probe = new Date(y, m - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

// Préposition optionnelle absorbée dans la capture pour que le retrait de
// l'expression laisse un texte propre (« rappeler le notaire », pas
// « rappeler le notaire avant »).
const PREP = "(?:(?:au plus tard\\s+)?(?:avant|apres|d['’]ici|pour|vers|le|la|ce|cette)\\s+)?";

interface Rule {
  re: RegExp;
  resolve: (m: RegExpExecArray, now: Date) => Date | null;
}

const RULES: Rule[] = [
  {
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/,
    resolve: (m) => {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      return isValidYmd(y, mo, d) ? new Date(y, mo - 1, d) : null;
    },
  },
  {
    re: new RegExp(`${PREP}\\b(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?\\b`),
    resolve: (m, now) => {
      const day = Number(m[1]);
      const month = Number(m[2]);
      const rawYear = m[3];
      if (rawYear !== undefined) {
        const y = rawYear.length <= 2 ? 2000 + Number(rawYear) : Number(rawYear);
        return isValidYmd(y, month, day) ? new Date(y, month - 1, day) : null;
      }
      // Sans année : l'occurrence à venir. Une date déjà passée cette année
      // désigne l'an prochain, jamais le passé — une échéance est future.
      const thisYear = now.getFullYear();
      for (const y of [thisYear, thisYear + 1]) {
        if (!isValidYmd(y, month, day)) continue;
        const candidate = new Date(y, month - 1, day);
        if (candidate >= startOfDay(now)) return candidate;
      }
      return null;
    },
  },
  {
    re: /\b(?:aujourd['’]hui|ce soir|dans la journee|en fin de journee)\b/,
    resolve: (_m, now) => startOfDay(now),
  },
  { re: /\bapres[- ]demain\b/, resolve: (_m, now) => addDays(now, 2) },
  {
    re: /\bdemain(?:\s+(?:matin|midi|soir|apres-midi))?\b/,
    resolve: (_m, now) => addDays(now, 1),
  },
  {
    re: /\bdans\s+(\d{1,2})\s+jours?\b/,
    resolve: (m, now) => addDays(now, Number(m[1])),
  },
  {
    re: /\bdans\s+(?:une|1)\s+semaine\b/,
    resolve: (_m, now) => addDays(now, 7),
  },
  {
    re: /\bdans\s+(\d{1,2})\s+semaines\b/,
    resolve: (m, now) => addDays(now, 7 * Number(m[1])),
  },
  {
    re: /\b(?:la\s+|des\s+)?semaine\s+prochaine\b/,
    resolve: (_m, now) => {
      const day = startOfDay(now).getDay();
      // Lundi de la semaine suivante : un « la semaine prochaine » sans autre
      // précision se pose sur son premier jour ouvré.
      return addDays(now, ((8 - day) % 7) || 7);
    },
  },
  {
    re: /\b(?:en\s+|d['’]ici\s+|avant\s+)?(?:la\s+)?fin\s+(?:de\s+(?:la\s+)?)?semaine\b/,
    resolve: (_m, now) => {
      const day = startOfDay(now).getDay();
      // Samedi/dimanche : la « fin de semaine » visée est celle qui vient.
      return day === 0 || day === 6 ? nextWeekday(now, 5) : addDays(now, 5 - day);
    },
  },
  { re: /\b(?:ce\s+)?week[- ]?end\b/, resolve: (_m, now) => nextWeekday(now, 6) },
  {
    re: /\b(?:avant\s+)?(?:la\s+)?fin\s+du\s+mois\b/,
    resolve: (_m, now) => new Date(now.getFullYear(), now.getMonth() + 1, 0),
  },
  {
    re: /\b(?:le\s+)?mois\s+prochain\b/,
    resolve: (_m, now) => new Date(now.getFullYear(), now.getMonth() + 1, 1),
  },
  {
    re: new RegExp(
      `${PREP}\\b(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)\\b(?:\\s+prochain)?`,
    ),
    resolve: (m, now) => {
      const target = WEEKDAYS[m[1] ?? ""];
      return target === undefined ? null : nextWeekday(now, target);
    },
  },
];

/**
 * Première échéance exprimée dans `text`, avec ses bornes dans le texte
 * d'origine. Une expression non comprise rend `null` — l'appelant crée alors
 * la tâche sans date plutôt que rien.
 */
export function findFrenchDeadline(text: string, now: Date): DeadlineMatch | null {
  if (!text) return null;
  const folded = foldForIndex(text);
  if (folded === null) return null;

  let best: { start: number; end: number; date: Date } | null = null;
  for (const rule of RULES) {
    const m = rule.re.exec(folded);
    if (!m || m[0].length === 0) continue;
    const date = rule.resolve(m, now);
    if (!date) continue;
    if (best === null || m.index < best.start) {
      best = { start: m.index, end: m.index + m[0].length, date };
    }
  }

  if (best === null) return null;
  return { iso: toIsoDate(best.date), start: best.start, end: best.end };
}

/** Variante « expression seule » : « demain matin » → `2026-09-07`. */
export function resolveFrenchDeadline(expr: string | null | undefined, now: Date): string | null {
  if (!expr?.trim()) return null;
  return findFrenchDeadline(expr, now)?.iso ?? null;
}

/**
 * Une date ISO rendue par le modèle n'est fiable que si elle tombe dans une
 * fenêtre plausible : sans date du jour dans son contexte, un modèle local
 * invente volontiers une année révolue.
 */
export function plausibleIsoDeadline(value: string | null | undefined, now: Date): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!isValidYmd(y, mo, d)) return null;
  const date = new Date(y, mo - 1, d);
  const floor = addDays(now, -1);
  const ceiling = addDays(now, 366 * 3);
  return date >= floor && date <= ceiling ? toIsoDate(date) : null;
}

/** Différence en jours calendaires — sert à qualifier l'urgence. */
export function daysUntil(iso: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Math.round((target.getTime() - startOfDay(now).getTime()) / 86_400_000);
}
