import { describe, expect, it } from "vitest";
import {
  allSelectedDone,
  deletableCount,
  pruneSelection,
  resolveSelected,
  rowsNeedingDone,
  rowsToDelete,
  type SelectableTodo,
} from "./bulkSelection";

const a: SelectableTodo = { id: "a", done: false, kind: "standalone" };
const b: SelectableTodo = { id: "b", done: true, kind: "standalone" };
const c: SelectableTodo = { id: "c", done: false, kind: "note" };
const d: SelectableTodo = { id: "d", done: true, kind: "note" };
const rows: SelectableTodo[] = [a, b, c, d];

describe("resolveSelected", () => {
  it("keeps only selected rows, preserving input order", () => {
    const out = resolveSelected(rows, new Set(["c", "a"]));
    expect(out.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("returns empty for an empty selection", () => {
    expect(resolveSelected(rows, new Set())).toEqual([]);
  });
});

describe("allSelectedDone", () => {
  it("is false when nothing is selected", () => {
    expect(allSelectedDone([])).toBe(false);
  });

  it("is true only when every selected row is done", () => {
    expect(allSelectedDone([b, d])).toBe(true); // b, d both done
    expect(allSelectedDone([a, b])).toBe(false); // a not done
  });
});

describe("deletableCount", () => {
  it("counts only standalone rows", () => {
    expect(deletableCount(rows)).toBe(2); // a, b
    expect(deletableCount([c, d])).toBe(0); // both note-derived
  });
});

describe("rowsNeedingDone", () => {
  it("returns rows whose done state differs from the target", () => {
    // target = done:true → a (false) and c (false) need a write
    expect(rowsNeedingDone(rows, true).map((r) => r.id)).toEqual(["a", "c"]);
    // target = done:false → b (true) and d (true) need a write
    expect(rowsNeedingDone(rows, false).map((r) => r.id)).toEqual(["b", "d"]);
  });

  it("issues no work when every row already matches", () => {
    expect(rowsNeedingDone([b, d], true)).toEqual([]);
  });
});

describe("rowsToDelete", () => {
  it("yields only standalone rows", () => {
    expect(rowsToDelete(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("pruneSelection", () => {
  it("drops ids that no longer exist and returns a new Set", () => {
    const prev = new Set(["a", "ghost", "c"]);
    const next = pruneSelection(prev, rows);
    expect([...next].sort()).toEqual(["a", "c"]);
    expect(next).not.toBe(prev);
  });

  it("returns the same Set instance when nothing changed", () => {
    const prev = new Set(["a", "b"]);
    expect(pruneSelection(prev, rows)).toBe(prev);
  });

  it("returns the same (empty) Set instance for an empty selection", () => {
    const prev = new Set<string>();
    expect(pruneSelection(prev, rows)).toBe(prev);
  });
});
