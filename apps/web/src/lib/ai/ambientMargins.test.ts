import { describe, it, expect } from "vitest";
import {
  citedTitles,
  cleanExcerpt,
  rankCandidates,
  parseAmbientResponse,
  type NoteLike,
} from "./ambientMargins";

describe("citedTitles", () => {
  it("extrait les wikilinks (avec alias) en minuscules", () => {
    const s = citedTitles("voir [[Projet X]] et [[Note Y|alias]] mais pas autre");
    expect(s.has("projet x")).toBe(true);
    expect(s.has("note y")).toBe(true);
    expect(s.size).toBe(2);
  });
  it("vide si aucun lien", () => {
    expect(citedTitles("texte sans lien").size).toBe(0);
  });
});

describe("cleanExcerpt", () => {
  it("strippe markdown et code, garde le wikilink en texte", () => {
    const out = cleanExcerpt("# Titre\n```js\ncode\n```\nvoir [[Cible|a]] **gras**");
    expect(out).not.toContain("```");
    expect(out).not.toContain("#");
    expect(out).toContain("Cible");
    expect(out).not.toContain("[[");
  });
  it("tronque à la longueur max", () => {
    expect(cleanExcerpt("a".repeat(500), 50).length).toBe(50);
  });
});

const mkNote = (id: string, title: string, vec: number[], body = "corps"): NoteLike => ({
  id,
  title,
  body,
  fields: { embedding: JSON.stringify(vec) },
});

describe("rankCandidates", () => {
  const cur = [1, 0, 0];
  it("classe par proximité, exclut soi-même et notes citées", () => {
    const others = [
      mkNote("self", "Soi", [1, 0, 0]),
      mkNote("near", "Proche", [0.95, 0.1, 0]),
      mkNote("far", "Loin", [0, 1, 0]),
      mkNote("cited", "Citée", [0.99, 0, 0]),
    ];
    const cited = new Set(["citée"]);
    const ranked = rankCandidates("self", cur, cited, others, { minScore: 0.5 });
    expect(ranked.map((r) => r.id)).toEqual(["near"]);
  });
  it("ignore les notes sans embedding", () => {
    const others: NoteLike[] = [{ id: "x", title: "X", body: "b", fields: {} }];
    expect(rankCandidates("self", cur, new Set(), others)).toEqual([]);
  });
  it("respecte la limite", () => {
    const others = Array.from({ length: 10 }, (_, i) =>
      mkNote(`n${i}`, `N${i}`, [1, 0.01 * i, 0]),
    );
    expect(rankCandidates("self", cur, new Set(), others, { minScore: 0, limit: 3 }).length).toBe(3);
  });
});

describe("parseAmbientResponse", () => {
  const valid = new Set(["a", "b"]);
  it("parse un JSON propre et filtre les ids inconnus", () => {
    const raw = '{"links":[{"id":"a","title":"A","reason":"r"},{"id":"zzz","title":"Z","reason":"r"}],"contradictions":[{"id":"b","title":"B","issue":"i"}]}';
    const out = parseAmbientResponse(raw, valid);
    expect(out.links.map((l) => l.id)).toEqual(["a"]);
    expect(out.contradictions.map((c) => c.id)).toEqual(["b"]);
  });
  it("extrait le JSON même entouré de texte", () => {
    const raw = 'Voici: {"links":[],"contradictions":[]} fin';
    expect(parseAmbientResponse(raw, valid)).toEqual({ links: [], contradictions: [] });
  });
  it("retourne vide sur JSON invalide", () => {
    expect(parseAmbientResponse("pas du json", valid)).toEqual({ links: [], contradictions: [] });
  });
});
