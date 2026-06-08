import { describe, it, expect } from "vitest";
import { hashText, splitBlocks, isSubstantive, parseBlockComment, normalizeForMatch, bestBlockMatchIndex } from "./blockComments";

describe("hashText", () => {
  it("est stable et discriminant", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
  });
});

describe("splitBlocks", () => {
  it("coupe sur les lignes vides et hashe chaque bloc", () => {
    const b = splitBlocks("para un\nligne deux\n\npara deux");
    expect(b).toHaveLength(2);
    expect(b[0]!.text).toBe("para un\nligne deux");
    expect(b[1]!.text).toBe("para deux");
    expect(b[0]!.index).toBe(0);
    expect(b[1]!.index).toBe(1);
  });

  it("garde un bloc de code entier malgré les lignes vides", () => {
    const b = splitBlocks("avant\n\n```\nx = 1\n\ny = 2\n```\n\naprès");
    expect(b).toHaveLength(3);
    expect(b[1]!.text).toContain("x = 1");
    expect(b[1]!.text).toContain("y = 2");
  });

  it("le hash d'un bloc inchangé reste identique entre deux découpes", () => {
    const a = splitBlocks("# T\n\nbloc stable ici");
    const b = splitBlocks("# T modifié\n\nbloc stable ici");
    const stableA = a.find((x) => x.text === "bloc stable ici");
    const stableB = b.find((x) => x.text === "bloc stable ici");
    expect(stableA?.hash).toBe(stableB?.hash);
  });
});

describe("isSubstantive", () => {
  it("ignore titres courts et séparateurs", () => {
    expect(isSubstantive("# Titre")).toBe(false);
    expect(isSubstantive("---")).toBe(false);
    expect(isSubstantive("court")).toBe(false);
  });
  it("accepte un paragraphe de fond", () => {
    expect(isSubstantive("Voici un paragraphe assez long pour mériter une analyse de fond.")).toBe(true);
  });
});

describe("normalizeForMatch", () => {
  it("strippe le markdown et compacte", () => {
    expect(normalizeForMatch("## **Titre** `code`")).toBe("titre code");
  });
});

describe("bestBlockMatchIndex", () => {
  it("retrouve le bloc malgré le markdown source vs texte rendu", () => {
    const block = "Le **projet** avance bien cette semaine.";
    const rendered = ["Autre paragraphe ici.", "Le projet avance bien cette semaine.", "Encore un."];
    expect(bestBlockMatchIndex(block, rendered)).toBe(1);
  });
  it("retourne -1 si aucun candidat ne matche", () => {
    expect(bestBlockMatchIndex("texte unique introuvable", ["rien", "à voir"])).toBe(-1);
  });
});

describe("parseBlockComment", () => {
  it("parse un JSON propre", () => {
    const c = parseBlockComment('{"comment":"Préciser la date.","kind":"question"}');
    expect(c).toEqual({ comment: "Préciser la date.", kind: "question" });
  });
  it("retourne null si commentaire vide", () => {
    expect(parseBlockComment('{"comment":"","kind":"suggestion"}')).toBeNull();
  });
  it("normalise un kind inconnu en suggestion", () => {
    expect(parseBlockComment('{"comment":"x","kind":"bizarre"}')?.kind).toBe("suggestion");
  });
  it("retourne null sur JSON invalide", () => {
    expect(parseBlockComment("pas json")).toBeNull();
  });
  it("extrait le fix quand présent", () => {
    const c = parseBlockComment('{"comment":"faute","kind":"suggestion","fix":"Texte corrigé."}');
    expect(c?.fix).toBe("Texte corrigé.");
  });
  it("omet fix quand vide", () => {
    const c = parseBlockComment('{"comment":"ok","kind":"suggestion","fix":""}');
    expect(c?.fix).toBeUndefined();
  });
});
