import { describe, it, expect } from "vitest";
import { pickContactEmail, dedupeEmails, parseRecipientInput } from "./mail-recipients";

describe("pickContactEmail", () => {
  it("préfère le label \"pro\"", () => {
    expect(
      pickContactEmail([
        { value: "perso@x.io", label: "perso" },
        { value: "pro@x.io", label: "pro" },
      ]),
    ).toBe("pro@x.io");
  });

  it("sans \"pro\" → première adresse non vide", () => {
    expect(
      pickContactEmail([
        { value: "  ", label: "pro" },
        { value: "first@x.io", label: "perso" },
      ]),
    ).toBe("first@x.io");
  });

  it("trim l'adresse retenue", () => {
    expect(pickContactEmail([{ value: "  a@b.io  " }])).toBe("a@b.io");
  });

  it("aucune adresse valable → null", () => {
    expect(pickContactEmail([])).toBeNull();
    expect(pickContactEmail(undefined)).toBeNull();
    expect(pickContactEmail([{ value: "   " }])).toBeNull();
  });
});

describe("dedupeEmails", () => {
  it("dé-duplique sans tenir compte de la casse, garde la 1ʳᵉ occurrence", () => {
    expect(dedupeEmails(["A@x.io", "a@x.io", "b@x.io"])).toEqual(["A@x.io", "b@x.io"]);
  });

  it("retire les vides et trim", () => {
    expect(dedupeEmails([" a@x.io ", "", "   "])).toEqual(["a@x.io"]);
  });
});

describe("parseRecipientInput", () => {
  it("découpe sur virgules, points-virgules, espaces et retours ligne", () => {
    expect(parseRecipientInput("a@x.io, b@x.io; c@x.io\nd@x.io")).toEqual([
      "a@x.io",
      "b@x.io",
      "c@x.io",
      "d@x.io",
    ]);
  });

  it("chaîne vide → []", () => {
    expect(parseRecipientInput("   ")).toEqual([]);
  });
});
