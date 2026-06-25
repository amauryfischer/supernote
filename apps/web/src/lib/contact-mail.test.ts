import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  dedupeEmails,
  buildContactMailQuery,
  threadDirection,
  toContactTimeline,
  contactMailStats,
} from "./contact-mail";
import type { ThreadListItem } from "@/lib/gmail";

function item(
  id: string,
  fromEmail: string,
  date: string,
  opts: { subject?: string; snippet?: string; fromName?: string; labelIds?: string[] } = {},
): ThreadListItem {
  return {
    id,
    subject: opts.subject ?? "Sujet",
    from: { name: opts.fromName ?? "", email: fromEmail },
    date,
    snippet: opts.snippet ?? "",
    labelIds: opts.labelIds ?? [],
  };
}

describe("normalizeEmail", () => {
  it("trim + minuscule", () => {
    expect(normalizeEmail("  Ada@X.IO ")).toBe("ada@x.io");
  });
  it("vide reste vide", () => {
    expect(normalizeEmail("")).toBe("");
  });
});

describe("dedupeEmails", () => {
  it("dédup insensible à la casse, préserve l'ordre", () => {
    expect(dedupeEmails(["Ada@x.io", "bob@x.io", "ADA@X.IO", " bob@x.io "])).toEqual([
      "ada@x.io",
      "bob@x.io",
    ]);
  });
  it("retire les vides", () => {
    expect(dedupeEmails(["", "  ", "a@b.io"])).toEqual(["a@b.io"]);
  });
});

describe("buildContactMailQuery", () => {
  it("from: OR to: pour une adresse", () => {
    expect(buildContactMailQuery(["ada@x.io"])).toBe("(from:ada@x.io OR to:ada@x.io)");
  });
  it("plusieurs adresses → toutes en OR, dédupliquées", () => {
    expect(buildContactMailQuery(["Ada@x.io", "ada@X.io", "bob@x.io"])).toBe(
      "(from:ada@x.io OR to:ada@x.io OR from:bob@x.io OR to:bob@x.io)",
    );
  });
  it("aucune adresse → chaîne vide (l'appelant saute le réseau)", () => {
    expect(buildContactMailQuery([])).toBe("");
    expect(buildContactMailQuery(["", "  "])).toBe("");
  });
});

describe("threadDirection", () => {
  it("sortant quand l'expéditeur est le compte connecté (casse ignorée)", () => {
    expect(threadDirection("ME@x.io", "me@x.io")).toBe("outgoing");
  });
  it("entrant quand l'expéditeur diffère du compte", () => {
    expect(threadDirection("ada@x.io", "me@x.io")).toBe("incoming");
  });
  it("inconnu sans selfEmail ou sans expéditeur", () => {
    expect(threadDirection("ada@x.io", undefined)).toBe("unknown");
    expect(threadDirection("", "me@x.io")).toBe("unknown");
  });
});

describe("toContactTimeline", () => {
  it("trie du plus récent au plus ancien et déduit le sens", () => {
    const out = toContactTimeline(
      [
        item("a", "ada@x.io", "2026-06-20T10:00:00Z"),
        item("b", "me@x.io", "2026-06-22T10:00:00Z"),
        item("c", "ada@x.io", "2026-06-21T10:00:00Z"),
      ],
      "me@x.io",
    );
    expect(out.map((e) => e.id)).toEqual(["b", "c", "a"]);
    expect(out[0]).toMatchObject({ id: "b", direction: "outgoing" });
    expect(out[1]).toMatchObject({ id: "c", direction: "incoming" });
  });

  it("relègue les entrées sans date en fin (tri stable)", () => {
    const out = toContactTimeline(
      [
        item("nodate1", "ada@x.io", ""),
        item("dated", "ada@x.io", "2026-06-22T10:00:00Z"),
        item("nodate2", "bob@x.io", ""),
      ],
      "me@x.io",
    );
    expect(out.map((e) => e.id)).toEqual(["dated", "nodate1", "nodate2"]);
  });

  it("sujet vide → (sans objet), fromName fallback sur email", () => {
    const out = toContactTimeline([item("a", "ada@x.io", "2026-06-20T10:00:00Z", { subject: "" })]);
    expect(out[0]).toMatchObject({ subject: "(sans objet)", fromName: "ada@x.io", direction: "unknown" });
  });

  it("conserve les labelIds bruts", () => {
    const out = toContactTimeline([item("a", "ada@x.io", "2026-06-20T10:00:00Z", { labelIds: ["L1", "L2"] })]);
    expect(out[0]!.labelIds).toEqual(["L1", "L2"]);
  });
});

describe("contactMailStats", () => {
  it("compte total/entrants/sortants + dernière date", () => {
    const entries = toContactTimeline(
      [
        item("a", "ada@x.io", "2026-06-20T10:00:00Z"),
        item("b", "me@x.io", "2026-06-22T10:00:00Z"),
        item("c", "ada@x.io", "2026-06-21T10:00:00Z"),
      ],
      "me@x.io",
    );
    expect(contactMailStats(entries)).toEqual({
      total: 3,
      incoming: 2,
      outgoing: 1,
      lastDate: "2026-06-22T10:00:00Z",
    });
  });

  it("liste vide → compteurs à zéro, dernière date vide", () => {
    expect(contactMailStats([])).toEqual({ total: 0, incoming: 0, outgoing: 0, lastDate: "" });
  });
});
