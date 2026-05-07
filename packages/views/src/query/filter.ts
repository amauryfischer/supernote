import type { Entity, FieldValue } from "@supernote/core/types";
import type { FilterClause, FilterOperator } from "../types/index.js";

function toString(v: FieldValue): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function toNumber(v: FieldValue): number {
  if (v instanceof Date) return v.getTime();
  return Number(v);
}

function applyOperator(
  value: FieldValue,
  operator: FilterOperator,
  filterValue: FilterClause["value"]
): boolean {
  if (operator === "isEmpty") return value == null || value === "";
  if (operator === "isNotEmpty") return value != null && value !== "";

  const str = toString(value).toLowerCase();
  const fStr = filterValue != null ? String(filterValue).toLowerCase() : "";

  switch (operator) {
    case "eq":
      return toString(value) === String(filterValue ?? "");
    case "neq":
      return toString(value) !== String(filterValue ?? "");
    case "lt":
      return toNumber(value) < toNumber(filterValue as FieldValue);
    case "lte":
      return toNumber(value) <= toNumber(filterValue as FieldValue);
    case "gt":
      return toNumber(value) > toNumber(filterValue as FieldValue);
    case "gte":
      return toNumber(value) >= toNumber(filterValue as FieldValue);
    case "contains":
      if (Array.isArray(value)) return value.map(String).some((v) => v.toLowerCase() === fStr);
      return str.includes(fStr);
    case "startsWith":
      return str.startsWith(fStr);
    case "endsWith":
      return str.endsWith(fStr);
    case "in": {
      const arr = Array.isArray(filterValue) ? filterValue.map(String) : [];
      return arr.includes(toString(value));
    }
    case "notIn": {
      const arr = Array.isArray(filterValue) ? filterValue.map(String) : [];
      return !arr.includes(toString(value));
    }
    default:
      return true;
  }
}

export function applyFilters<T extends Entity>(
  entities: T[],
  filters: FilterClause[]
): T[] {
  if (filters.length === 0) return entities;
  return entities.filter((entity) =>
    filters.every((clause) => {
      const value = entity.fields[clause.fieldId];
      return applyOperator(value, clause.operator, clause.value);
    })
  );
}
