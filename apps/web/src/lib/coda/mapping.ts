/**
 * Pure Coda → Supernote mapping. No I/O, no worker — fully unit-testable.
 *
 * Two concerns:
 *   1. SCHEMA — turn a Coda column into a Supernote field descriptor
 *      ({@link mapColumn}): pick a FieldKind, and for relation/lookup columns
 *      decide relation-vs-flatten based on whether the target table is in the
 *      import selection.
 *   2. VALUES — turn a rich Coda cell into a Supernote field value
 *      ({@link cellToValue}) and extract relation row references
 *      ({@link relationRefs}) for the second import pass.
 */

import type { FieldKind } from "@supernote/core";
import type {
  CodaColumn,
  CodaRichValue,
  CodaRow,
  CodaStructuredValue,
} from "./types";

/** Reserved field key holding the Coda row id — the refresh reconciliation key. */
export const CODA_ROW_ID_FIELD = "_codaRowId";

/** A scalar value stored in `entity.fields` (relations are wired separately). */
export type CellValue = string | number | boolean | string[] | null;

/** Supernote field derived from a Coda column. */
export interface MappedColumn {
  /** Stable id derived from the Coda column id — survives refresh. */
  fieldId: string;
  /** Coda column id, key into the rich row `values`. */
  codaColumnId: string;
  /** Machine slug (frontmatter key). */
  name: string;
  /** Human label (the Coda column name). */
  label: string;
  kind: FieldKind;
  /** For `relation` kind: the Coda target table id (resolved to a base later). */
  targetTableId?: string;
  /** For `relation` kind. */
  cardinality?: "one_to_one" | "many_to_many";
  /** For `currency` kind. */
  currencyCode?: string;
}

function slug(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "col"
  );
}

/** Stable field id from a Coda column id (e.g. "c-AbC" → "coda_c_AbC"). */
export function fieldIdForColumn(codaColumnId: string): string {
  return "coda_" + codaColumnId.replace(/[^A-Za-z0-9]/g, "_");
}

/**
 * Map a Coda column to a Supernote field. Returns null for columns with no
 * sensible local representation (buttons), which the importer skips.
 *
 * `isTargetSelected(tableId)` reports whether a lookup column's target table is
 * part of the same import — only then is the column reconstructed as a relation;
 * otherwise it is flattened to display text.
 */
export function mapColumn(
  column: CodaColumn,
  isTargetSelected: (tableId: string) => boolean,
): MappedColumn | null {
  const base = {
    fieldId: fieldIdForColumn(column.id),
    codaColumnId: column.id,
    name: slug(column.name),
    label: column.name,
  };
  const fmt = column.format ?? { type: "text" };
  const t = fmt.type;

  switch (t) {
    case "number":
    case "slider":
    case "scale":
      return { ...base, kind: "number" };
    case "percent":
      return { ...base, kind: "percent" };
    case "currency":
      return { ...base, kind: "currency", currencyCode: fmt.currencyCode };
    case "date":
      return { ...base, kind: "date" };
    case "dateTime":
      return { ...base, kind: "datetime" };
    case "duration":
      return { ...base, kind: "duration" };
    case "checkbox":
      return { ...base, kind: "bool" };
    case "select":
      return { ...base, kind: fmt.isArray ? "multiselect" : "select" };
    case "email":
      return { ...base, kind: "email" };
    case "link":
      return { ...base, kind: "url" };
    case "image":
      return { ...base, kind: "image" };
    case "attachments":
      return { ...base, kind: "file" };
    case "canvas":
      return { ...base, kind: "markdown" };
    case "button":
      return null; // no local equivalent
    case "lookup":
    case "reference": {
      const targetTableId = fmt.table?.id ?? fmt.table?.tableId;
      if (targetTableId && isTargetSelected(targetTableId)) {
        return {
          ...base,
          kind: "relation",
          targetTableId,
          cardinality: fmt.isArray ? "many_to_many" : "one_to_one",
        };
      }
      // Target not imported → flatten to the display value(s).
      return { ...base, kind: "text" };
    }
    case "person":
    case "reaction":
    case "text":
    default:
      return { ...base, kind: "text" };
  }
}

