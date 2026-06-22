import { describe, it, expect } from "vitest";
import { slugifyName, resolveFileNameStem } from "./entity-filename";

const ISO = "2026-06-21T10:30:00.000Z";

describe("slugifyName", () => {
  it("lowercases, dashes spaces, strips diacritics and punctuation", () => {
    expect(slugifyName("Réunion de Café !!")).toBe("reunion-de-cafe");
  });

  it("caps at 80 chars", () => {
    expect(slugifyName("a".repeat(200))).toHaveLength(80);
  });

  it("returns empty for a value with no usable characters", () => {
    expect(slugifyName("@#$%")).toBe("");
  });
});

describe("resolveFileNameStem", () => {
  it("note {title} → slugified title", () => {
    expect(
      resolveFileNameStem("{title}", { title: "Mon Idée Géniale" }, "id1", ISO),
    ).toBe("mon-idee-geniale");
  });

  it("personne {name} → slugified name", () => {
    expect(
      resolveFileNameStem("{name}", { name: "Linh Dan" }, "id1", ISO),
    ).toBe("linh-dan");
  });

  it("interaction {date}-{title} uses fields.date then title", () => {
    expect(
      resolveFileNameStem(
        "{date}-{title}",
        { date: "2026-01-15", title: "Point hebdo" },
        "id1",
        ISO,
      ),
    ).toBe("2026-01-15-point-hebdo");
  });

  it("collapses dash debris when a token is empty", () => {
    // No title → {date}-{title} must not leave a trailing dash.
    expect(
      resolveFileNameStem("{date}-{title}", { date: "2026-01-15" }, "id1", ISO),
    ).toBe("2026-01-15");
  });

  it("{date} falls back to the createdAt day when no date field", () => {
    expect(resolveFileNameStem("{date}", {}, "id1", ISO)).toBe("2026-06-21");
  });

  it("{slug} resolves the best title-ish field (titre alias)", () => {
    expect(
      resolveFileNameStem("{slug}", { titre: "Sans Nom" }, "id1", ISO),
    ).toBe("sans-nom");
  });

  it("{id} substitutes the raw id", () => {
    expect(resolveFileNameStem("{id}", {}, "01ABCDEF", ISO)).toBe("01ABCDEF");
  });

  it("returns '' when the pattern resolves empty (caller falls back to id)", () => {
    expect(resolveFileNameStem("{title}", { title: "" }, "id1", ISO)).toBe("");
    expect(resolveFileNameStem("{title}", {}, "id1", ISO)).toBe("");
  });

  it("stringifies non-string field values", () => {
    expect(resolveFileNameStem("{name}", { name: 42 }, "id1", ISO)).toBe("42");
  });
});
