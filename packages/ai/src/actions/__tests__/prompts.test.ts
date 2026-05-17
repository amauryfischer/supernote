import { describe, it, expect } from "vitest";
import {
  REFORMAT_PROMPT_V1,
  SUMMARIZE_PROMPT_V1,
  FIX_SPELLING_PROMPT_V1,
  AI_SYSTEM_PROMPT,
  renderPrompt,
  getDefaultPrompt,
} from "../prompts.js";

describe("renderPrompt", () => {
  it("remplace les variables {{...}}", () => {
    const out = renderPrompt("Hello {{name}} from {{place}}", {
      name: "Jean",
      place: "Paris",
    });
    expect(out).toBe("Hello Jean from Paris");
  });

  it("laisse les variables non fournies vides", () => {
    const out = renderPrompt("Hello {{name}}", {});
    expect(out).toBe("Hello ");
  });

  it("ignore les espaces dans les variables", () => {
    const out = renderPrompt("{{ name }}", { name: "X" });
    expect(out).toBe("X");
  });
});

describe("default prompts", () => {
  it("REFORMAT contient {{selection}}", () => {
    expect(REFORMAT_PROMPT_V1).toContain("{{selection}}");
  });
  it("SUMMARIZE contient {{selection}}", () => {
    expect(SUMMARIZE_PROMPT_V1).toContain("{{selection}}");
  });
  it("FIX_SPELLING contient {{selection}}", () => {
    expect(FIX_SPELLING_PROMPT_V1).toContain("{{selection}}");
  });
  it("SYSTEM prompt est strict (réponse directe)", () => {
    expect(AI_SYSTEM_PROMPT).toMatch(/UNIQUEMENT|seul[ement]*/i);
  });
});

describe("getDefaultPrompt", () => {
  it("retourne le prompt pour chaque action MVP", () => {
    expect(getDefaultPrompt("reformat")).toBe(REFORMAT_PROMPT_V1);
    expect(getDefaultPrompt("summarize")).toBe(SUMMARIZE_PROMPT_V1);
    expect(getDefaultPrompt("fix-spelling")).toBe(FIX_SPELLING_PROMPT_V1);
  });
});
