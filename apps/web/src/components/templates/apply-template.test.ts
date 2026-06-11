import { describe, it, expect } from "vitest";
import type { Template } from "@supernote/templates";
import {
  applyTemplate,
  buildRuntimeResolvers,
  collectPrompts,
  deriveTitleFromBody,
  sanitizeFrontmatter,
} from "./apply-template";

function tpl(body: string, extra: Partial<Template> = {}): Template {
  return { id: "t1", name: "Test", body, ...extra };
}

// A fixed clock so {{date}}/{{time}} assertions are deterministic.
const NOW = new Date("2026-06-11T14:05:00");

describe("collectPrompts", () => {
  it("extrait les prompts en ordre de déclaration, dédupliqués", () => {
    const prompts = collectPrompts(
      tpl("{{prompt:Sujet?}} — {{prompt:Lieu?|Visio}} / encore {{prompt:Sujet?}}"),
    );
    expect(prompts.map((p) => p.question)).toEqual(["Sujet?", "Lieu?"]);
    expect(prompts[1]?.defaultValue).toBe("Visio");
  });

  it("renvoie une liste vide quand il n'y a pas de prompt", () => {
    expect(collectPrompts(tpl("# {{date}}\n{{cursor}}"))).toEqual([]);
  });
});

describe("applyTemplate — interpolation runtime", () => {
  it("interpole {{date}} et {{time}} depuis l'horloge courante", async () => {
    const r = await applyTemplate(tpl("{{date}} {{time}}"), {
      promptAnswers: {},
      now: NOW,
    });
    expect(r.body).toBe("2026-06-11 14:05");
    expect(r.bindings["{{date}}"]).toBe("2026-06-11");
    expect(r.bindings["{{time}}"]).toBe("14:05");
  });

  it("substitue les réponses de prompt fournies par l'utilisateur", async () => {
    const r = await applyTemplate(tpl("Réunion {{prompt:Sujet?}} à {{prompt:Lieu?|Visio}}"), {
      promptAnswers: { "Sujet?": "Budget", "Lieu?": "Salle B" },
      now: NOW,
    });
    expect(r.body).toBe("Réunion Budget à Salle B");
  });

  it("retombe sur la valeur par défaut quand un prompt n'a pas de réponse", async () => {
    const r = await applyTemplate(tpl("Lieu : {{prompt:Lieu?|Visio}}"), {
      promptAnswers: {},
      now: NOW,
    });
    expect(r.body).toBe("Lieu : Visio");
  });

  it("retire {{cursor}} et calcule sa position", async () => {
    const r = await applyTemplate(tpl("# {{date}}\n{{cursor}}rest"), {
      promptAnswers: {},
      now: NOW,
    });
    expect(r.body).toBe("# 2026-06-11\nrest");
    expect(r.cursorPosition).toEqual({ line: 1, col: 0 });
  });
});

describe("buildRuntimeResolvers", () => {
  it("promptUser renvoie la réponse gathered, sinon le défaut", async () => {
    const resolvers = buildRuntimeResolvers({ promptAnswers: { "Q?": "A" } });
    expect(await resolvers.promptUser("Q?")).toBe("A");
    expect(await resolvers.promptUser("Autre?", "def")).toBe("def");
    expect(await resolvers.promptUser("Vide?")).toBe("");
  });

  it("selectOption prend la première option", async () => {
    const resolvers = buildRuntimeResolvers({ promptAnswers: {} });
    expect(await resolvers.selectOption(["x", "y"])).toBe("x");
  });
});

describe("deriveTitleFromBody", () => {
  it("prend la première ligne non vide, sans marqueur de titre", () => {
    expect(deriveTitleFromBody("# Mon titre\n\ncorps", "fallback")).toBe("Mon titre");
    expect(deriveTitleFromBody("\n\n  Texte simple", "fallback")).toBe("Texte simple");
  });

  it("retombe sur le fallback quand le corps est vide", () => {
    expect(deriveTitleFromBody("\n\n   ", "Template X")).toBe("Template X");
  });
});

describe("sanitizeFrontmatter", () => {
  it("garde les scalaires et tableaux de strings, drop le reste", () => {
    const out = sanitizeFrontmatter({
      title: "x",
      count: 3,
      done: false,
      empty: null,
      tags: ["a", "b"],
      mixed: ["a", 1],
      nested: { foo: "bar" },
    });
    expect(out).toEqual({ title: "x", count: 3, done: false, empty: null, tags: ["a", "b"] });
  });
});
