import { describe, it, expect } from "vitest";
import {
  rowThreadIds,
  rowCheckState,
  toggleRowSelection,
  pruneSelection,
} from "./mail-selection";
import type { OverlayRow } from "./mail-overlay";
import type { ThreadListItem } from "@/lib/gmail";

function item(id: string, labelIds: string[] = []): ThreadListItem {
  return { id, subject: "s", from: { name: id, email: `${id}@x.io` }, date: "2026-06-20T10:00:00Z", snippet: "", labelIds };
}
function single(id: string): OverlayRow {
  return { kind: "single", item: item(id) };
}
function group(key: string, ids: string[]): OverlayRow {
  return {
    kind: "group",
    groupType: "sender",
    key,
    title: key,
    count: ids.length,
    items: ids.map((id) => item(id)),
    date: "2026-06-20T10:00:00Z",
  };
}

describe("rowThreadIds", () => {
  it("renvoie l'id du single", () => {
    expect(rowThreadIds(single("a"))).toEqual(["a"]);
  });
  it("renvoie tous les ids du groupe", () => {
    expect(rowThreadIds(group("g", ["a", "b", "c"]))).toEqual(["a", "b", "c"]);
  });
});

describe("rowCheckState", () => {
  it("single coché / décoché", () => {
    expect(rowCheckState(single("a"), new Set(["a"]))).toBe("checked");
    expect(rowCheckState(single("a"), new Set())).toBe("unchecked");
  });
  it("groupe entièrement coché", () => {
    expect(rowCheckState(group("g", ["a", "b"]), new Set(["a", "b"]))).toBe("checked");
  });
  it("groupe partiellement coché → indeterminate", () => {
    expect(rowCheckState(group("g", ["a", "b"]), new Set(["a"]))).toBe("indeterminate");
  });
  it("groupe non coché", () => {
    expect(rowCheckState(group("g", ["a", "b"]), new Set(["z"]))).toBe("unchecked");
  });
});

describe("toggleRowSelection", () => {
  it("coche un single non coché", () => {
    const next = toggleRowSelection(single("a"), new Set());
    expect([...next]).toEqual(["a"]);
  });
  it("décoche un single coché", () => {
    const next = toggleRowSelection(single("a"), new Set(["a", "b"]));
    expect(next.has("a")).toBe(false);
    expect(next.has("b")).toBe(true);
  });
  it("coche tout un groupe partiellement coché", () => {
    const next = toggleRowSelection(group("g", ["a", "b"]), new Set(["a"]));
    expect([...next].sort()).toEqual(["a", "b"]);
  });
  it("décoche tout un groupe entièrement coché", () => {
    const next = toggleRowSelection(group("g", ["a", "b"]), new Set(["a", "b", "c"]));
    expect([...next]).toEqual(["c"]);
  });
  it("ne mute pas l'entrée", () => {
    const input = new Set(["a"]);
    toggleRowSelection(single("a"), input);
    expect([...input]).toEqual(["a"]);
  });
});

describe("pruneSelection", () => {
  it("retire les ids absents des lignes", () => {
    const rows = [single("a"), group("g", ["b", "c"])];
    const next = pruneSelection(new Set(["a", "b", "z", "dead"]), rows);
    expect([...next].sort()).toEqual(["a", "b"]);
  });
  it("vide si plus rien ne correspond", () => {
    const next = pruneSelection(new Set(["x"]), [single("a")]);
    expect(next.size).toBe(0);
  });
});
