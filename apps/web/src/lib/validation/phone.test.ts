import { describe, expect, it } from "vitest";
import { validatePhone } from "./phone";

describe("validatePhone", () => {
  it.each([
    "0612345678",
    "06 12 34 56 78",
    "+33 6 12 34 56 78",
    "+1 (415) 555-0132",
    "06-12-34-56-78",
  ])("accepte %s", (input) => {
    expect(validatePhone(input)).toEqual({ valid: true });
  });

  it.each([
    "abc",
    "12",
    "0a12345678",
    "",
    "  ",
  ])("rejette %s", (input) => {
    const r = validatePhone(input);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.message).toBe("Numéro invalide");
  });

  it("accepte avec espaces autour", () => {
    expect(validatePhone("  0612345678  ")).toEqual({ valid: true });
  });
});
