import type { FieldKind, FieldValue } from "../types/index.js";

/**
 * Coerce a raw value to the appropriate runtime type for a given FieldKind.
 * Returns the cast value or the original if no coercion applies.
 */
export function castFieldValue(value: unknown, kind: FieldKind): FieldValue {
  if (value === null || value === undefined) return null;

  switch (kind) {
    case "number":
    case "currency":
    case "percent":
    case "rating":
    case "progress":
    case "duration":
    case "autoNumber": {
      const n = Number(value);
      return isNaN(n) ? null : n;
    }

    case "bool":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === 1) return true;
      if (value === "false" || value === 0) return false;
      return null;

    case "date":
    case "datetime": {
      if (value instanceof Date) return value;
      const d = new Date(String(value));
      return isNaN(d.getTime()) ? null : d;
    }

    case "multiselect": {
      if (Array.isArray(value)) return value.map(String);
      if (typeof value === "string") return [value];
      return [];
    }

    case "text":
    case "longtext":
    case "url":
    case "email":
    case "phone":
    case "color":
    case "markdown":
    case "select":
    case "status":
      return value === null ? null : String(value);

    // Computed/relation fields: pass through as-is
    case "relation":
    case "formula":
    case "rollup":
    case "lookup":
    case "createdAt":
    case "updatedAt":
    case "createdBy":
    case "file":
    case "image":
      return value as FieldValue;

    default:
      return value as FieldValue;
  }
}
