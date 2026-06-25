import { describe, expect, it } from "vitest";

import {
  QUADRANTS,
  quadrantOf,
  quadrantToTodoFields,
  type EisenhowerQuadrant,
} from "./mail-eisenhower";

describe("QUADRANTS", () => {
  it("liste les 4 quadrants dans l'ordre de grille (do, schedule, delegate, eliminate)", () => {
    expect(QUADRANTS.map((q) => q.id)).toEqual(["do", "schedule", "delegate", "eliminate"]);
  });

  it("porte les libellés FR attendus", () => {
    expect(QUADRANTS.map((q) => q.label)).toEqual(["Faire", "Planifier", "Déléguer", "Éliminer"]);
  });

  it("décrit correctement les axes urgent/important de chaque quadrant", () => {
    const byId = Object.fromEntries(QUADRANTS.map((q) => [q.id, q]));
    expect(byId.do).toMatchObject({ urgent: true, important: true });
    expect(byId.schedule).toMatchObject({ urgent: false, important: true });
    expect(byId.delegate).toMatchObject({ urgent: true, important: false });
    expect(byId.eliminate).toMatchObject({ urgent: false, important: false });
  });
});

describe("quadrantToTodoFields", () => {
  it("do = urgent + high", () => {
    expect(quadrantToTodoFields("do")).toEqual({ urgent: true, importance: "high" });
  });
  it("schedule = !urgent + high", () => {
    expect(quadrantToTodoFields("schedule")).toEqual({ urgent: false, importance: "high" });
  });
  it("delegate = urgent + low", () => {
    expect(quadrantToTodoFields("delegate")).toEqual({ urgent: true, importance: "low" });
  });
  it("eliminate = !urgent + low", () => {
    expect(quadrantToTodoFields("eliminate")).toEqual({ urgent: false, importance: "low" });
  });
});

describe("quadrantOf", () => {
  it("urgent + high = do", () => {
    expect(quadrantOf(true, "high")).toBe("do");
  });
  it("urgent + critical = do (critical compte comme important)", () => {
    expect(quadrantOf(true, "critical")).toBe("do");
  });
  it("!urgent + high = schedule", () => {
    expect(quadrantOf(false, "high")).toBe("schedule");
  });
  it("urgent + low = delegate", () => {
    expect(quadrantOf(true, "low")).toBe("delegate");
  });
  it("!urgent + low = eliminate", () => {
    expect(quadrantOf(false, "low")).toBe("eliminate");
  });

  it("medium est non-important (cohérent avec TodoMatrix.isImportant)", () => {
    expect(quadrantOf(true, "medium")).toBe("delegate");
    expect(quadrantOf(false, "medium")).toBe("eliminate");
  });

  it("valeur d'importance vide ou inconnue = non-importante", () => {
    expect(quadrantOf(true, "")).toBe("delegate");
    expect(quadrantOf(false, "wat")).toBe("eliminate");
  });
});

describe("round-trip quadrantToTodoFields ↔ quadrantOf", () => {
  const all: EisenhowerQuadrant[] = ["do", "schedule", "delegate", "eliminate"];
  for (const q of all) {
    it(`${q} → champs → quadrant revient à ${q}`, () => {
      const fields = quadrantToTodoFields(q);
      expect(quadrantOf(fields.urgent, fields.importance)).toBe(q);
    });
  }
});
