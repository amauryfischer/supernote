const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Durée en une seule unité : « 12 min », « 4 h », « 3 j ». Vide si invalide. */
export function spanLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h`;
  return `${Math.floor(ms / DAY)} j`;
}

export type Heat = 1 | 2 | 3 | 4;

/** Chaleur d'une attente : 1 sous 4 h, 2 sous 24 h, 3 sous 3 jours, 4 au-delà. */
export function heatLevel(ms: number): Heat {
  if (!(ms >= 4 * HOUR)) return 1;
  if (ms < DAY) return 2;
  return ms < 3 * DAY ? 3 : 4;
}

console.assert(spanLabel(90 * MIN) === "1 h" && spanLabel(3 * DAY) === "3 j" && spanLabel(NaN) === "");
console.assert(heatLevel(HOUR) === 1 && heatLevel(5 * HOUR) === 2 && heatLevel(2 * DAY) === 3 && heatLevel(9 * DAY) === 4);
