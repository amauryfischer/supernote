import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderTemplate, TemplateRenderError } from "./index.js";
import type { Template, TemplateContext, TemplateResolvers, EntityRef } from "../types.js";

// ------ Mock resolvers factory --------------------------------

function makeResolvers(overrides: Partial<TemplateResolvers> = {}): TemplateResolvers {
  return {
    promptUser: vi.fn().mockResolvedValue("mocked-answer"),
    selectOption: vi.fn().mockResolvedValue("mocked-option"),
    pickEntity: vi.fn().mockResolvedValue({ id: "e1", label: "Alice", typeId: "personne" } satisfies EntityRef),
    incrementCounter: vi.fn().mockResolvedValue(1),
    runJS: vi.fn().mockReturnValue("js-result"),
    getTemplate: vi.fn().mockReturnValue(null),
    getVaultInfo: vi.fn().mockReturnValue({ name: "MyVault", path: "/home/user/vault" }),
    getUserInfo: vi.fn().mockReturnValue({ name: "Bob", email: "bob@example.com" }),
    ...overrides,
  };
}

const FIXED_DATE = new Date("2024-03-15T14:05:09");

function makeCtx(overrides: Partial<TemplateResolvers> = {}, now: Date = FIXED_DATE): TemplateContext {
  return { resolvers: makeResolvers(overrides), now };
}

// ------ Helpers -----------------------------------------------

function tpl(body: string, extra: Partial<Template> = {}): Template {
  return { id: "t1", name: "Test", body, ...extra };
}

// ============================================================
// Tests
// ============================================================

describe("renderTemplate — date/time variables", () => {
  it("renders {{date}} with default format", async () => {
    const r = await renderTemplate(tpl("{{date}}"), makeCtx());
    expect(r.body).toBe("2024-03-15");
  });

  it("renders {{date:YYYY-MM-DD HH:mm}}", async () => {
    const r = await renderTemplate(tpl("{{date:YYYY-MM-DD HH:mm}}"), makeCtx());
    expect(r.body).toBe("2024-03-15 14:05");
  });

  it("renders {{date:EEEE D MMMM YYYY}}", async () => {
    const r = await renderTemplate(tpl("{{date:EEEE D MMMM YYYY}}"), makeCtx());
    expect(r.body).toBe("Friday 15 March 2024");
  });

  it("renders {{time}} with default format", async () => {
    const r = await renderTemplate(tpl("{{time}}"), makeCtx());
    expect(r.body).toBe("14:05");
  });

  it("renders {{time:HH:mm:ss}}", async () => {
    const r = await renderTemplate(tpl("{{time:HH:mm:ss}}"), makeCtx());
    expect(r.body).toBe("14:05:09");
  });

  it("renders {{datetime}}", async () => {
    const r = await renderTemplate(tpl("{{datetime}}"), makeCtx());
    expect(r.body).toBe("2024-03-15 14:05");
  });

  it("replaces all occurrences of the same date token", async () => {
    const r = await renderTemplate(tpl("{{date}} / {{date}}"), makeCtx());
    expect(r.body).toBe("2024-03-15 / 2024-03-15");
  });
});

describe("renderTemplate — cursor", () => {
  it("removes {{cursor}} from body", async () => {
    const r = await renderTemplate(tpl("before {{cursor}} after"), makeCtx());
    expect(r.body).toBe("before  after");
  });

  it("computes cursor position correctly", async () => {
    const r = await renderTemplate(tpl("line1\nline2 {{cursor}} rest"), makeCtx());
    expect(r.cursorPosition).toEqual({ line: 1, col: 6 });
  });

  it("cursorPosition is undefined when no {{cursor}}", async () => {
    const r = await renderTemplate(tpl("no cursor here"), makeCtx());
    expect(r.cursorPosition).toBeUndefined();
  });

  it("cursor on first line at col 0", async () => {
    const r = await renderTemplate(tpl("{{cursor}}end"), makeCtx());
    expect(r.cursorPosition).toEqual({ line: 0, col: 0 });
  });
});

