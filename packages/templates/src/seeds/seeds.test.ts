import { describe, it, expect } from "vitest";
import { SEED_TEMPLATES, DAILY_JOURNAL, MEETING_NOTES, RECIPE, PROJECT_BRIEF } from "./index.js";
import { validateTemplate } from "../validator.js";

describe("seed templates", () => {
  it("exports 4 seed templates", () => {
    expect(SEED_TEMPLATES).toHaveLength(4);
  });

  it("all seeds have unique ids", () => {
    const ids = SEED_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all seeds pass validation", () => {
    for (const template of SEED_TEMPLATES) {
      const result = validateTemplate(template);
      expect(result.ok, `Template ${template.name} failed validation`).toBe(true);
    }
  });

  it("daily journal contains cursor", () => {
    expect(DAILY_JOURNAL.body).toContain("{{cursor}}");
  });

  it("daily journal has date with format", () => {
    expect(DAILY_JOURNAL.body).toContain("{{date:EEEE D MMMM YYYY}}");
  });

  it("meeting notes has prompt variables", () => {
    expect(MEETING_NOTES.body).toContain("{{prompt:Sujet?}}");
    expect(MEETING_NOTES.body).toContain("{{prompt:Lieu?|Visio}}");
  });

  it("meeting notes has contact variable", () => {
    expect(MEETING_NOTES.body).toContain("{{contact:personne}}");
  });

  it("recipe has select variable", () => {
    expect(RECIPE.body).toContain("{{select:Facile|Moyen|Difficile}}");
  });

  it("recipe has cursor", () => {
    expect(RECIPE.body).toContain("{{cursor}}");
  });

  it("project brief has cursor", () => {
    expect(PROJECT_BRIEF.body).toContain("{{cursor}}");
  });

  it("project brief has contact variable", () => {
    expect(PROJECT_BRIEF.body).toContain("{{contact:personne}}");
  });
});
