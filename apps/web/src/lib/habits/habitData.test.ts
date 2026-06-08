import { describe, expect, it } from "vitest";
import {
  buildGrid,
  computeStats,
  computeStreaks,
  cycleCount,
  dayLevel,
  gridWeeks,
  parseCheckins,
  parseHabit,
  serializeCheckins,
  toDateKey,
} from "./habitData";

// Mercredi 10 juin 2026, milieu de mois — évite les effets de bord d'année.
const TODAY = new Date(2026, 5, 10);

describe("toDateKey", () => {
  it("formate en local YYYY-MM-DD", () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toDateKey(TODAY)).toBe("2026-06-10");
  });
});

describe("parseCheckins / serializeCheckins", () => {
  it("round-trip et élagage des zéros", () => {
    const raw = serializeCheckins({ "2026-06-09": 2, "2026-06-08": 0 });
    expect(parseCheckins(raw)).toEqual({ "2026-06-09": 2 });
  });

  it("tolère JSON invalide, clés non-date, valeurs négatives", () => {
    expect(parseCheckins("not json")).toEqual({});
    expect(parseCheckins('{"abc": 1, "2026-06-09": -3, "2026-06-08": 1.7}')).toEqual({
      "2026-06-08": 1,
    });
    expect(parseCheckins(undefined)).toEqual({});
  });
});

describe("cycleCount", () => {
  it("incrémente puis revient à zéro une fois la cible atteinte", () => {
    expect(cycleCount(0, 3)).toBe(1);
    expect(cycleCount(2, 3)).toBe(3);
    expect(cycleCount(3, 3)).toBe(0);
    expect(cycleCount(5, 3)).toBe(0); // dépassement → reset aussi
  });
});

describe("dayLevel", () => {
  it("échelonne 0 → 4", () => {
    expect(dayLevel(0, 3)).toBe(0);
    expect(dayLevel(1, 3)).toBe(1); // < 50 %
    expect(dayLevel(2, 3)).toBe(2); // ≥ 50 %
    expect(dayLevel(3, 3)).toBe(3); // validé
    expect(dayLevel(4, 3)).toBe(4); // dépassé
    expect(dayLevel(1, 1)).toBe(3);
  });
});

describe("computeStreaks", () => {
  it("aujourd'hui non coché ne casse pas la série", () => {
    const checkins = { "2026-06-09": 1, "2026-06-08": 1, "2026-06-07": 1 };
    expect(computeStreaks(checkins, 1, TODAY)).toEqual({ current: 3, best: 3 });
  });

  it("aujourd'hui coché allonge la série", () => {
    const checkins = { "2026-06-10": 1, "2026-06-09": 1 };
    expect(computeStreaks(checkins, 1, TODAY).current).toBe(2);
  });

  it("un trou avant-hier remet la série courante à zéro mais garde le record", () => {
    const checkins = {
      "2026-06-10": 1,
      // trou le 9
      "2026-06-05": 1,
      "2026-06-04": 1,
      "2026-06-03": 1,
      "2026-06-02": 1,
    };
    expect(computeStreaks(checkins, 1, TODAY)).toEqual({ current: 1, best: 4 });
  });

  it("respecte la cible quotidienne (jour partiel = pas validé)", () => {
    const checkins = { "2026-06-10": 1, "2026-06-09": 3, "2026-06-08": 3 };
    expect(computeStreaks(checkins, 3, TODAY)).toEqual({ current: 2, best: 2 });
  });

  it("habitude vide", () => {
    expect(computeStreaks({}, 1, TODAY)).toEqual({ current: 0, best: 0 });
  });
});

describe("computeStats", () => {
  it("compte les jours validés et le taux sur 30 jours", () => {
    const checkins: Record<string, number> = {};
    // 15 jours validés dans la fenêtre des 30 derniers jours.
    for (let i = 0; i < 15; i++) {
      const d = new Date(TODAY);
      d.setDate(d.getDate() - i);
      checkins[toDateKey(d)] = 1;
    }
    // Un vieux jour hors fenêtre — compte dans le total, pas dans rate30.
    checkins["2025-01-01"] = 1;
    const stats = computeStats(checkins, 1, TODAY);
    expect(stats.totalDays).toBe(16);
    expect(stats.rate30).toBe(50);
  });
});

describe("buildGrid", () => {
  it("dernière colonne contient aujourd'hui, semaines lun→dim", () => {
    const { columns } = buildGrid(TODAY, 4);
    expect(columns).toHaveLength(4);
    const last = columns[3]!;
    expect(last).toHaveLength(7);
    expect(last[0]!.key).toBe("2026-06-08"); // lundi
    expect(last.some((c) => c.key === "2026-06-10")).toBe(true);
    // Jeudi → dimanche de la semaine courante sont futurs.
    expect(last.filter((c) => c.future).map((c) => c.key)).toEqual([
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
    ]);
  });

  it("étiquette le mois sur la colonne contenant un 1er", () => {
    const { monthLabels } = buildGrid(TODAY, 10);
    expect(monthLabels.some((m) => m.label.startsWith("juin"))).toBe(true);
  });
});

describe("gridWeeks", () => {
  it("habitude créée cette semaine → 1 colonne", () => {
    // TODAY = mercredi 10 juin ; création lundi 8 juin → même semaine.
    expect(gridWeeks(new Date(2026, 5, 8).toISOString(), TODAY)).toBe(1);
    expect(gridWeeks(TODAY.toISOString(), TODAY)).toBe(1);
  });

  it("pousse d'une colonne par semaine entamée", () => {
    // Dimanche 7 juin = semaine précédente (lun 1er juin) → 2 colonnes.
    expect(gridWeeks(new Date(2026, 5, 7).toISOString(), TODAY)).toBe(2);
    // Il y a ~3 semaines (mer 20 mai, semaine du lun 18 mai) → 4 colonnes.
    expect(gridWeeks(new Date(2026, 4, 20).toISOString(), TODAY)).toBe(4);
  });

  it("plafonne à 53 semaines", () => {
    expect(gridWeeks(new Date(2024, 0, 1).toISOString(), TODAY)).toBe(53);
  });

  it("createdAt invalide → plafond (année pleine)", () => {
    expect(gridWeeks("n'importe quoi", TODAY)).toBe(53);
  });
});

describe("parseHabit", () => {
  it("applique les défauts sur fields incomplets", () => {
    const h = parseHabit({ id: "h1", fields: { name: "Lire" }, createdAt: "2026-01-01T00:00:00Z" });
    expect(h).toMatchObject({
      id: "h1",
      name: "Lire",
      target: 1,
      unit: "",
      archived: false,
      checkins: {},
    });
    expect(h.icon.length).toBeGreaterThan(0);
    expect(h.color.startsWith("#")).toBe(true);
  });

  it("lit target/checkins/archived typés", () => {
    const h = parseHabit({
      id: "h2",
      fields: {
        name: "Eau",
        target: 3,
        unit: "verres",
        archived: true,
        checkins: '{"2026-06-09": 2}',
      },
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(h.target).toBe(3);
    expect(h.archived).toBe(true);
    expect(h.checkins).toEqual({ "2026-06-09": 2 });
  });
});
