import { describe, it, expect } from "vitest";
import { parseVariables, findAllTokens, parseToken } from "./index.js";

describe("parseToken", () => {
  it("parses date", () => {
    expect(parseToken("date")).toMatchObject({ kind: "date", arg: undefined });
  });

  it("parses date:YYYY-MM-DD", () => {
    expect(parseToken("date:YYYY-MM-DD")).toMatchObject({ kind: "date", arg: "YYYY-MM-DD" });
  });

  it("parses time", () => {
    expect(parseToken("time")).toMatchObject({ kind: "time" });
  });

  it("parses time:HH:mm", () => {
    expect(parseToken("time:HH:mm")).toMatchObject({ kind: "time", arg: "HH:mm" });
  });

  it("parses datetime", () => {
    expect(parseToken("datetime")).toMatchObject({ kind: "datetime" });
  });

  it("parses cursor", () => {
    expect(parseToken("cursor")).toMatchObject({ kind: "cursor" });
  });

  it("parses prompt:Question?", () => {
    expect(parseToken("prompt:Question?")).toMatchObject({ kind: "prompt", arg: "Question?" });
  });

  it("parses select:opt1|opt2|opt3", () => {
    const v = parseToken("select:Facile|Moyen|Difficile");
    expect(v?.kind).toBe("select");
    expect(v?.options).toEqual(["Facile", "Moyen", "Difficile"]);
  });

  it("parses contact", () => {
    expect(parseToken("contact")).toMatchObject({ kind: "contact", arg: undefined });
  });

  it("parses contact:personne", () => {
    expect(parseToken("contact:personne")).toMatchObject({ kind: "contact", arg: "personne" });
  });

  it("parses title", () => {
    expect(parseToken("title")).toMatchObject({ kind: "title" });
  });

  it("parses vault.name", () => {
    expect(parseToken("vault.name")).toMatchObject({ kind: "vault", arg: "vault.name" });
  });

  it("parses vault.path", () => {
    expect(parseToken("vault.path")).toMatchObject({ kind: "vault", arg: "vault.path" });
  });

  it("parses user", () => {
    expect(parseToken("user")).toMatchObject({ kind: "user", arg: "user" });
  });

  it("parses user.email", () => {
    expect(parseToken("user.email")).toMatchObject({ kind: "user", arg: "user.email" });
  });

  it("parses random", () => {
    expect(parseToken("random")).toMatchObject({ kind: "random" });
  });

  it("parses ulid", () => {
    expect(parseToken("ulid")).toMatchObject({ kind: "ulid" });
  });

  it("parses counter:scope", () => {
    expect(parseToken("counter:vault")).toMatchObject({ kind: "counter", arg: "vault" });
  });

  it("parses js:expression", () => {
    expect(parseToken("js:1+1")).toMatchObject({ kind: "js", arg: "1+1" });
  });

  it("parses template:name", () => {
    expect(parseToken("template:header")).toMatchObject({ kind: "template", arg: "header" });
  });

  it("returns null for unknown token", () => {
    expect(parseToken("unknown_token")).toBeNull();
  });
});

describe("parseVariables", () => {
  it("extracts multiple variables", () => {
    const body = "Hello {{date}} at {{time}}";
    const vars = parseVariables(body);
    expect(vars).toHaveLength(2);
    expect(vars[0]?.kind).toBe("date");
    expect(vars[1]?.kind).toBe("time");
  });

  it("deduplicates identical variables", () => {
    const body = "{{date}} and {{date}}";
    expect(parseVariables(body)).toHaveLength(1);
  });

  it("handles body with no variables", () => {
    expect(parseVariables("plain text")).toHaveLength(0);
  });

  it("ignores unknown tokens in parse list", () => {
    const body = "{{date}} {{unknown_var}}";
    const vars = parseVariables(body);
    expect(vars).toHaveLength(1);
    expect(vars[0]?.kind).toBe("date");
  });
});

describe("findAllTokens", () => {
  it("finds all occurrences including duplicates", () => {
    const body = "{{date}} text {{date}} {{time}}";
    const tokens = findAllTokens(body);
    expect(tokens).toHaveLength(3);
  });
});
