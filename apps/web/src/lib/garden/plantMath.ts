/**
 * plantMath — logique pure du Jardin digital : transforme une note (dates +
 * backlinks) en plante (stade de vie, espèce, floraison). Aucune dépendance
 * React/DOM → testable isolément.
 */

export type PlantStage = "thriving" | "growing" | "dormant" | "withering";

export interface GardenNoteInput {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly createdAt: string;
  readonly backlinks: number;
}

export interface Plant {
  readonly id: string;
  readonly title: string;
  readonly stage: PlantStage;
  readonly daysSinceUpdate: number;
  readonly backlinks: number;
  /** Fleurit dès qu'au moins un backlink existe. */
  readonly flowering: boolean;
  /** Hauteur relative 0..1 (vigueur ↔ stade + liens). */
  readonly vigor: number;
  /** Indice d'espèce stable dérivé de l'id (variété visuelle). */
  readonly species: number;
}

const DAY_MS = 1000 * 60 * 60 * 24;

export function daysSince(iso: string, now: number): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

export function stageFor(daysSinceUpdate: number): PlantStage {
  if (daysSinceUpdate <= 2) return "thriving";
  if (daysSinceUpdate <= 14) return "growing";
  if (daysSinceUpdate <= 90) return "dormant";
  return "withering";
}

/** Hash déterministe d'une chaîne (variété d'espèce sans Math.random). */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const STAGE_BASE_VIGOR: Record<PlantStage, number> = {
  thriving: 0.85,
  growing: 0.6,
  dormant: 0.38,
  withering: 0.18,
};

export function toPlant(note: GardenNoteInput, now: number): Plant {
  const d = daysSince(note.updatedAt, now);
  const stage = stageFor(d);
  const base = STAGE_BASE_VIGOR[stage];
  // Les liens dopent la vigueur (saturation douce), plafonnée à 1.
  const linkBoost = Math.min(0.15, note.backlinks * 0.03);
  const vigor = Math.min(1, base + linkBoost);
  return {
    id: note.id,
    title: note.title,
    stage,
    daysSinceUpdate: d,
    backlinks: note.backlinks,
    flowering: note.backlinks > 0,
    vigor,
    species: hashString(note.id) % 4,
  };
}

export interface GardenStats {
  readonly total: number;
  readonly thriving: number;
  readonly withering: number;
  readonly flowering: number;
}

export function gardenStats(plants: readonly Plant[]): GardenStats {
  let thriving = 0;
  let withering = 0;
  let flowering = 0;
  for (const p of plants) {
    if (p.stage === "thriving") thriving++;
    if (p.stage === "withering") withering++;
    if (p.flowering) flowering++;
  }
  return { total: plants.length, thriving, withering, flowering };
}

/** Tri de plantation : plus vigoureuses au premier plan (bas), fanées au fond. */
export function plantingOrder(plants: readonly Plant[]): Plant[] {
  return [...plants].sort((a, b) => a.vigor - b.vigor);
}
