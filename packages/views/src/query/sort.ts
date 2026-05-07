import type { Entity, FieldValue } from "@supernote/core/types";
import type { SortClause } from "../types/index.js";

function compareValues(a: FieldValue, b: FieldValue): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

export function applySort<T extends Entity>(
  entities: T[],
  sort: SortClause[]
): T[] {
  if (sort.length === 0) return entities;
  return [...entities].sort((a, b) => {
    for (const clause of sort) {
      const av = a.fields[clause.fieldId];
      const bv = b.fields[clause.fieldId];
      const cmp = compareValues(av, bv);
      if (cmp !== 0) return clause.direction === "asc" ? cmp : -cmp;
    }
    return 0;
  });
}
