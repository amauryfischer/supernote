// Tests de la table de remplacements typographiques (logique pure).
// `applySmartTypography(text)` modélise le résultat visible de l'input rule :
// le motif est ancré sur la fin du texte et le dernier caractère tapé est
// déjà présent dans `text`.

import { describe, it, expect } from "vitest";
import {
  applySmartTypography,
  SMART_TYPOGRAPHY_RULES,
} from "../extensions/smartTypography.js";

describe("applySmartTypography — flèches", () => {
  it("-> → →", () => {
    expect(applySmartTypography("a->")).toBe("a→");
  });
  it("<- → ←", () => {
    expect(applySmartTypography("a<-")).toBe("a←");
  });
  it("=> → ⇒", () => {
    expect(applySmartTypography("a=>")).toBe("a⇒");
  });
});

describe("applySmartTypography — em dash & ellipsis", () => {
  it("-- + espace → em dash (espace conservé)", () => {
    expect(applySmartTypography("mot-- ")).toBe("mot— ");
  });
  it("-- sans espace → inchangé", () => {
    expect(applySmartTypography("mot--")).toBe("mot--");
  });
  it("... → …", () => {
    expect(applySmartTypography("fin...")).toBe("fin…");
  });
});

describe("applySmartTypography — symboles (c)/(r)/(tm)", () => {
  it("(c) → © (casse indifférente)", () => {
    expect(applySmartTypography("Foo (c)")).toBe("Foo ©");
    expect(applySmartTypography("Foo (C)")).toBe("Foo ©");
  });
  it("(r) → ®", () => {
    expect(applySmartTypography("Foo (r)")).toBe("Foo ®");
  });
  it("(tm) → ™", () => {
    expect(applySmartTypography("Foo (tm)")).toBe("Foo ™");
    expect(applySmartTypography("Foo (TM)")).toBe("Foo ™");
  });
});

describe("applySmartTypography — fractions entourées d'espaces", () => {
  it("espace 1/2 espace → ½ (espaces conservés)", () => {
    expect(applySmartTypography("j'ai 1/2 ")).toBe("j'ai ½ ");
  });
  it("1/4 → ¼", () => {
    expect(applySmartTypography("a 1/4 ")).toBe("a ¼ ");
  });
  it("3/4 → ¾", () => {
    expect(applySmartTypography("a 3/4 ")).toBe("a ¾ ");
  });
  it("fraction sans espace de tête → inchangé", () => {
    expect(applySmartTypography("a/b 1/2")).toBe("a/b 1/2");
  });
});

describe("applySmartTypography — non-déclenchements", () => {
  it("texte normal inchangé", () => {
    expect(applySmartTypography("bonjour")).toBe("bonjour");
  });
  it("chaîne vide inchangée", () => {
    expect(applySmartTypography("")).toBe("");
  });
});

describe("SMART_TYPOGRAPHY_RULES — invariants", () => {
  it("motifs ancrés en fin de chaîne et non globaux", () => {
    for (const rule of SMART_TYPOGRAPHY_RULES) {
      expect(rule.find.source.endsWith("$")).toBe(true);
      // Un flag global casserait `test`/`replace` (lastIndex partagé).
      expect(rule.find.global).toBe(false);
    }
  });
  it("noms uniques", () => {
    const names = SMART_TYPOGRAPHY_RULES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
