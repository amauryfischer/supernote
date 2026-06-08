// Tests des opérations bloc : extension de sélection (Mod-Shift-flèches)
// et clonage sans ids (Mod-d). Mêmes plages simulées que blockNavShortcuts :
// [1..10], [12..20], [22..30].

import { describe, it, expect } from "vitest";
import {
  resolveSelectExtendTarget,
  type BlockRange,
} from "../extensions/blockNavShortcuts.js";
import { cloneBlockWithoutIds } from "../extensions/blockOpsShortcuts.js";

const RANGES: BlockRange[] = [
  { from: 1, to: 10 },
  { from: 12, to: 20 },
  { from: 22, to: 30 },
];

describe("resolveSelectExtendTarget — up", () => {
  it("milieu de bloc → début du bloc courant", () => {
    expect(resolveSelectExtendTarget(RANGES, 15, "up")).toBe(12);
  });
  it("début de bloc → début du bloc précédent", () => {
    expect(resolveSelectExtendTarget(RANGES, 12, "up")).toBe(1);
  });
  it("début du premier bloc → null", () => {
    expect(resolveSelectExtendTarget(RANGES, 1, "up")).toBeNull();
  });
});

describe("resolveSelectExtendTarget — down", () => {
  it("milieu de bloc → fin du bloc courant", () => {
    expect(resolveSelectExtendTarget(RANGES, 15, "down")).toBe(20);
  });
  it("fin de bloc → fin du bloc suivant", () => {
    expect(resolveSelectExtendTarget(RANGES, 20, "down")).toBe(30);
  });
  it("fin du dernier bloc → null", () => {
    expect(resolveSelectExtendTarget(RANGES, 30, "down")).toBeNull();
  });
  it("hors textblock → fin du bloc suivant", () => {
    expect(resolveSelectExtendTarget(RANGES, 11, "down")).toBe(20);
  });
  it("document vide → null", () => {
    expect(resolveSelectExtendTarget([], 5, "down")).toBeNull();
  });
});

describe("cloneBlockWithoutIds", () => {
  it("retire les ids à tous les niveaux et clone en profondeur", () => {
    const block = {
      id: "parent",
      type: "paragraph",
      props: { textColor: "default" },
      content: [{ type: "text", text: "hello" }],
      children: [
        {
          id: "child",
          type: "checkListItem",
          props: { checked: true },
          content: [{ type: "text", text: "nested" }],
          children: [],
        },
      ],
    };
    const clone = cloneBlockWithoutIds(block);

    expect("id" in clone).toBe(false);
    expect("id" in (clone.children![0] as object)).toBe(false);
    expect(clone.type).toBe("paragraph");
    expect(clone.children![0]!.props).toEqual({ checked: true });
    // Clone profond — muter l'original ne touche pas la copie.
    block.props.textColor = "red";
    (block.content[0] as { text: string }).text = "changed";
    expect(clone.props).toEqual({ textColor: "default" });
    expect((clone.content as Array<{ text: string }>)[0]!.text).toBe("hello");
  });

  it("bloc sans children ni content → clone minimal", () => {
    const clone = cloneBlockWithoutIds({
      id: "x",
      type: "paragraph",
      props: {},
    });
    expect(clone).toEqual({
      type: "paragraph",
      props: {},
      content: undefined,
      children: [],
    });
  });
});
