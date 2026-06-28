import { describe, it, expect } from "vitest";
import { computeFullSyncRemovals } from "./mail-sync";

describe("computeFullSyncRemovals", () => {
  it("removes mirror inbox threads absent from a complete fetch", () => {
    expect(computeFullSyncRemovals(["a", "b", "c"], ["a", "c"], true)).toEqual(["b"]);
  });

  it("removes nothing when the fetch was truncated (more pages exist)", () => {
    expect(computeFullSyncRemovals(["a", "b", "c"], ["a"], false)).toEqual([]);
  });

  it("removes nothing when the mirror and fetch agree", () => {
    expect(computeFullSyncRemovals(["a", "b"], ["b", "a"], true)).toEqual([]);
  });

  it("handles an empty mirror", () => {
    expect(computeFullSyncRemovals([], ["a", "b"], true)).toEqual([]);
  });

  it("removes every mirror thread when the inbox emptied", () => {
    expect(computeFullSyncRemovals(["a", "b"], [], true)).toEqual(["a", "b"]);
  });
});
