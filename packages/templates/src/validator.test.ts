import { describe, it, expect } from "vitest";
import { validateTemplate, listVariables } from "./validator.js";
import type { Template } from "./types.js";

function tpl(body: string, extra: Partial<Template> = {}): Template {
  return { id: "t1", name: "Test", body, ...extra };
}

describe("validateTemplate", () => {
  it("returns ok for a valid body", () => {
    const result = validateTemplate(tpl("Hello {{date}}"));
    expect(result.ok).toBe(true);
  });

  it("returns err for empty body", () => {
    const result = validateTemplate(tpl(""));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_SYNTAX");
  });

  it("returns err for unknown token", () => {
    const result = validateTemplate(tpl("{{notareal_var}}"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNKNOWN_VARIABLE");
  });

  it("returns ok with one cursor", () => {
    const result = validateTemplate(tpl("Hello {{cursor}} world"));
    expect(result.ok).toBe(true);
  });

  it("returns err for multiple cursors", () => {
    const result = validateTemplate(tpl("{{cursor}} and {{cursor}}"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_SYNTAX");
  });

  it("returns ok for all variable kinds", () => {
    const body = [
      "{{date}}",
      "{{date:YYYY-MM-DD}}",
      "{{time}}",
      "{{datetime}}",
      "{{cursor}}",
      "{{prompt:Q?}}",
      "{{select:A|B|C}}",
      "{{contact}}",
      "{{contact:personne}}",
      "{{title}}",
      "{{vault.name}}",
      "{{vault.path}}",
      "{{user}}",
      "{{user.email}}",
      "{{random}}",
      "{{ulid}}",
      "{{counter:vault}}",
      "{{js:1+1}}",
      "{{template:header}}",
    ].join("\n");
    const result = validateTemplate(tpl(body));
    expect(result.ok).toBe(true);
  });
});

describe("listVariables", () => {
  it("lists all unique variables", () => {
    const vars = listVariables(tpl("{{date}} {{time}} {{cursor}}"));
    expect(vars).toHaveLength(3);
    expect(vars.map((v) => v.kind)).toEqual(["date", "time", "cursor"]);
  });

  it("returns empty array for body with no variables", () => {
    expect(listVariables(tpl("plain text"))).toHaveLength(0);
  });

  it("deduplicates variables", () => {
    const vars = listVariables(tpl("{{date}} and {{date}}"));
    expect(vars).toHaveLength(1);
  });

  it("includes arg for date with format", () => {
    const vars = listVariables(tpl("{{date:EEEE D MMMM YYYY}}"));
    expect(vars[0]?.arg).toBe("EEEE D MMMM YYYY");
  });

  it("includes options for select variable", () => {
    const vars = listVariables(tpl("{{select:A|B|C}}"));
    expect(vars[0]?.options).toEqual(["A", "B", "C"]);
  });
});
