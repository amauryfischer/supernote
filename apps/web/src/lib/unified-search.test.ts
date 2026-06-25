import { describe, it, expect } from "vitest";
import {
  parseDate,
  normalize,
  matchScore,
  dedupResults,
  rankResults,
  mergeRankResults,
  filterBases,
  emailToResult,
  searchResultToResult,
  baseToResult,
  type UnifiedResult,
  type EmailLike,
  type VaultResultLike,
  type BaseLike,
} from "./unified-search";

// ── helpers ───────────────────────────────────────────────────────────────────

function res(p: Partial<UnifiedResult> & Pick<UnifiedResult, "source" | "id" | "title">): UnifiedResult {
  return { ...p };
}

// ── parseDate ───────────────────────────────────────────────────────────────────

describe("parseDate", () => {
  it("parses ISO to epoch ms", () => {
    expect(parseDate("2026-06-25T10:00:00.000Z")).toBe(Date.parse("2026-06-25T10:00:00.000Z"));
  });
  it("returns undefined for empty/invalid", () => {
    expect(parseDate("")).toBeUndefined();
    expect(parseDate(undefined)).toBeUndefined();
    expect(parseDate("not a date")).toBeUndefined();
  });
});

// ── normalize ───────────────────────────────────────────────────────────────────

describe("normalize", () => {
  it("lowercases, strips diacritics, trims", () => {
    expect(normalize("  Évènement À Café ")).toBe("evenement a cafe");
  });
  it("is idempotent on plain ascii", () => {
    expect(normalize("hello")).toBe("hello");
  });
});

// ── matchScore ──────────────────────────────────────────────────────────────────

describe("matchScore", () => {
  const r = res({ source: "note", id: "1", title: "Réunion budget", subtitle: "note · projet alpha" });

  it("prefix title match scores 3", () => {
    expect(matchScore(r, "réun")).toBe(3);
    expect(matchScore(r, "reunion")).toBe(3); // accent-insensitive
  });
  it("substring title match scores 2", () => {
    expect(matchScore(r, "budget")).toBe(2);
  });
  it("subtitle-only match scores 1", () => {
    expect(matchScore(r, "alpha")).toBe(1);
  });
  it("no match scores 0", () => {
    expect(matchScore(r, "zzz")).toBe(0);
  });
  it("empty query is neutral (1)", () => {
    expect(matchScore(r, "")).toBe(1);
    expect(matchScore(r, "   ")).toBe(1);
  });
});

// ── dedupResults ────────────────────────────────────────────────────────────────

