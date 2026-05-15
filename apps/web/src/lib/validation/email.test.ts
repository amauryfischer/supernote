import { describe, expect, it } from "vitest";
import { validateEmail } from "./email";

describe("validateEmail", () => {
  it.each([
    "alice@example.com",
    "user.name+tag@sub.domain.co",
    "a@b.cd",
  ])("accepte %s", (input) => {
    expect(validateEmail(input)).toEqual({ valid: true });
  });

  it.each([
    "x@y",
    "no-at-sign.com",
    "double@@example.com",
    "missing-tld@example",
    "spaces in@example.com",
    "",
  ])("rejette %s", (input) => {
    const r = validateEmail(input);
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.message).toBe("Email invalide");
  });

  it("trim les espaces avant validation", () => {
    expect(validateEmail("  alice@example.com  ")).toEqual({ valid: true });
  });
});
