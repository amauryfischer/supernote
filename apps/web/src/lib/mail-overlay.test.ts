import { describe, it, expect } from "vitest";
import { buildMailOverlay, rowHasUnread, rowHasStar, rowUnreadCount } from "./mail-overlay";
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

  it("tag isolé (1 email) → groupe-label d'un seul item, pas une ligne nue", () => {
    const rows = buildMailOverlay(
      [item("a", "ada@x.io", "2026-06-20T10:00:00Z", ["L1"])],
      labels,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "group", groupType: "label", title: "Projet", count: 1 });
  });

  it("tag isolé coexiste avec un groupe-expéditeur du reste", () => {
    const rows = buildMailOverlay(
      [
        item("a", "ada@x.io", "2026-06-20T10:00:00Z", ["L1"]),
        item("b", "bob@x.io", "2026-06-21T10:00:00Z"),
        item("c", "bob@x.io", "2026-06-22T10:00:00Z"),
      ],
      labels,
    );
    const label = rows.find((r) => r.kind === "group" && r.groupType === "label");
    expect(label).toMatchObject({ title: "Projet", count: 1 });
    const sender = rows.find((r) => r.kind === "group" && r.groupType === "sender");
    expect(sender).toMatchObject({ count: 2 });
  });

  it("le groupe-expéditeur prime sur le tag isolé (email tagué non isolé)", () => {
    // a tagué L1 mais partage l'expéditeur de b → reste dans le groupe-expéditeur,
    // PAS extrait en groupe-label d'un item.
    const rows = buildMailOverlay(
      [
        item("a", "ada@x.io", "2026-06-20T10:00:00Z", ["L1"]),
        item("b", "ada@x.io", "2026-06-21T10:00:00Z"),
      ],
      labels,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "group", groupType: "sender", count: 2 });
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
    // a rejoint le plus gros groupe (Projet) ; d, seul porteur de L2 (Perso),
    // forme un groupe-label d'un item (tag isolé désormais surfacé).
    expect(
      rows.some(
        (r) => r.kind === "group" && r.title === "Perso" && r.count === 1 && r.items[0]!.id === "d",
      ),
    ).toBe(true);
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

  it("From illisible (vide) → lignes seules, pas un faux groupe", () => {
    const rows = buildMailOverlay(
      [
        item("a", "", "2026-06-20T10:00:00Z"),
        item("b", "", "2026-06-21T10:00:00Z"),
      ],
      labels,
    );
    expect(rows.every((r) => r.kind === "single")).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("orphan d'un groupe-label réduit (<2) retombe correctement (single ou sender)", () => {
    // L1={a,b,c}=3 (gagne), L2={a,d}=2 → a consommé par L1, L2 tombe à {d}=1.
    // d non-labellisé groupé par sender avec e (même expéditeur) → groupe-sender.
    const rows = buildMailOverlay(
      [
        item("a", "x@x.io", "2026-06-20T10:00:00Z", ["L1", "L2"]),
        item("b", "y@x.io", "2026-06-21T10:00:00Z", ["L1"]),
        item("c", "z@x.io", "2026-06-22T10:00:00Z", ["L1"]),
        item("d", "w@x.io", "2026-06-19T10:00:00Z", ["L2"]),
        item("e", "w@x.io", "2026-06-18T10:00:00Z", []),
      ],
      labels,
    );
    const label = rows.find((r) => r.kind === "group" && r.groupType === "label");
    expect(label).toMatchObject({ title: "Projet", count: 3 });
    const sender = rows.find((r) => r.kind === "group" && r.groupType === "sender");
    expect(sender).toMatchObject({ count: 2 }); // d + e
    expect(rows.some((r) => r.kind === "group" && r.title === "Perso")).toBe(false);
  });

  it("tie-break déterministe entre deux labels de même taille (nom asc)", () => {
    // L1 "Projet" et L2 "Perso", chacun 2, items disjoints. Ordre de traitement
    // = nom asc → "Perso" traité avant "Projet" (mais le tri final est par date).
    const rows = buildMailOverlay(
      [
        item("a", "a@x.io", "2026-06-10T10:00:00Z", ["L1"]),
        item("b", "b@x.io", "2026-06-11T10:00:00Z", ["L1"]),
        item("c", "c@x.io", "2026-06-12T10:00:00Z", ["L2"]),
        item("d", "d@x.io", "2026-06-13T10:00:00Z", ["L2"]),
      ],
      labels,
    );
    const titles = rows.filter((r) => r.kind === "group").map((r) => (r.kind === "group" ? r.title : ""));
    expect(titles.sort()).toEqual(["Perso", "Projet"]);
  });

  it("compte connecté (self) : ≥2 threads de moi → pas de groupe-expéditeur, restent singles", () => {
    const rows = buildMailOverlay(
      [
        item("a", "me@x.io", "2026-06-20T10:00:00Z"),
        item("b", "me@x.io", "2026-06-21T10:00:00Z"),
      ],
      labels,
      "me@x.io",
    );
    expect(rows.every((r) => r.kind === "single")).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("self exclu mais les autres expéditeurs groupent normalement", () => {
    const rows = buildMailOverlay(
      [
        item("a", "me@x.io", "2026-06-20T10:00:00Z"),
        item("b", "me@x.io", "2026-06-21T10:00:00Z"),
        item("c", "bob@x.io", "2026-06-22T10:00:00Z"),
        item("d", "bob@x.io", "2026-06-23T10:00:00Z"),
      ],
      labels,
      "me@x.io",
    );
    const sender = rows.filter((r) => r.kind === "group" && r.groupType === "sender");
    expect(sender).toHaveLength(1);
    expect(sender[0]).toMatchObject({ count: 2, title: "bob" });
    expect(rows.filter((r) => r.kind === "single")).toHaveLength(2); // les 2 « moi »
  });

  it("self insensible à la casse", () => {
    const rows = buildMailOverlay(
      [
        item("a", "Me@X.io", "2026-06-20T10:00:00Z"),
        item("b", "ME@x.IO", "2026-06-21T10:00:00Z"),
      ],
      labels,
      "me@x.io",
    );
    expect(rows.every((r) => r.kind === "single")).toBe(true);
  });

  it("self + label : le label prime (thread de moi rejoint le groupe-label)", () => {
    const rows = buildMailOverlay(
      [
        item("a", "me@x.io", "2026-06-20T10:00:00Z", ["L1"]),
        item("b", "bob@x.io", "2026-06-21T10:00:00Z", ["L1"]),
      ],
      labels,
      "me@x.io",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "group", groupType: "label", title: "Projet", count: 2 });
  });

  it("selfEmail absent → comportement inchangé (mes threads groupent par expéditeur)", () => {
    const rows = buildMailOverlay(
      [
        item("a", "me@x.io", "2026-06-20T10:00:00Z"),
        item("b", "me@x.io", "2026-06-21T10:00:00Z"),
      ],
      labels,
    );
    expect(rows.find((r) => r.kind === "group")).toMatchObject({ groupType: "sender", count: 2 });
  });

  it("liste self (compte + alias) : chaque adresse à moi exclue du groupe-expéditeur", () => {
    const rows = buildMailOverlay(
      [
        item("a", "me@x.io", "2026-06-20T10:00:00Z"),
        item("b", "me@x.io", "2026-06-21T10:00:00Z"),
        item("c", "contact@x.io", "2026-06-22T10:00:00Z"),
        item("d", "contact@x.io", "2026-06-23T10:00:00Z"),
        item("e", "bob@x.io", "2026-06-24T10:00:00Z"),
        item("f", "bob@x.io", "2026-06-25T10:00:00Z"),
      ],
      labels,
      ["me@x.io", "contact@x.io"],
    );
    // Seul bob (tiers) forme un groupe ; me + contact retombent en singles.
    const sender = rows.filter((r) => r.kind === "group" && r.groupType === "sender");
    expect(sender).toHaveLength(1);
    expect(sender[0]).toMatchObject({ title: "bob", count: 2 });
    expect(rows.filter((r) => r.kind === "single")).toHaveLength(4);
  });

  it("liste self : casse insensible + entrées vides ignorées", () => {
    const rows = buildMailOverlay(
      [
        item("a", "Contact@X.io", "2026-06-20T10:00:00Z"),
        item("b", "CONTACT@x.IO", "2026-06-21T10:00:00Z"),
      ],
      labels,
      ["", "  ", "contact@x.io"],
    );
    expect(rows.every((r) => r.kind === "single")).toBe(true);
    expect(rows).toHaveLength(2);
  });

  it("label nommé comme une adresse à moi → pas de groupe-label (boîte partagée)", () => {
    // L3 = label Gmail nommé « contact@x.io » (filtre boîte partagée). 3 threads
    // d'expéditeurs variés le portent : ils NE doivent PAS former un groupe
    // « contact@x.io », mais retomber sur leur vrai expéditeur → 3 singles.
    const labelsWithSelf = new Map([
      ["L3", "contact@x.io"],
      ["L1", "Projet"],
    ]);
    const rows = buildMailOverlay(
      [
        item("a", "google@x.io", "2026-06-20T10:00:00Z", ["L3"]),
        item("b", "bob@y.io", "2026-06-21T10:00:00Z", ["L3"]),
        item("c", "amazon@z.io", "2026-06-22T10:00:00Z", ["L3"]),
      ],
      labelsWithSelf,
      ["me@x.io", "contact@x.io"],
    );
    expect(rows.every((r) => r.kind === "single")).toBe(true);
    expect(rows).toHaveLength(3);
  });

  it("un vrai tag groupe encore même avec des adresses à moi fournies", () => {
    const rows = buildMailOverlay(
      [
        item("a", "x@x.io", "2026-06-20T10:00:00Z", ["L1"]),
        item("b", "y@y.io", "2026-06-21T10:00:00Z", ["L1"]),
      ],
      labels,
      ["me@x.io", "contact@x.io"],
    );
    expect(rows.find((r) => r.kind === "group")).toMatchObject({
      groupType: "label",
      title: "Projet",
      count: 2,
    });
  });
});

describe("rowHasUnread", () => {
  it("single avec UNREAD → true", () => {
    expect(rowHasUnread({ kind: "single", item: item("a", "a@x.io", "2026-06-20T10:00:00Z", ["INBOX", "UNREAD"]) })).toBe(true);
  });
  it("single sans UNREAD → false", () => {
    expect(rowHasUnread({ kind: "single", item: item("a", "a@x.io", "2026-06-20T10:00:00Z", ["INBOX"]) })).toBe(false);
  });
  it("group → true dès qu'un item est non lu", () => {
    const rows = buildMailOverlay(
      [
        item("a", "ada@x.io", "2026-06-20T10:00:00Z", ["L1"]),
        item("b", "bob@x.io", "2026-06-21T10:00:00Z", ["L1", "UNREAD"]),
      ],
      labels,
    );
    const group = rows.find((r) => r.kind === "group")!;
    expect(rowHasUnread(group)).toBe(true);
  });
  it("group tout lu → false", () => {
    const rows = buildMailOverlay(
      [
        item("a", "ada@x.io", "2026-06-20T10:00:00Z", ["L1"]),
        item("b", "bob@x.io", "2026-06-21T10:00:00Z", ["L1"]),
      ],
      labels,
    );
    const group = rows.find((r) => r.kind === "group")!;
    expect(rowHasUnread(group)).toBe(false);
  });
});

describe("rowUnreadCount", () => {
  it("single non lu → 1", () => {
    expect(
      rowUnreadCount({ kind: "single", item: item("a", "a@x.io", "2026-06-20T10:00:00Z", ["INBOX", "UNREAD"]) }),
    ).toBe(1);
  });
  it("single lu → 0", () => {
    expect(
      rowUnreadCount({ kind: "single", item: item("a", "a@x.io", "2026-06-20T10:00:00Z", ["INBOX"]) }),
    ).toBe(0);
  });
  it("group → compte les items non lus", () => {
    const rows = buildMailOverlay(
      [
        item("a", "ada@x.io", "2026-06-20T10:00:00Z", ["L1", "UNREAD"]),
        item("b", "ada@x.io", "2026-06-21T10:00:00Z", ["L1"]),
        item("c", "ada@x.io", "2026-06-22T10:00:00Z", ["L1", "UNREAD"]),
      ],
      labels,
    );
    const group = rows.find((r) => r.kind === "group")!;
    expect(group.kind === "group" && group.count).toBe(3);
    expect(rowUnreadCount(group)).toBe(2);
  });
  it("group tout lu → 0", () => {
    const rows = buildMailOverlay(
      [
        item("a", "ada@x.io", "2026-06-20T10:00:00Z", ["L1"]),
        item("b", "ada@x.io", "2026-06-21T10:00:00Z", ["L1"]),
      ],
      labels,
    );
    const group = rows.find((r) => r.kind === "group")!;
    expect(rowUnreadCount(group)).toBe(0);
  });
});

describe("rowHasStar", () => {
  it("single avec STARRED → true", () => {
    expect(rowHasStar({ kind: "single", item: item("a", "a@x.io", "2026-06-20T10:00:00Z", ["INBOX", "STARRED"]) })).toBe(true);
  });
  it("single sans STARRED → false", () => {
    expect(rowHasStar({ kind: "single", item: item("a", "a@x.io", "2026-06-20T10:00:00Z", ["INBOX"]) })).toBe(false);
  });
  it("group → true dès qu'un item est étoilé", () => {
    const rows = buildMailOverlay(
      [
        item("a", "ada@x.io", "2026-06-20T10:00:00Z", ["L1"]),
        item("b", "bob@x.io", "2026-06-21T10:00:00Z", ["L1", "STARRED"]),
      ],
      labels,
    );
    const group = rows.find((r) => r.kind === "group")!;
    expect(rowHasStar(group)).toBe(true);
  });
});
