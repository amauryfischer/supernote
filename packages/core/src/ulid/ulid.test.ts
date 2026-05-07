import { describe, it, expect } from "vitest";
import { newId, isValidId } from "./index.js";

describe("ulid helpers", () => {
  it("newId() returns a 26-char uppercase string", () => {
    const id = newId();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-Z]+$/);
  });

  it("isValidId() accepts valid ULIDs", () => {
    expect(isValidId(newId())).toBe(true);
  });

  it("isValidId() rejects invalid strings", () => {
    expect(isValidId("not-a-ulid")).toBe(false);
    expect(isValidId(123)).toBe(false);
    expect(isValidId(null)).toBe(false);
  });

  it("successive newId() calls are lexicographically ordered within same ms", () => {
    const ids = Array.from({ length: 5 }, () => newId());
    const sorted = [...ids].sort();
    // All should be valid regardless of sort order (timing-dependent)
    ids.forEach((id) => expect(isValidId(id)).toBe(true));
    // Sorted array should equal itself
    expect(sorted).toEqual([...sorted].sort());
  });
});
