/**
 * Pure helpers backing the /todos bulk-selection feature. Kept free of React
 * so the selection arithmetic (which rows are deletable, whether the batch is
 * fully done, which rows actually need a write) is unit-testable in isolation.
 */

/** Minimal shape the selection logic needs from a todo row. */
export interface SelectableTodo {
  id: string;
  done: boolean;
  /** "standalone" rows back a `todo` entity and can be deleted; "note" rows
   *  are projected from a note's markdown and cannot be deleted here. */
  kind: "note" | "standalone";
}

/** Rows whose id is in `selectedIds`, preserving the input order. */
export function resolveSelected<T extends { id: string }>(
  rows: readonly T[],
  selectedIds: ReadonlySet<string>,
): T[] {
  return rows.filter((r) => selectedIds.has(r.id));
}

/** True when there is at least one selected row and every one is already done.
 *  Drives whether the bulk bar offers "reopen" instead of "complete". */
export function allSelectedDone(selected: readonly SelectableTodo[]): boolean {
  return selected.length > 0 && selected.every((r) => r.done);
}

/** Count of selected rows that can actually be deleted (standalone only). */
export function deletableCount(selected: readonly SelectableTodo[]): number {
  return selected.filter((r) => r.kind === "standalone").length;
}

/** Rows that need a write to reach the target `done` state — already-correct
 *  rows are skipped so the batch issues no redundant mutations. */
export function rowsNeedingDone<T extends SelectableTodo>(
  selected: readonly T[],
  done: boolean,
): T[] {
  return selected.filter((r) => r.done !== done);
}

/** Selected rows that are eligible for deletion (standalone). */
export function rowsToDelete<T extends SelectableTodo>(selected: readonly T[]): T[] {
  return selected.filter((r) => r.kind === "standalone");
}

/** Drop ids that no longer match any known row. Returns the same Set instance
 *  when nothing changed so callers can bail out of a state update. */
export function pruneSelection(
  selectedIds: ReadonlySet<string>,
  validRows: readonly { id: string }[],
): Set<string> {
  if (selectedIds.size === 0) return selectedIds as Set<string>;
  const valid = new Set(validRows.map((r) => r.id));
  let changed = false;
  const next = new Set<string>();
  for (const id of selectedIds) {
    if (valid.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : (selectedIds as Set<string>);
}