describe("dedupResults", () => {
  it("removes duplicates by source:id, keeping first", () => {
    const out = dedupResults([
      res({ source: "note", id: "a", title: "first" }),
      res({ source: "note", id: "a", title: "second" }),
      res({ source: "note", id: "b", title: "other" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.title).toBe("first");
    expect(out[1]!.id).toBe("b");
  });
  it("keeps same id across different sources", () => {
    const out = dedupResults([
      res({ source: "note", id: "x", title: "n" }),
      res({ source: "base", id: "x", title: "b" }),
    ]);
    expect(out).toHaveLength(2);
  });
});

// ── rankResults ─────────────────────────────────────────────────────────────────

describe("rankResults", () => {
  it("orders title match > snippet match", () => {
    const out = rankResults(
      [
        res({ source: "note", id: "snippet", title: "autre", subtitle: "contient budget ici" }),
        res({ source: "note", id: "title", title: "budget annuel" }),
      ],
      "budget",
    );
    expect(out[0]!.id).toBe("title");
    expect(out[1]!.id).toBe("snippet");
  });

  it("breaks score ties by recency (most recent first, undated last)", () => {
    const out = rankResults(
      [
        res({ source: "note", id: "old", title: "budget", date: 1000 }),
        res({ source: "note", id: "undated", title: "budget" }),
        res({ source: "note", id: "new", title: "budget", date: 5000 }),
      ],
      "budget",
    );
    expect(out.map((r) => r.id)).toEqual(["new", "old", "undated"]);
  });

  it("stable deterministic tie-break by source then id", () => {
    const out = rankResults(
      [
        res({ source: "email", id: "b", title: "x" }),
        res({ source: "note", id: "z", title: "x" }),
        res({ source: "base", id: "a", title: "x" }),
        res({ source: "note", id: "a", title: "x" }),
      ],
      "",
    );
    // empty query => all neutral score, no dates => source order note,base,email
    expect(out.map((r) => `${r.source}:${r.id}`)).toEqual([
      "note:a",
      "note:z",
      "base:a",
      "email:b",
    ]);
  });

  it("dedups before ranking", () => {
    const out = rankResults(
      [
        res({ source: "note", id: "a", title: "budget" }),
        res({ source: "note", id: "a", title: "budget" }),
      ],
      "budget",
    );
    expect(out).toHaveLength(1);
  });
});

// ── mergeRankResults ────────────────────────────────────────────────────────────

describe("mergeRankResults", () => {
  it("merges heterogeneous batches and ranks", () => {
    const emails = [res({ source: "email", id: "e1", title: "Projet budget" })];
    const notes = [res({ source: "note", id: "n1", title: "note", subtitle: "budget mentionné" })];
    const out = mergeRankResults([emails, notes], "budget");
    expect(out[0]!.id).toBe("e1"); // title contains > snippet
    expect(out).toHaveLength(2);
  });

  it("respects limit", () => {
    const batch = [
      res({ source: "note", id: "1", title: "a" }),
      res({ source: "note", id: "2", title: "b" }),
      res({ source: "note", id: "3", title: "c" }),
    ];
    expect(mergeRankResults([batch], "", 2)).toHaveLength(2);
    expect(mergeRankResults([batch], "", 0)).toHaveLength(0);
  });
});

// ── filterBases ─────────────────────────────────────────────────────────────────

describe("filterBases", () => {
  const bases: BaseLike[] = [
    { id: "t1", name: "Personnes", plural: "Personnes" },
    { id: "t2", name: "Ressource", plural: "Ressources" },
    { id: "t3", name: "Évènements", plural: "Évènements" },
  ];

  it("matches name or plural, accent-insensitive", () => {
    expect(filterBases(bases, "ressource").map((b) => b.id)).toEqual(["t2"]);
    expect(filterBases(bases, "evenement").map((b) => b.id)).toEqual(["t3"]);
  });
  it("returns nothing for empty query", () => {
    expect(filterBases(bases, "")).toEqual([]);
    expect(filterBases(bases, "   ")).toEqual([]);
  });
});

// ── mappers ─────────────────────────────────────────────────────────────────────

describe("emailToResult", () => {
  const item: EmailLike = {
    id: "thr1",
    subject: "Compte rendu",
    from: { name: "Ada Lovelace", email: "ada@x.io" },
    date: "2026-06-25T08:00:00.000Z",
    snippet: "Voici le résumé",
  };
  it("maps subject/sender/date/href", () => {
    const r = emailToResult(item);
    expect(r.source).toBe("email");
    expect(r.id).toBe("thr1");
    expect(r.title).toBe("Compte rendu");
    expect(r.subtitle).toContain("Ada Lovelace");
    expect(r.subtitle).toContain("Voici le résumé");
    expect(r.date).toBe(Date.parse("2026-06-25T08:00:00.000Z"));
    expect(r.href).toContain("thr1");
  });
  it("falls back to email then snippet, and (sans objet)", () => {
    const r = emailToResult({ id: "x", subject: "  ", from: { name: "", email: "a@b" }, date: "", snippet: "snip" });
    expect(r.title).toBe("(sans objet)");
    expect(r.subtitle).toContain("a@b");
    expect(r.date).toBeUndefined();
  });
});

describe("searchResultToResult", () => {
  const base: VaultResultLike = {
    entityId: "ent1",
    typeId: "note",
    typeName: "Notes",
    title: "Ma note",
    excerpts: ["", "extrait pertinent"],
  };
  it("maps note → /notes/:id with first non-empty excerpt", () => {
    const r = searchResultToResult(base);
    expect(r.source).toBe("note");
    expect(r.href).toBe("/notes/ent1");
    expect(r.subtitle).toBe("Notes · extrait pertinent");
  });
  it("maps personne → /contacts/:id", () => {
    const r = searchResultToResult({ ...base, typeId: "personne", entityId: "p9" });
    expect(r.href).toBe("/contacts/p9");
  });
  it("falls back to typeName when no excerpt and (sans titre)", () => {
    const r = searchResultToResult({ ...base, title: "  ", excerpts: [] });
    expect(r.title).toBe("(sans titre)");
    expect(r.subtitle).toBe("Notes");
  });
});

describe("baseToResult", () => {
  it("maps EntityType → /bases/:typeId", () => {
    const b: BaseLike = { id: "type-projets", name: "Projets", plural: "Projets", icon: "folder" };
    const r = baseToResult(b);
    expect(r.source).toBe("base");
    expect(r.id).toBe("type-projets");
    expect(r.href).toBe("/bases/type-projets");
    expect(r.subtitle).toBe("Projets");
  });
});
