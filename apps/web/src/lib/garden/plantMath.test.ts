import { describe, it, expect } from "vitest";
import { daysSince, stageFor, toPlant, gardenStats, plantingOrder } from "./plantMath";

const NOW = new Date("2026-06-08T12:00:00.000Z").getTime();

describe("daysSince", () => {
  it("compte les jours écoulés", () => {
    expect(daysSince("2026-06-08T12:00:00.000Z", NOW)).toBe(0);
    expect(daysSince("2026-06-06T12:00:00.000Z", NOW)).toBe(2);
    expect(daysSince("2026-05-09T12:00:00.000Z", NOW)).toBe(30);
  });
  it("retourne Infinity pour une date invalide", () => {
    expect(daysSince("pas-une-date", NOW)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("stageFor", () => {
  it("mappe les seuils de stade", () => {
    expect(stageFor(0)).toBe("thriving");
    expect(stageFor(2)).toBe("thriving");
    expect(stageFor(3)).toBe("growing");
    expect(stageFor(14)).toBe("growing");
    expect(stageFor(15)).toBe("dormant");
    expect(stageFor(90)).toBe("dormant");
    expect(stageFor(91)).toBe("withering");
  });
});

describe("toPlant", () => {
  it("fleurit avec des backlinks et augmente la vigueur", () => {
    const fresh = toPlant(
      { id: "a", title: "A", updatedAt: "2026-06-08T12:00:00.000Z", createdAt: "x", backlinks: 3 },
      NOW,
    );
    expect(fresh.stage).toBe("thriving");
    expect(fresh.flowering).toBe(true);
    expect(fresh.vigor).toBeGreaterThan(0.85);
    expect(fresh.vigor).toBeLessThanOrEqual(1);
  });
  it("note ancienne sans liens = fanée, pas de fleur", () => {
    const old = toPlant(
      { id: "b", title: "B", updatedAt: "2026-01-01T12:00:00.000Z", createdAt: "x", backlinks: 0 },
      NOW,
    );
    expect(old.stage).toBe("withering");
    expect(old.flowering).toBe(false);
  });
  it("species est stable et borné 0..3", () => {
    const p1 = toPlant({ id: "same", title: "T", updatedAt: "x", createdAt: "x", backlinks: 0 }, NOW);
    const p2 = toPlant({ id: "same", title: "T", updatedAt: "x", createdAt: "x", backlinks: 0 }, NOW);
    expect(p1.species).toBe(p2.species);
    expect(p1.species).toBeGreaterThanOrEqual(0);
    expect(p1.species).toBeLessThanOrEqual(3);
  });
});

describe("gardenStats", () => {
  it("agrège les compteurs", () => {
    const plants = [
      toPlant({ id: "a", title: "A", updatedAt: "2026-06-08T12:00:00.000Z", createdAt: "x", backlinks: 2 }, NOW),
      toPlant({ id: "b", title: "B", updatedAt: "2026-01-01T12:00:00.000Z", createdAt: "x", backlinks: 0 }, NOW),
    ];
    const s = gardenStats(plants);
    expect(s.total).toBe(2);
    expect(s.thriving).toBe(1);
    expect(s.withering).toBe(1);
    expect(s.flowering).toBe(1);
  });
});

describe("plantingOrder", () => {
  it("trie par vigueur croissante (fanées au fond)", () => {
    const a = toPlant({ id: "a", title: "A", updatedAt: "2026-06-08T12:00:00.000Z", createdAt: "x", backlinks: 0 }, NOW);
    const b = toPlant({ id: "b", title: "B", updatedAt: "2026-01-01T12:00:00.000Z", createdAt: "x", backlinks: 0 }, NOW);
    const ordered = plantingOrder([a, b]);
    expect(ordered[0]!.id).toBe("b");
    expect(ordered[1]!.id).toBe("a");
  });
});
