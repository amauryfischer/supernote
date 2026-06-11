// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadMountCursor, saveMountCursor } from "./mount-cursors";

beforeEach(() => localStorage.clear());

describe("mount-cursors", () => {
  it("défaut = seq 0, epoch vide", () => {
    expect(loadMountCursor("parent1", "cloud:|b")).toEqual({ lastSeq: 0, epoch: "" });
  });

  it("persiste par (parent, montage)", () => {
    saveMountCursor("parent1", "cloud:|b", { lastSeq: 12, epoch: "e1" });
    expect(loadMountCursor("parent1", "cloud:|b")).toEqual({ lastSeq: 12, epoch: "e1" });
    expect(loadMountCursor("parent2", "cloud:|b")).toEqual({ lastSeq: 0, epoch: "" });
  });
});
