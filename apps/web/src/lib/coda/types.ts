/**
 * Minimal typing of the Coda REST API v1 shapes the read-only importer reads.
 * Only the fields we consume are modelled; everything else is ignored.
 *
 * Rows are fetched with `valueFormat=rich`, so cell values are either scalars
 * (string / number / boolean) or JSON-LD `StructuredValue` objects (lookups,
 * people, images, links) — see {@link CodaRichValue}.
 */

export interface CodaDoc {
  id: string;
  name: string;
  /** Optional: present on some responses, used only for display. */
  browserLink?: string;
}

export interface CodaTable {
  id: string;
  name: string;
  /** "table" | "view" — we import base tables; views are skipped by the UI. */
  tableType?: string;
}

/** Coda column format. `type` is the ColumnFormatType discriminator. */
export interface CodaColumnFormat {
  type: string;
  /** True when the column holds multiple values (multi-select, multi-lookup). */
  isArray?: boolean;
  /** For lookup/relation columns: the referenced table. */
  table?: { id: string; name?: string; tableId?: string };
  /** For currency columns. */
  currencyCode?: string;
  precision?: number;
}

export interface CodaColumn {
  id: string;
  name: string;
  format: CodaColumnFormat;
}

/**
 * A rich cell value. Coda returns scalars directly, or a JSON-LD object for
 * structured values. Relation/lookup cells carry `additionalType: "row"` plus a
 * `rowId`; people/links/images carry `name`/`url`. Multi-value cells are arrays.
 */
export type CodaRichValue =
  | string
  | number
  | boolean
  | null
  | CodaStructuredValue
  | CodaRichValue[];

export interface CodaStructuredValue {
  "@type"?: string;
  additionalType?: string;
  name?: string;
  url?: string;
  /** Present on relation/lookup row references. */
  rowId?: string;
  tableId?: string;
  /** Monetary amounts. */
  amount?: number;
  currency?: string;
  [key: string]: unknown;
}

export interface CodaRow {
  id: string;
  name?: string;
  /** Keyed by column id when listed with `useColumnNames=false` (the default). */
  values: Record<string, CodaRichValue>;
}

export interface CodaListResponse<T> {
  items: T[];
  nextPageToken?: string;
  nextPageLink?: string;
}
