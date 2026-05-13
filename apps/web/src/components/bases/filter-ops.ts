/**
 * Map FieldKind → list of FilterOps that make sense for it.
 *
 * Keeping the matrix here rather than scattering switches in the UI lets
 * FilterBuilder render a coherent operator dropdown per row. The labels are
 * shown directly in French — short, verb-like, and aligned with the way Notion
 * / AppFlowy phrase their filter operators.
 */

import type { Field, FieldKind, FilterOp } from "@supernote/core";

export interface FilterOpMeta {
  op: FilterOp;
  label: string;
  /**
   * Whether this operator needs a value input. `is_empty` / `is_not_empty`
   * don't (the value is implicit), so we render the row without an editor.
   */
  needsValue: boolean;
}

const TEXT_OPS: FilterOpMeta[] = [
  { op: "contains", label: "contient", needsValue: true },
  { op: "not_contains", label: "ne contient pas", needsValue: true },
  { op: "eq", label: "égal à", needsValue: true },
  { op: "neq", label: "différent de", needsValue: true },
  { op: "starts_with", label: "commence par", needsValue: true },
  { op: "ends_with", label: "se termine par", needsValue: true },
  { op: "is_empty", label: "est vide", needsValue: false },
  { op: "is_not_empty", label: "n'est pas vide", needsValue: false },
];

const NUMBER_OPS: FilterOpMeta[] = [
  { op: "eq", label: "=", needsValue: true },
  { op: "neq", label: "≠", needsValue: true },
  { op: "gt", label: ">", needsValue: true },
  { op: "gte", label: "≥", needsValue: true },
  { op: "lt", label: "<", needsValue: true },
  { op: "lte", label: "≤", needsValue: true },
  { op: "is_empty", label: "est vide", needsValue: false },
  { op: "is_not_empty", label: "n'est pas vide", needsValue: false },
];

const DATE_OPS: FilterOpMeta[] = [
  { op: "eq", label: "est", needsValue: true },
  { op: "neq", label: "n'est pas", needsValue: true },
  { op: "gt", label: "après", needsValue: true },
  { op: "lt", label: "avant", needsValue: true },
  { op: "gte", label: "à partir de", needsValue: true },
  { op: "lte", label: "jusqu'à", needsValue: true },
  { op: "is_empty", label: "est vide", needsValue: false },
  { op: "is_not_empty", label: "n'est pas vide", needsValue: false },
];

const BOOL_OPS: FilterOpMeta[] = [
  { op: "eq", label: "est", needsValue: true },
];

const SELECT_OPS: FilterOpMeta[] = [
  { op: "eq", label: "est", needsValue: true },
  { op: "neq", label: "n'est pas", needsValue: true },
  { op: "is_empty", label: "est vide", needsValue: false },
  { op: "is_not_empty", label: "n'est pas vide", needsValue: false },
];

const MULTISELECT_OPS: FilterOpMeta[] = [
  { op: "contains", label: "contient", needsValue: true },
  { op: "not_contains", label: "ne contient pas", needsValue: true },
  { op: "is_empty", label: "est vide", needsValue: false },
  { op: "is_not_empty", label: "n'est pas vide", needsValue: false },
];

export function opsForFieldKind(kind: FieldKind): FilterOpMeta[] {
  switch (kind) {
    case "text":
    case "longtext":
    case "url":
    case "email":
    case "phone":
    case "markdown":
    case "color":
      return TEXT_OPS;
    case "number":
    case "currency":
    case "percent":
    case "rating":
    case "progress":
    case "duration":
    case "autoNumber":
      return NUMBER_OPS;
    case "date":
    case "datetime":
    case "createdAt":
    case "updatedAt":
      return DATE_OPS;
    case "bool":
      return BOOL_OPS;
    case "select":
    case "status":
      return SELECT_OPS;
    case "multiselect":
      return MULTISELECT_OPS;
    default:
      // relation / formula / rollup / lookup / file / image / createdBy:
      // either not yet supported or only the empty check is meaningful.
      return [
        { op: "is_empty", label: "est vide", needsValue: false },
        { op: "is_not_empty", label: "n'est pas vide", needsValue: false },
      ];
  }
}

/**
 * Pick the default operator for a fresh filter row of this kind. Match what
 * the user is most likely to want as a starting point.
 */
export function defaultOpForFieldKind(kind: FieldKind): FilterOp {
  switch (kind) {
    case "number":
    case "currency":
    case "percent":
    case "rating":
    case "progress":
    case "duration":
    case "autoNumber":
      return "eq";
    case "bool":
    case "select":
    case "status":
      return "eq";
    case "multiselect":
      return "contains";
    case "date":
    case "datetime":
    case "createdAt":
    case "updatedAt":
      return "eq";
    default:
      return "contains";
  }
}

/**
 * Resolve a human label for a Field, falling back to its id when the
 * user-facing label is blank — better than printing nothing in the menu.
 */
export function labelForField(field: Field): string {
  return field.label || field.name || field.id;
}
