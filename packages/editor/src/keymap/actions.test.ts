import { describe, it, expect, vi } from "vitest";
import { resolveHeadingTarget } from "../extensions/blockNavShortcuts";
import { ACTION_META, EDITOR_ACTIONS } from "./actions";

describe("registre d'actions", () => {
  it("ACTION_META reflète EDITOR_ACTIONS sans handler", () => {
    expect(ACTION_META).toHaveLength(EDITOR_ACTIONS.length);
    expect(ACTION_META.every((m) => !("run" in m))).toBe(true);
    expect(new Set(ACTION_META.map((m) => m.id)).size).toBe(ACTION_META.length);
  });
  it("aucune collision de defaultCombo non vide", () => {
    const used = ACTION_META.map((m) => m.defaultCombo).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });
  it("resolveHeadingTarget saute au bon titre", () => {
    expect(resolveHeadingTarget([5, 20, 40], 10, "next")).toBe(20);
    expect(resolveHeadingTarget([5, 20, 40], 25, "prev")).toBe(20);
    expect(resolveHeadingTarget([5, 20, 40], 50, "next")).toBeNull();
  });
  it("block-ops.moveUp appelle moveBlocksUp", () => {
    const moveBlocksUp = vi.fn();
    const action = EDITOR_ACTIONS.find((a) => a.id === "block-ops.moveUp")!;
    expect(action.run({ editor: {} as never, blockNote: { moveBlocksUp } as never })).toBe(true);
    expect(moveBlocksUp).toHaveBeenCalled();
  });
});