function isStructured(v: CodaRichValue): v is CodaStructuredValue {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Display text of one structured value (lookup name, person name, link url…). */
function structuredText(v: CodaStructuredValue): string {
  if (typeof v.name === "string" && v.name) return v.name;
  if (typeof v.url === "string" && v.url) return v.url;
  if (typeof v.amount === "number") return String(v.amount);
  return "";
}

/** Flatten any rich value to a display string (used for text/email/url/person). */
function richToText(v: CodaRichValue): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(richToText).filter(Boolean).join(", ");
  if (isStructured(v)) return structuredText(v);
  return String(v);
}

/**
 * Convert a rich Coda cell to a Supernote scalar field value for a given kind.
 * Relation columns are NOT handled here — they are wired in the second pass via
 * {@link relationRefs}.
 */
export function cellToValue(v: CodaRichValue, kind: FieldKind): CellValue {
  if (v == null) return null;

  switch (kind) {
    case "bool":
      return typeof v === "boolean" ? v : v === "true" || v === 1;
    case "number":
    case "percent":
    case "currency":
    case "duration": {
      if (typeof v === "number") return v;
      if (isStructured(v) && typeof v.amount === "number") return v.amount;
      const n = Number(richToText(v));
      return Number.isFinite(n) ? n : null;
    }
    case "multiselect": {
      const arr = Array.isArray(v) ? v : [v];
      return arr.map(richToText).filter(Boolean);
    }
    case "image":
    case "file": {
      const arr = Array.isArray(v) ? v : [v];
      const urls = arr
        .map((x) => (isStructured(x) ? x.url : typeof x === "string" ? x : ""))
        .filter((u): u is string => !!u);
      return urls.length <= 1 ? urls[0] ?? null : urls;
    }
    default:
      // text, longtext, markdown, email, url, select, date, datetime, person…
      return richToText(v) || null;
  }
}

/**
 * Extract the row references of a relation/lookup cell, for resolving against
 * the imported entities in the second pass. Returns one entry per linked row.
 */
export function relationRefs(
  v: CodaRichValue,
): { tableId: string | null; rowId: string }[] {
  const out: { tableId: string | null; rowId: string }[] = [];
  const walk = (x: CodaRichValue): void => {
    if (x == null) return;
    if (Array.isArray(x)) {
      x.forEach(walk);
      return;
    }
    if (isStructured(x) && typeof x.rowId === "string" && x.rowId) {
      out.push({ tableId: typeof x.tableId === "string" ? x.tableId : null, rowId: x.rowId });
    }
  };
  walk(v);
  return out;
}

/**
 * Build the scalar (non-relation) `entity.fields` record for a Coda row, keyed
 * by field NAME (the convention the rest of the app uses). Empty values are
 * omitted; the reserved {@link CODA_ROW_ID_FIELD} is always set so a refresh can
 * reconcile rows. Relation columns are wired separately (see
 * {@link rowToRelationFields}).
 */
export function rowToScalarFields(
  columns: MappedColumn[],
  row: CodaRow,
): Record<string, CellValue> {
  const out: Record<string, CellValue> = {};
  for (const c of columns) {
    if (c.kind === "relation") continue;
    const v = cellToValue(row.values[c.codaColumnId] ?? null, c.kind);
    if (v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[c.name] = v;
  }
  out[CODA_ROW_ID_FIELD] = row.id;
  return out;
}

/**
 * Build the relation `entity.fields` record for a Coda row. `resolve` maps a
 * Coda (tableId, rowId) reference to the Supernote entity id of the imported
 * target row, or undefined if that row was not imported (then it's dropped).
 * Values are a single id for one_to_one, else an array.
 */
export function rowToRelationFields(
  columns: MappedColumn[],
  row: CodaRow,
  resolve: (tableId: string | null, rowId: string, fallbackTableId?: string) => string | undefined,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const c of columns) {
    if (c.kind !== "relation") continue;
    const ids = relationRefs(row.values[c.codaColumnId] ?? null)
      .map((r) => resolve(r.tableId, r.rowId, c.targetTableId))
      .filter((x): x is string => !!x);
    if (ids.length === 0) continue;
    out[c.name] = c.cardinality === "one_to_one" ? (ids[0] as string) : ids;
  }
  return out;
}
