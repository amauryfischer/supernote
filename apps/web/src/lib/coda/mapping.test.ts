import { describe, it, expect } from "vitest";
import {
  mapColumn,
  cellToValue,
  relationRefs,
  fieldIdForColumn,
  rowToScalarFields,
  rowToRelationFields,
  CODA_ROW_ID_FIELD,
  type MappedColumn,
} from "./mapping";
import type { CodaColumn, CodaRow } from "./types";

function col(id: string, name: string, format: CodaColumn["format"]): CodaColumn {
  return { id, name, format };
}

const allSelected = () => true;
const noneSelected = () => false;

describe("mapColumn", () => {
  it("maps scalar Coda types to the right FieldKind", () => {
    expect(mapColumn(col("c1", "Age", { type: "number" }), noneSelected)?.kind).toBe("number");
    expect(mapColumn(col("c2", "Done", { type: "checkbox" }), noneSelected)?.kind).toBe("bool");
    expect(mapColumn(col("c3", "When", { type: "dateTime" }), noneSelected)?.kind).toBe("datetime");
    expect(mapColumn(col("c4", "Notes", { type: "canvas" }), noneSelected)?.kind).toBe("markdown");
    expect(mapColumn(col("c5", "Mail", { type: "email" }), noneSelected)?.kind).toBe("email");
    expect(mapColumn(col("c6", "Owner", { type: "person" }), noneSelected)?.kind).toBe("text");
  });

  it("carries the currency code", () => {
    const m = mapColumn(col("c", "Price", { type: "currency", currencyCode: "EUR" }), noneSelected);
    expect(m?.kind).toBe("currency");
    expect(m?.currencyCode).toBe("EUR");
  });

  it("maps select to multiselect when the column is an array", () => {
    expect(mapColumn(col("c", "Tags", { type: "select", isArray: true }), noneSelected)?.kind).toBe(
      "multiselect",
    );
    expect(mapColumn(col("c", "Tag", { type: "select" }), noneSelected)?.kind).toBe("select");
  });

  it("reconstructs a relation when the target table is in the selection", () => {
    const m = mapColumn(
      col("c", "Company", { type: "lookup", table: { id: "grid-co" }, isArray: false }),
      (id) => id === "grid-co",
    );
    expect(m?.kind).toBe("relation");
    expect(m?.targetTableId).toBe("grid-co");
    expect(m?.cardinality).toBe("one_to_one");
  });

  it("flattens a lookup to text when the target table is not imported", () => {
    const m = mapColumn(
      col("c", "Company", { type: "lookup", table: { id: "grid-co" } }),
      noneSelected,
    );
    expect(m?.kind).toBe("text");
    expect(m?.targetTableId).toBeUndefined();
  });

  it("uses many_to_many for an array relation", () => {
    const m = mapColumn(
      col("c", "Members", { type: "lookup", table: { id: "grid-p" }, isArray: true }),
      allSelected,
    );
    expect(m?.cardinality).toBe("many_to_many");
  });

  it("skips buttons", () => {
    expect(mapColumn(col("c", "Go", { type: "button" }), noneSelected)).toBeNull();
  });

  it("derives a stable field id from the column id", () => {
    expect(fieldIdForColumn("c-AbC123")).toBe("coda_c_AbC123");
    const m = mapColumn(col("c-AbC123", "My Col!", { type: "text" }), noneSelected);
    expect(m?.fieldId).toBe("coda_c_AbC123");
    expect(m?.name).toBe("my_col");
    expect(m?.label).toBe("My Col!");
  });
});

describe("cellToValue", () => {
  it("coerces booleans", () => {
    expect(cellToValue(true, "bool")).toBe(true);
    expect(cellToValue("true", "bool")).toBe(true);
    expect(cellToValue(false, "bool")).toBe(false);
  });

  it("reads numbers, including structured monetary amounts", () => {
    expect(cellToValue(42, "number")).toBe(42);
    expect(cellToValue({ "@type": "MonetaryAmount", amount: 12.5, currency: "EUR" }, "currency")).toBe(
      12.5,
    );
    expect(cellToValue("not-a-number", "number")).toBeNull();
  });

  it("flattens a structured lookup to its display name for text", () => {
    expect(
      cellToValue({ "@type": "StructuredValue", additionalType: "row", name: "Acme", rowId: "i-1" }, "text"),
    ).toBe("Acme");
  });

  it("joins array values for text and keeps arrays for multiselect", () => {
    expect(cellToValue(["a", "b"], "text")).toBe("a, b");
    expect(cellToValue(["a", "b"], "multiselect")).toEqual(["a", "b"]);
    expect(
      cellToValue([{ name: "X" }, { name: "Y" }] as never, "multiselect"),
    ).toEqual(["X", "Y"]);
  });

  it("extracts image/file urls", () => {
    expect(cellToValue({ url: "https://x/y.png" } as never, "image")).toBe("https://x/y.png");
    expect(
      cellToValue([{ url: "a" }, { url: "b" }] as never, "file"),
    ).toEqual(["a", "b"]);
  });

  it("returns null for empty cells", () => {
    expect(cellToValue(null, "text")).toBeNull();
    expect(cellToValue("", "text")).toBeNull();
  });
});

