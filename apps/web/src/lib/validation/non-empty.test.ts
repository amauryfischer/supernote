import { describe, expect, it } from "vitest";
import { validateNonEmpty } from "./non-empty";

describe("validateNonEmpty", () => {
  it("renvoie valid pour une chaîne non vide", () => {
    expect(validateNonEmpty("hello")).toEqual({ valid: true });
  });

  it("renvoie invalid pour chaîne vide", () => {
    expect(validateNonEmpty("")).toEqual({ valid: false, message: "Ce champ est requis" });
  });

  it("renvoie invalid pour chaîne uniquement espaces", () => {
    expect(validateNonEmpty("   ")).toEqual({ valid: false, message: "Ce champ est requis" });
  });

  it("renvoie invalid pour chaîne uniquement tabulations/sauts", () => {
    expect(validateNonEmpty("\t\n  ")).toEqual({ valid: false, message: "Ce champ est requis" });
  });
});
