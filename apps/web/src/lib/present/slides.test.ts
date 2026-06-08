import { describe, it, expect } from "vitest";
import { splitSlides } from "./slides";

describe("splitSlides", () => {
  it("coupe sur les titres H1", () => {
    const s = splitSlides("# Un\ntexte a\n# Deux\ntexte b");
    expect(s).toHaveLength(2);
    expect(s[0]!.content).toBe("# Un\ntexte a");
    expect(s[1]!.content).toBe("# Deux\ntexte b");
  });

  it("coupe sur les séparateurs sans rendre le trait", () => {
    const s = splitSlides("intro\n---\nsuite");
    expect(s).toHaveLength(2);
    expect(s[0]!.content).toBe("intro");
    expect(s[1]!.content).toBe("suite");
    expect(s.every((x) => !x.content.includes("---"))).toBe(true);
  });

  it("extrait les notes présentateur des commentaires HTML", () => {
    const s = splitSlides("# Titre\ncontenu\n<!-- dire ceci -->");
    expect(s).toHaveLength(1);
    expect(s[0]!.content).toBe("# Titre\ncontenu");
    expect(s[0]!.notes).toBe("dire ceci");
  });

  it("ne coupe pas à l'intérieur d'un bloc de code", () => {
    const s = splitSlides("# A\n```\n---\n# pas un titre\n```\nfin");
    expect(s).toHaveLength(1);
    expect(s[0]!.content).toContain("# pas un titre");
  });

  it("retourne au moins une diapo pour une note vide", () => {
    expect(splitSlides("")).toHaveLength(1);
  });

  it("ignore un H1 en tête sans flusher une diapo vide", () => {
    const s = splitSlides("# Seul titre\nptit texte");
    expect(s).toHaveLength(1);
  });
});
