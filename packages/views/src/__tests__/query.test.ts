import { describe, it, expect } from "vitest";
import { applyFilters, applySort, queryEntities } from "../query/index.js";
import { mockEntities } from "./fixtures.js";

describe("applyFilters", () => {
  it("returns all entities when no filters", () => {
    expect(applyFilters(mockEntities, [])).toHaveLength(4);
  });

  it("filters by eq operator", () => {
    const result = applyFilters(mockEntities, [{ fieldId: "status", operator: "eq", value: "todo" }]);
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.fields["status"] === "todo")).toBe(true);
  });

  it("filters by neq operator", () => {
    const result = applyFilters(mockEntities, [{ fieldId: "status", operator: "neq", value: "done" }]);
    expect(result).toHaveLength(3);
  });

  it("filters by lt operator", () => {
    const result = applyFilters(mockEntities, [{ fieldId: "priority", operator: "lt", value: 3 }]);
    expect(result).toHaveLength(2);
  });

  it("filters by gt operator", () => {
    const result = applyFilters(mockEntities, [{ fieldId: "priority", operator: "gt", value: 2 }]);
    expect(result).toHaveLength(2);
  });

  it("filters by contains (string)", () => {
    const result = applyFilters(mockEntities, [{ fieldId: "title", operator: "contains", value: "Alpha" }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("e1");
  });

  it("filters by startsWith", () => {
    const result = applyFilters(mockEntities, [{ fieldId: "title", operator: "startsWith", value: "Task" }]);
    expect(result).toHaveLength(4);
  });

  it("filters by isEmpty", () => {
    const result = applyFilters(mockEntities, [{ fieldId: "due_date", operator: "isEmpty" }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("e4");
  });

  it("filters by isNotEmpty", () => {
    const result = applyFilters(mockEntities, [{ fieldId: "due_date", operator: "isNotEmpty" }]);
    expect(result).toHaveLength(3);
  });

  it("filters by in operator", () => {
    const result = applyFilters(mockEntities, [{ fieldId: "status", operator: "in", value: ["todo", "done"] }]);
    expect(result).toHaveLength(3);
  });

  it("filters by notIn operator", () => {
    const result = applyFilters(mockEntities, [{ fieldId: "status", operator: "notIn", value: ["todo"] }]);
    expect(result).toHaveLength(2);
  });

  it("combines multiple filters (AND)", () => {
    const result = applyFilters(mockEntities, [
      { fieldId: "status", operator: "eq", value: "todo" },
      { fieldId: "priority", operator: "lt", value: 3 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("e1");
  });
});

describe("applySort", () => {
  it("returns copy when no sort clauses", () => {
    const result = applySort(mockEntities, []);
    expect(result).toHaveLength(4);
  });

  it("sorts by number field ascending", () => {
    const result = applySort(mockEntities, [{ fieldId: "priority", direction: "asc" }]);
    expect(result.map((e) => e.fields["priority"])).toEqual([1, 2, 3, 4]);
  });

  it("sorts by number field descending", () => {
    const result = applySort(mockEntities, [{ fieldId: "priority", direction: "desc" }]);
    expect(result.map((e) => e.fields["priority"])).toEqual([4, 3, 2, 1]);
  });

  it("sorts by string field ascending", () => {
    const result = applySort(mockEntities, [{ fieldId: "title", direction: "asc" }]);
    expect(result[0]?.fields["title"]).toBe("Task Alpha");
    expect(result[3]?.fields["title"]).toBe("Task Gamma");
  });

  it("does not mutate original array", () => {
    const copy = [...mockEntities];
    applySort(mockEntities, [{ fieldId: "priority", direction: "desc" }]);
    expect(mockEntities).toEqual(copy);
  });
});

describe("queryEntities", () => {
  it("filters then sorts", () => {
    const result = queryEntities(
      mockEntities,
      [{ fieldId: "status", operator: "eq", value: "todo" }],
      [{ fieldId: "priority", direction: "asc" }]
    );
    expect(result).toHaveLength(2);
    expect(result[0]?.fields["priority"]).toBe(1);
  });
});
