// Tests de la logique pure de navigation par paragraphe (Ctrl+flèches).
// Trois "paragraphes" simulés : [1..10], [12..20], [22..30].

import { describe, it, expect } from "vitest";
import {
  resolveBlockNavTarget,
  type BlockRange,
} from "../extensions/blockNavShortcuts.js";

const RANGES: BlockRange[] = [
  { from: 1, to: 10 },
  { from: 12, to: 20 },
  { from: 22, to: 30 },
];

describe("resolveBlockNavTarget — up", () => {
  it("milieu de bloc → début du bloc courant", () => {
    expect(resolveBlockNavTarget(RANGES, 15, "up")).toBe(12);
  });
  it("début de bloc → début du bloc précédent", () => {
    expect(resolveBlockNavTarget(RANGES, 12, "up")).toBe(1);
  });
  it("début du premier bloc → null (nulle part où aller)", () => {
    expect(resolveBlockNavTarget(RANGES, 1, "up")).toBeNull();
  });
});

describe("resolveBlockNavTarget — down", () => {
  it("n'importe où → début du bloc suivant", () => {
    expect(resolveBlockNavTarget(RANGES, 15, "down")).toBe(22);
    expect(resolveBlockNavTarget(RANGES, 1, "down")).toBe(12);
  });
  it("dernier bloc → fin du bloc courant", () => {
    expect(resolveBlockNavTarget(RANGES, 25, "down")).toBe(30);
  });
  it("fin du dernier bloc → null", () => {
    expect(resolveBlockNavTarget(RANGES, 30, "down")).toBeNull();
  });
});

describe("resolveBlockNavTarget — left", () => {
  it("milieu de bloc → début du bloc courant", () => {
    expect(resolveBlockNavTarget(RANGES, 18, "left")).toBe(12);
  });
  it("début de bloc → fin du bloc précédent", () => {
    expect(resolveBlockNavTarget(RANGES, 12, "left")).toBe(10);
  });
  it("début du premier bloc → null", () => {
    expect(resolveBlockNavTarget(RANGES, 1, "left")).toBeNull();
  });
});

describe("resolveBlockNavTarget — right", () => {
  it("milieu de bloc → fin du bloc courant", () => {
    expect(resolveBlockNavTarget(RANGES, 15, "right")).toBe(20);
  });
  it("fin de bloc → début du bloc suivant", () => {
    expect(resolveBlockNavTarget(RANGES, 20, "right")).toBe(22);
  });
  it("fin du dernier bloc → null", () => {
    expect(resolveBlockNavTarget(RANGES, 30, "right")).toBeNull();
  });
});

describe("resolveBlockNavTarget — curseur hors textblock (bloc atomique)", () => {
  it("down/right → début du bloc suivant", () => {
    expect(resolveBlockNavTarget(RANGES, 11, "down")).toBe(12);
    expect(resolveBlockNavTarget(RANGES, 11, "right")).toBe(12);
  });
  it("up → début du bloc précédent, left → fin du bloc précédent", () => {
    expect(resolveBlockNavTarget(RANGES, 21, "up")).toBe(12);
    expect(resolveBlockNavTarget(RANGES, 21, "left")).toBe(20);
  });
  it("document vide → null", () => {
    expect(resolveBlockNavTarget([], 5, "down")).toBeNull();
  });
});
