import { describe, it, expect } from "vitest";
import { toYmdKey, datesWithNoteFromEntities } from "./journal-dates";

describe("toYmdKey", () => {
  it("garde une date nue YYYY-MM-DD telle quelle", () => {
    expect(toYmdKey("2026-06-11")).toBe("2026-06-11");
  });

  it("extrait le jour d'un ISO datetime complet sans décalage de fuseau", () => {
    // Le préfixe YYYY-MM-DD est pris tel quel : pas de glissement de jour dû à new Date().
    expect(toYmdKey("2026-06-11T23:30:00.000Z")).toBe("2026-06-11");
  });

  it("normalise une date parsable non préfixée YYYY-MM-DD", () => {
    expect(toYmdKey("June 11, 2026")).toBe("2026-06-11");
  });

  it("renvoie null pour une valeur non-string", () => {
    expect(toYmdKey(null)).toBeNull();
    expect(toYmdKey(undefined)).toBeNull();
    expect(toYmdKey(42)).toBeNull();
    expect(toYmdKey(["2026-06-11"])).toBeNull();
  });

  it("renvoie null pour une chaîne vide ou non-date", () => {
    expect(toYmdKey("")).toBeNull();
    expect(toYmdKey("pas une date")).toBeNull();
  });
});

describe("datesWithNoteFromEntities", () => {
  it("dérive l'ensemble des dates depuis le champ `date`", () => {
    const set = datesWithNoteFromEntities([
      { fields: { date: "2026-06-11" } },
      { fields: { date: "2026-06-10T08:00:00Z" } },
      { fields: { date: "2026-06-09" } },
    ]);
    expect(set).toEqual(new Set(["2026-06-11", "2026-06-10", "2026-06-09"]));
  });

  it("dédoublonne les dates identiques", () => {
    const set = datesWithNoteFromEntities([
      { fields: { date: "2026-06-11" } },
      { fields: { date: "2026-06-11T12:00:00Z" } },
    ]);
    expect(set).toEqual(new Set(["2026-06-11"]));
  });

  it("ignore les entrées sans champ `date` exploitable", () => {
    const set = datesWithNoteFromEntities([
      { fields: { date: "2026-06-11" } },
      { fields: {} },
      { fields: { date: "" } },
      { fields: { date: null } },
    ]);
    expect(set).toEqual(new Set(["2026-06-11"]));
  });

  it("renvoie un ensemble vide pour une liste vide", () => {
    expect(datesWithNoteFromEntities([])).toEqual(new Set());
  });
});