describe("renderTemplate — prompt", () => {
  it("calls promptUser and substitutes result", async () => {
    const promptUser = vi.fn().mockResolvedValue("Paris");
    const r = await renderTemplate(tpl("Lieu : {{prompt:Où?}}"), makeCtx({ promptUser }));
    expect(promptUser).toHaveBeenCalledWith("Où?", undefined);
    expect(r.body).toBe("Lieu : Paris");
  });

  it("passes defaultValue from prompt:Q?|default", async () => {
    const promptUser = vi.fn().mockResolvedValue("Visio");
    const r = await renderTemplate(tpl("{{prompt:Lieu?|Visio}}"), makeCtx({ promptUser }));
    expect(promptUser).toHaveBeenCalledWith("Lieu?", "Visio");
    expect(r.body).toBe("Visio");
  });

  it("substitutes empty string when prompt returns null (cancellation)", async () => {
    const promptUser = vi.fn().mockResolvedValue(null);
    const r = await renderTemplate(tpl("Lieu : {{prompt:Où?}}"), makeCtx({ promptUser }));
    expect(r.body).toBe("Lieu : ");
  });

  it("calls promptUser only once for duplicate prompts", async () => {
    const promptUser = vi.fn().mockResolvedValue("answer");
    const r = await renderTemplate(tpl("{{prompt:Q?}} {{prompt:Q?}}"), makeCtx({ promptUser }));
    expect(promptUser).toHaveBeenCalledTimes(1);
    expect(r.body).toBe("answer answer");
  });
});

describe("renderTemplate — select", () => {
  it("calls selectOption with options", async () => {
    const selectOption = vi.fn().mockResolvedValue("Moyen");
    const r = await renderTemplate(tpl("{{select:Facile|Moyen|Difficile}}"), makeCtx({ selectOption }));
    expect(selectOption).toHaveBeenCalledWith(["Facile", "Moyen", "Difficile"]);
    expect(r.body).toBe("Moyen");
  });

  it("substitutes empty when selection is null (cancelled)", async () => {
    const selectOption = vi.fn().mockResolvedValue(null);
    const r = await renderTemplate(tpl("diff: {{select:Facile|Moyen|Difficile}}"), makeCtx({ selectOption }));
    expect(r.body).toBe("diff: ");
  });
});

describe("renderTemplate — contact", () => {
  it("calls pickEntity with type filter", async () => {
    const pickEntity = vi.fn().mockResolvedValue({ id: "p1", label: "Alice Martin", typeId: "personne" });
    const r = await renderTemplate(tpl("{{contact:personne}}"), makeCtx({ pickEntity }));
    expect(pickEntity).toHaveBeenCalledWith("personne");
    expect(r.body).toBe("Alice Martin");
  });

  it("calls pickEntity without type for {{contact}}", async () => {
    const pickEntity = vi.fn().mockResolvedValue({ id: "p1", label: "Bob", typeId: "personne" });
    const r = await renderTemplate(tpl("{{contact}}"), makeCtx({ pickEntity }));
    expect(pickEntity).toHaveBeenCalledWith(undefined);
    expect(r.body).toBe("Bob");
  });

  it("substitutes empty when contact is null (cancelled)", async () => {
    const pickEntity = vi.fn().mockResolvedValue(null);
    const r = await renderTemplate(tpl("with {{contact:personne}}"), makeCtx({ pickEntity }));
    expect(r.body).toBe("with ");
  });
});

describe("renderTemplate — vault / user", () => {
  it("renders {{vault.name}}", async () => {
    const r = await renderTemplate(tpl("{{vault.name}}"), makeCtx());
    expect(r.body).toBe("MyVault");
  });

  it("renders {{vault.path}}", async () => {
    const r = await renderTemplate(tpl("{{vault.path}}"), makeCtx());
    expect(r.body).toBe("/home/user/vault");
  });

  it("renders {{user}}", async () => {
    const r = await renderTemplate(tpl("{{user}}"), makeCtx());
    expect(r.body).toBe("Bob");
  });

  it("renders {{user.email}}", async () => {
    const r = await renderTemplate(tpl("{{user.email}}"), makeCtx());
    expect(r.body).toBe("bob@example.com");
  });

  it("renders {{user.name}}", async () => {
    const r = await renderTemplate(tpl("{{user.name}}"), makeCtx());
    expect(r.body).toBe("Bob");
  });

  it("renders empty string when user has no email", async () => {
    const getUserInfo = vi.fn().mockReturnValue({ name: "Bob" });
    const r = await renderTemplate(tpl("{{user.email}}"), makeCtx({ getUserInfo }));
    expect(r.body).toBe("");
  });
});

describe("renderTemplate — random / ulid", () => {
  it("renders {{random}} as a numeric string", async () => {
    const r = await renderTemplate(tpl("{{random}}"), makeCtx());
    expect(Number.isFinite(parseFloat(r.body))).toBe(true);
  });

  it("renders {{ulid}} as 26-char string", async () => {
    const r = await renderTemplate(tpl("{{ulid}}"), makeCtx());
    expect(r.body).toHaveLength(26);
    expect(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(r.body)).toBe(true);
  });
});

describe("renderTemplate — counter", () => {
  it("calls incrementCounter with scope and substitutes value", async () => {
    const incrementCounter = vi.fn().mockResolvedValue(42);
    const r = await renderTemplate(tpl("item {{counter:vault}}"), makeCtx({ incrementCounter }));
    expect(incrementCounter).toHaveBeenCalledWith("vault");
    expect(r.body).toBe("item 42");
  });
});

