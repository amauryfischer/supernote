export { applyFilters } from "./filter.js";
export { applySort } from "./sort.js";

import type { Entity } from "@supernote/core/types";
import type { FilterClause, SortClause } from "../types/index.js";
import { applyFilters } from "./filter.js";
import { applySort } from "./sort.js";

export function queryEntities<T extends Entity>(
  entities: T[],
  filters: FilterClause[] = [],
  sort: SortClause[] = []
): T[] {
  return applySort(applyFilters(entities, filters), sort);
}