describe("relationRefs", () => {
  it("extracts a single row reference", () => {
    expect(
      relationRefs({ "@type": "StructuredValue", additionalType: "row", rowId: "i-1", tableId: "grid-co" }),
    ).toEqual([{ tableId: "grid-co", rowId: "i-1" }]);
  });

  it("extracts every reference from a multi-value cell", () => {
    expect(
      relationRefs([
        { rowId: "i-1", tableId: "t" },
        { rowId: "i-2", tableId: "t" },
      ] as never),
    ).toEqual([
      { tableId: "t", rowId: "i-1" },
      { tableId: "t", rowId: "i-2" },
    ]);
  });

  it("ignores scalar cells and structured values without a rowId", () => {
    expect(relationRefs("plain")).toEqual([]);
    expect(relationRefs({ name: "no row id" } as never)).toEqual([]);
    expect(relationRefs(null)).toEqual([]);
  });
});

describe("rowToScalarFields", () => {
  const columns: MappedColumn[] = [
    { fieldId: "coda_c1", codaColumnId: "c1", name: "name", label: "Name", kind: "text" },
    { fieldId: "coda_c2", codaColumnId: "c2", name: "age", label: "Age", kind: "number" },
    { fieldId: "coda_c3", codaColumnId: "c3", name: "company", label: "Company", kind: "relation", targetTableId: "grid-co", cardinality: "one_to_one" },
  ];

  it("keys scalars by field name, sets _codaRowId, skips relations and empties", () => {
    const row: CodaRow = {
      id: "i-1",
      values: { c1: "Alice", c2: 30, c3: { rowId: "i-co", tableId: "grid-co" } as never },
    };
    const fields = rowToScalarFields(columns, row);
    expect(fields).toEqual({ name: "Alice", age: 30, [CODA_ROW_ID_FIELD]: "i-1" });
    expect(fields).not.toHaveProperty("company"); // relation wired separately
  });

  it("omits null/empty cells", () => {
    const row: CodaRow = { id: "i-2", values: { c1: "", c2: null } };
    expect(rowToScalarFields(columns, row)).toEqual({ [CODA_ROW_ID_FIELD]: "i-2" });
  });
});

describe("rowToRelationFields", () => {
  const columns: MappedColumn[] = [
    { fieldId: "coda_c3", codaColumnId: "c3", name: "company", label: "Company", kind: "relation", targetTableId: "grid-co", cardinality: "one_to_one" },
    { fieldId: "coda_c4", codaColumnId: "c4", name: "members", label: "Members", kind: "relation", targetTableId: "grid-p", cardinality: "many_to_many" },
  ];
  // Map Coda (table,row) → Supernote entity id.
  const resolve = (tableId: string | null, rowId: string, fallback?: string) => {
    const t = tableId ?? fallback;
    const m: Record<string, string> = { "grid-co:i-co1": "ent-co1", "grid-p:i-p1": "ent-p1", "grid-p:i-p2": "ent-p2" };
    return m[`${t}:${rowId}`];
  };

  it("resolves one_to_one to a single id and many to an array", () => {
    const row: CodaRow = {
      id: "i-1",
      values: {
        c3: { rowId: "i-co1", tableId: "grid-co" } as never,
        c4: [{ rowId: "i-p1", tableId: "grid-p" }, { rowId: "i-p2", tableId: "grid-p" }] as never,
      },
    };
    expect(rowToRelationFields(columns, row, resolve)).toEqual({
      company: "ent-co1",
      members: ["ent-p1", "ent-p2"],
    });
  });

  it("drops references whose target row was not imported", () => {
    const row: CodaRow = {
      id: "i-1",
      values: { c4: [{ rowId: "i-p1", tableId: "grid-p" }, { rowId: "i-missing", tableId: "grid-p" }] as never },
    };
    expect(rowToRelationFields(columns, row, resolve)).toEqual({ members: ["ent-p1"] });
  });

  it("falls back to the column target table when the ref omits tableId", () => {
    const row: CodaRow = { id: "i-1", values: { c3: { rowId: "i-co1" } as never } };
    expect(rowToRelationFields(columns, row, resolve)).toEqual({ company: "ent-co1" });
  });
});