describe("renderTemplate — js sandbox", () => {
  it("renders {{js:expression}}", async () => {
    const runJS = vi.fn().mockReturnValue(42);
    const r = await renderTemplate(tpl("result: {{js:1+1}}"), makeCtx({ runJS }));
    expect(runJS).toHaveBeenCalledWith("1+1");
    expect(r.body).toBe("result: 42");
  });

  it("throws TemplateRenderError on JS eval error", async () => {
    const runJS = vi.fn().mockImplementation(() => { throw new Error("syntax error"); });
    await expect(renderTemplate(tpl("{{js:bad}}"), makeCtx({ runJS }))).rejects.toBeInstanceOf(TemplateRenderError);
  });
});

describe("renderTemplate — template inclusion", () => {
  it("includes another template's body", async () => {
    const header: Template = { id: "header", name: "header", body: "## Header" };
    const getTemplate = vi.fn().mockReturnValue(header);
    const r = await renderTemplate(tpl("{{template:header}}\nContent"), makeCtx({ getTemplate }));
    expect(r.body).toContain("## Header");
    expect(r.body).toContain("Content");
  });

  it("substitutes empty when template not found", async () => {
    const getTemplate = vi.fn().mockReturnValue(null);
    await expect(
      renderTemplate(tpl("{{template:missing}}"), makeCtx({ getTemplate })),
    ).rejects.toBeInstanceOf(TemplateRenderError);
  });

  it("throws TemplateRenderError on recursive include", async () => {
    const recursive: Template = { id: "self", name: "self", body: "{{template:self}}" };
    const getTemplate = vi.fn().mockReturnValue(recursive);
    await expect(
      renderTemplate(recursive, makeCtx({ getTemplate }), ["self"]),
    ).rejects.toBeInstanceOf(TemplateRenderError);
  });
});

describe("renderTemplate — frontmatter", () => {
  it("passes frontmatter through unchanged", async () => {
    const template = tpl("body", { frontmatter: { tags: ["daily"], status: "draft" } });
    const r = await renderTemplate(template, makeCtx());
    expect(r.frontmatter).toEqual({ tags: ["daily"], status: "draft" });
  });

  it("returns empty frontmatter when none defined", async () => {
    const r = await renderTemplate(tpl("body"), makeCtx());
    expect(r.frontmatter).toEqual({});
  });
});

describe("renderTemplate — bindings", () => {
  it("records all resolved bindings", async () => {
    const r = await renderTemplate(tpl("{{date}} {{time}}"), makeCtx());
    expect(r.bindings["{{date}}"]).toBe("2024-03-15");
    expect(r.bindings["{{time}}"]).toBe("14:05");
  });
});

describe("renderTemplate — initialBindings", () => {
  it("applies initialBindings as pre-substituted values", async () => {
    const ctx: TemplateContext = {
      resolvers: makeResolvers(),
      now: FIXED_DATE,
      initialBindings: { title: "My Note" },
    };
    const r = await renderTemplate(tpl("# {{title}}"), ctx);
    expect(r.body).toBe("# My Note");
  });
});

describe("renderTemplate — complex body", () => {
  it("renders a realistic daily journal template", async () => {
    const body = "Journal du {{date:EEEE D MMMM YYYY}}\n\n## Ce qui a marqué\n{{cursor}}\n\n## Actions\n- [ ]";
    const r = await renderTemplate(tpl(body), makeCtx());
    expect(r.body).toContain("Friday 15 March 2024");
    expect(r.body).not.toContain("{{cursor}}");
    expect(r.cursorPosition).toBeDefined();
  });

  it("renders a recipe template with multiple prompts and select", async () => {
    const promptUser = vi.fn()
      .mockResolvedValueOnce("Tarte aux pommes")
      .mockResolvedValueOnce("30min")
      .mockResolvedValueOnce("6");
    const selectOption = vi.fn().mockResolvedValue("Facile");
    const body = "# {{prompt:Nom de la recette?}}\n- Temps: {{prompt:Temps de préparation?}}\n- Difficulté: {{select:Facile|Moyen|Difficile}}\n- Personnes: {{prompt:Pour combien?|4}}\n## Ingrédients\n- {{cursor}}";
    const r = await renderTemplate(tpl(body), makeCtx({ promptUser, selectOption }));
    expect(r.body).toContain("Tarte aux pommes");
    expect(r.body).toContain("30min");
    expect(r.body).toContain("Facile");
    expect(r.body).toContain("6");
    expect(r.body).not.toContain("{{cursor}}");
    expect(r.cursorPosition).toBeDefined();
  });
});
