import { describe, it, expect } from "vitest";
import { initials, avatarColor } from "./mail-avatar";

describe("initials", () => {
  it("nom à 2 mots → 2 initiales", () => expect(initials("Ada Lovelace", "a@b")).toBe("AL"));
  it("nom à 1 mot → 2 premières lettres", () => expect(initials("Charlotte", "a@b")).toBe("CH"));
  it("mot d'une lettre → 1 lettre", () => expect(initials("X", "a@b")).toBe("X"));
  it("pas de nom → 1ʳᵉ lettre de l'email", () => expect(initials("", "bob@x.fr")).toBe("B"));
  it("ignore mailto: et caractères non alphanum", () => expect(initials("", "mailto:.bob@x.fr")).toBe("B"));
  it("rien → ?", () => expect(initials("", "")).toBe("?"));
  it("toujours en majuscules", () => expect(initials("ada lovelace", "")).toBe("AL"));
});

describe("avatarColor", () => {
  it("déterministe pour une même clé", () => {
    expect(avatarColor("a@b.fr")).toEqual(avatarColor("a@b.fr"));
  });
  it("insensible à la casse et aux espaces", () => {
    expect(avatarColor("  A@B.FR ")).toEqual(avatarColor("a@b.fr"));
  });
  it("format hsl sobre attendu", () => {
    const c = avatarColor("test");
    expect(c.bg).toMatch(/^hsl\(\d{1,3} 42% 90%\)$/);
    expect(c.fg).toMatch(/^hsl\(\d{1,3} 40% 34%\)$/);
  });
  it("clés distinctes → teintes distinctes (cas courant)", () => {
    expect(avatarColor("alice@example.com").bg).not.toBe(avatarColor("zoe@autre.fr").bg);
  });
});
