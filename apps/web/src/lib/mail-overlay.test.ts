import { describe, it, expect } from "vitest";
import { buildMailOverlay } from "./mail-overlay";
import type { ThreadListItem } from "@/lib/gmail";

function item(id: string, fromEmail: string, date: string, labelIds: string[] = [], subject = "s"): ThreadListItem {
  return { id, subject, from: { name: fromEmail.split("@")[0]!, email: fromEmail }, date, snippet: "", labelIds };
}
const labels = new Map([["L1", "Projet"], ["L2", "Perso"]]);

describe("buildMailOverlay", () => {
  it("groupe par label d'abord (≥2), avec count + date la plus récente", () => {
    const rows = buildMailOverlay(
      [
        item("a", "ada@x.io", "2026-06-20T10:00:00Z", ["L1"]),
        item("b", "bob@x.io", "2026-06-22T10:00:00Z", ["L1"]),
      ],
      labels,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "group", groupType: "label", title: "Projet", count: 2 });
    expect(rows[0]!.kind === "group" && rows[0]!.date).toMatch(/^2026-06-22/);
  });

  it("label prime sur expéditeur", () => {
    const rows = buildMailOverlay(
      [
        item("a", "ada@x.io", "2026-06-20T10:00:00Z", ["L1"]),
        item("b", "ada@x.io", "2026-06-21T10:00:00Z", ["L1"]),
        item("c", "ada@x.io", "2026-06-22T10:00:00Z", []),
      ],
      labels,
    );
    const group = rows.find((r) => r.kind === "group");
    expect(group).toMatchObject({ groupType: "label", count: 2 });
    expect(rows.some((r) => r.kind === "single" && r.item.id === "c")).toBe(true);
  });

  it("groupe par expéditeur sur le reste (≥2)", () => {
    const rows = buildMailOverlay(
      [
        item("a", "ada@x.io", "2026-06-20T10:00:00Z"),
        item("b", "ada@x.io", "2026-06-21T10:00:00Z"),
        item("c", "bob@x.io", "2026-06-22T10:00:00Z"),
      ],
      labels,
    );
    expect(rows.find((r) => r.kind === "group")).toMatchObject({ groupType: "sender", count: 2 });
    expect(rows.some((r) => r.kind === "single" && r.item.id === "c")).toBe(true);
  });

  it("item multi-label → plus gros groupe", () => {
    const rows = buildMailOverlay(
      [
        item("a", "x@x.io", "2026-06-20T10:00:00Z", ["L1", "L2"]),
        item("b", "y@x.io", "2026-06-21T10:00:00Z", ["L1"]),
        item("c", "z@x.io", "2026-06-22T10:00:00Z", ["L1"]),
        item("d", "w@x.io", "2026-06-19T10:00:00Z", ["L2"]),
      ],
      labels,
    );
    const l1 = rows.find((r) => r.kind === "group" && r.title === "Projet");
    expect(l1).toMatchObject({ count: 3 });
    expect(rows.some((r) => r.kind === "single" && r.item.id === "d")).toBe(true);
  });

  it("tri par date la plus récente, liste vide → []", () => {
    expect(buildMailOverlay([], labels)).toEqual([]);
    const rows = buildMailOverlay(
      [
        item("old", "a@x.io", "2026-06-01T10:00:00Z"),
        item("new", "b@x.io", "2026-06-25T10:00:00Z"),
      ],
      labels,
    );
    expect(rows[0]!.kind === "single" && rows[0]!.item.id).toBe("new");
  });

  it("sans labels connus → seulement sender + singles", () => {
    const rows = buildMailOverlay(
      [item("a", "ada@x.io", "2026-06-20T10:00:00Z", ["L1"])],
      new Map(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("single");
  });
});
