import { describe, it, expect } from "vitest";
import { formatMailDate, formatMailDateTime } from "./mail-date";

// `now` fixe pour des assertions déterministes (indépendantes de la locale CI :
// on teste la STRUCTURE — présence/absence d'heure, libellés — pas le format
// locale exact de l'heure).
const NOW = new Date("2026-06-26T15:00:00");
const hasTime = (s: string) => /\d{1,2}:\d{2}/.test(s);

describe("formatMailDate", () => {
  it("vide / invalide → ''", () => {
    expect(formatMailDate("", NOW)).toBe("");
    expect(formatMailDate("pas-une-date", NOW)).toBe("");
  });

  it("aujourd'hui → heure", () => {
    const out = formatMailDate("2026-06-26T14:32:00", NOW);
    expect(hasTime(out)).toBe(true);
  });

  it("hier → 'hier'", () => {
    expect(formatMailDate("2026-06-25T09:00:00", NOW)).toBe("hier");
  });

  it("cette année (≠ aujourd'hui/hier) → date sans heure", () => {
    const out = formatMailDate("2026-03-10T09:00:00", NOW);
    expect(out).not.toBe("");
    expect(hasTime(out)).toBe(false);
  });

  it("année précédente → date sans heure", () => {
    const out = formatMailDate("2024-12-01T09:00:00", NOW);
    expect(out).not.toBe("");
    expect(hasTime(out)).toBe(false);
    expect(out).toMatch(/24/); // année sur 2 chiffres
  });
});

describe("formatMailDateTime", () => {
  it("aujourd'hui → heure seule (pas de virgule)", () => {
    const out = formatMailDateTime("2026-06-26T14:32:00", NOW);
    expect(hasTime(out)).toBe(true);
    expect(out).not.toContain(",");
  });

  it("autre jour → date + heure (virgule séparateur)", () => {
    const out = formatMailDateTime("2026-06-25T09:05:00", NOW);
    expect(out).toContain(",");
    expect(hasTime(out)).toBe(true);
  });

  it("vide → ''", () => {
    expect(formatMailDateTime("", NOW)).toBe("");
  });
});
