/**
 * mail-selection — logique PURE de la sélection multiple desktop de la boîte
 * mail. Une « ligne d'overlay » (cf. `mail-overlay`) peut être un thread seul
 * (`single`) ou un groupe (label / expéditeur) qui agrège plusieurs threads.
 *
 * La sélection raisonne TOUJOURS en threadIds (et non en clés de ligne) : cocher
 * un groupe revient à sélectionner tous ses threads, de sorte que les actions
 * groupées (archiver / supprimer / marquer lu) s'appliquent uniformément, qu'on
 * ait coché des lignes seules ou des groupes. Aucun effet de bord ici (pas de
 * réseau, pas de localStorage) : 100 % testable.
 */

import type { OverlayRow } from "@/lib/mail-overlay";

/** Tous les threadIds portés par une ligne d'overlay (1 pour un single, N pour un groupe). */
export function rowThreadIds(row: OverlayRow): string[] {
  return row.kind === "single" ? [row.item.id] : row.items.map((it) => it.id);
}

/**
 * État d'une case d'une ligne vis-à-vis d'une sélection de threadIds :
 *  - "checked"       : tous les threads de la ligne sont sélectionnés.
 *  - "indeterminate" : une partie seulement (groupe partiellement coché).
 *  - "unchecked"     : aucun.
 * PUR. Pour un single, jamais "indeterminate" (un seul thread).
 */
export function rowCheckState(
  row: OverlayRow,
  selected: ReadonlySet<string>,
): "checked" | "indeterminate" | "unchecked" {
  const ids = rowThreadIds(row);
  if (ids.length === 0) return "unchecked";
  const hits = ids.filter((id) => selected.has(id)).length;
  if (hits === 0) return "unchecked";
  if (hits === ids.length) return "checked";
  return "indeterminate";
}

/**
 * Bascule la sélection de TOUS les threads d'une ligne. Règle : si la ligne est
 * entièrement cochée, on la décoche ; sinon (unchecked ou indeterminate) on la
 * coche entièrement. Renvoie un NOUVEAU Set (immutabilité → re-render React
 * fiable). PUR.
 */
export function toggleRowSelection(
  row: OverlayRow,
  selected: ReadonlySet<string>,
): Set<string> {
  const ids = rowThreadIds(row);
  const next = new Set(selected);
  const fullyChecked = ids.length > 0 && ids.every((id) => next.has(id));
  if (fullyChecked) {
    for (const id of ids) next.delete(id);
  } else {
    for (const id of ids) next.add(id);
  }
  return next;
}

/**
 * Restreint une sélection aux threadIds qui existent ENCORE dans `rows`. Sert à
 * « nettoyer » la sélection après un rechargement / triage : les threads qui ne
 * sont plus dans la liste (archivés, supprimés…) sont retirés de la sélection.
 * Renvoie un nouveau Set. PUR.
 */
export function pruneSelection(
  selected: ReadonlySet<string>,
  rows: readonly OverlayRow[],
): Set<string> {
  const live = new Set<string>();
  for (const r of rows) for (const id of rowThreadIds(r)) live.add(id);
  const next = new Set<string>();
  for (const id of selected) if (live.has(id)) next.add(id);
  return next;
}
