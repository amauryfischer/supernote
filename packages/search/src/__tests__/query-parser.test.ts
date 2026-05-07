import { describe, it, expect } from "vitest";
import { parseQuery } from "../query/parser.js";
import { compileToFtsAndPredicates } from "../query/compiler.js";
import { tokenize } from "../query/tokenizer.js";
import { isOk, isErr } from "@supernote/core";

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

describe("tokenize", () => {
  it("parses plain words", () => {
    const tokens = tokenize("hello world");
    expect(tokens).toHaveLength(2);
    expect(tokens[0]?.kind).toBe("WORD");
    expect(tokens[0]?.value).toBe("hello");
  });

  it("parses quoted phrases", () => {
    const tokens = tokenize('"exact phrase"');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.kind).toBe("PHRASE");
    expect(tokens[0]?.value).toBe("exact phrase");
  });

  it("parses excluded terms", () => {
    const tokens = tokenize("-spam");
    expect(tokens[0]?.kind).toBe("EXCLUDE");
    expect(tokens[0]?.value).toBe("spam");
  });

  it("parses filter with = op", () => {
    const tokens = tokenize("type:personne");
    expect(tokens[0]?.kind).toBe("FILTER");
    expect(tokens[0]?.filterKey).toBe("type");
    expect(tokens[0]?.filterValue).toBe("personne");
    expect(tokens[0]?.filterOp).toBe("=");
  });

  it("parses filter with > op", () => {
    const tokens = tokenize("created:>2026-01-01");
    expect(tokens[0]?.filterOp).toBe(">");
    expect(tokens[0]?.filterValue).toBe("2026-01-01");
  });

  it("parses filter with >= op", () => {
    const tokens = tokenize("modified:>=2026-05-01");
    expect(tokens[0]?.filterOp).toBe(">=");
  });

  it("parses boolean AND keyword", () => {
    const tokens = tokenize("foo AND bar");
    expect(tokens[1]?.kind).toBe("BOOL_AND");
  });

  it("parses boolean OR keyword", () => {
    const tokens = tokenize("foo OR bar");
    expect(tokens[1]?.kind).toBe("BOOL_OR");
  });

  it("parses boolean NOT keyword", () => {
    const tokens = tokenize("NOT spam");
    expect(tokens[0]?.kind).toBe("BOOL_NOT");
  });
});

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

describe("parseQuery", () => {
  it("returns Err for empty input", () => {
    const result = parseQuery("");
    expect(isErr(result)).toBe(true);
    if (!result.ok) expect(result.error.code).toBe("EMPTY_QUERY");
  });

  it("returns Err for whitespace-only input", () => {
    const result = parseQuery("   ");
    expect(isErr(result)).toBe(true);
  });

  it("parses single word to freeText", () => {
    const result = parseQuery("client");
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value.freeText).toEqual(["client"]);
      expect(result.value.filters).toHaveLength(0);
    }
  });

  it("parses multiple words", () => {
    const result = parseQuery("hello world foo");
    expect(isOk(result)).toBe(true);
    if (result.ok) expect(result.value.freeText).toHaveLength(3);
  });

  it("parses quoted phrase", () => {
    const result = parseQuery('"exact phrase"');
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value.phrases).toEqual(["exact phrase"]);
      expect(result.value.freeText).toHaveLength(0);
    }
  });

  it("parses excluded term", () => {
    const result = parseQuery("hello -spam");
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value.excluded).toEqual(["spam"]);
      expect(result.value.freeText).toEqual(["hello"]);
    }
  });

  it("parses type: filter", () => {
    const result = parseQuery("type:personne");
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value.filters).toHaveLength(1);
      expect(result.value.filters[0]?.key).toBe("type");
      expect(result.value.filters[0]?.value).toBe("personne");
      expect(result.value.filters[0]?.op).toBe("=");
    }
  });

  it("parses modified: filter with > op", () => {
    const result = parseQuery("modified:>2026-01-01");
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value.filters[0]?.key).toBe("modified");
      expect(result.value.filters[0]?.op).toBe(">");
      expect(result.value.filters[0]?.value).toBe("2026-01-01");
    }
  });

  it("parses tag: filter", () => {
    const result = parseQuery("tag:vip");
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value.filters[0]?.key).toBe("tag");
      expect(result.value.filters[0]?.value).toBe("vip");
    }
  });

  it("rejects unknown filter key", () => {
    const result = parseQuery("unknown:value");
    expect(isErr(result)).toBe(true);
    if (!result.ok) expect(result.error.code).toBe("INVALID_FILTER");
  });

  it("parses complex query: words + filters + phrase + exclude", () => {
    const result = parseQuery('client modified:>2026-01-01 type:personne tag:vip "exact phrase" -spam');
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      const { freeText, filters, phrases, excluded } = result.value;
      expect(freeText).toContain("client");
      expect(phrases).toContain("exact phrase");
      expect(excluded).toContain("spam");
      expect(filters).toHaveLength(3);
    }
  });

  it("parses boolean AND tree", () => {
    const result = parseQuery("foo AND bar");
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      const bool = result.value.bool;
      expect(bool?.kind).toBe("AND");
    }
  });

  it("parses boolean OR tree", () => {
    const result = parseQuery("foo OR bar");
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value.bool?.kind).toBe("OR");
    }
  });

  it("parses NOT operator", () => {
    const result = parseQuery("NOT spam");
    expect(isOk(result)).toBe(true);
    if (result.ok) {
      expect(result.value.bool?.kind).toBe("NOT");
    }
  });

  it("bool is null when no boolean operators", () => {
    const result = parseQuery("hello world");
    expect(isOk(result)).toBe(true);
    if (result.ok) expect(result.value.bool).toBeNull();
  });

  it("parses all valid filter keys without error", () => {
    const keys = ["path", "type", "tag", "field", "created", "modified", "relation", "in"];
    for (const key of keys) {
      const result = parseQuery(`${key}:somevalue`);
      expect(isOk(result)).toBe(true);
    }
  });

  it("handles path: filter", () => {
    const result = parseQuery("path:/contacts");
    expect(isOk(result)).toBe(true);
    if (result.ok) expect(result.value.filters[0]?.key).toBe("path");
  });
});

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

describe("compileToFtsAndPredicates", () => {
  it("compiles free text to FTS expression", () => {
    const result = parseQuery("hello world");
    if (!result.ok) throw new Error("parse failed");
    const compiled = compileToFtsAndPredicates(result.value);
    expect(compiled.ftsExpr).toContain("hello");
    expect(compiled.ftsExpr).toContain("world");
  });

  it("compiles phrase to quoted FTS expression", () => {
    const result = parseQuery('"exact phrase"');
    if (!result.ok) throw new Error("parse failed");
    const compiled = compileToFtsAndPredicates(result.value);
    expect(compiled.ftsExpr).toContain("exact phrase");
  });

  it("compiles excluded term with NOT", () => {
    const result = parseQuery("hello -spam");
    if (!result.ok) throw new Error("parse failed");
    const compiled = compileToFtsAndPredicates(result.value);
    expect(compiled.ftsExpr).toContain("NOT");
    expect(compiled.ftsExpr).toContain("spam");
  });

  it("compiles type filter to SQL predicate", () => {
    const result = parseQuery("type:personne");
    if (!result.ok) throw new Error("parse failed");
    const compiled = compileToFtsAndPredicates(result.value);
    expect(compiled.sqlPredicates).toHaveLength(1);
    const typePred = compiled.sqlPredicates.find((p) => p.sql.includes("typeId"));
    expect(typePred).toBeDefined();
    expect(typePred?.params).toContain("personne");
  });

  it("compiles created: filter with > to SQL", () => {
    const result = parseQuery("created:>2026-01-01");
    if (!result.ok) throw new Error("parse failed");
    const compiled = compileToFtsAndPredicates(result.value);
    const pred = compiled.sqlPredicates[0];
    expect(pred?.sql).toContain("createdAt");
    expect(pred?.sql).toContain(">");
  });

  it("returns empty sqlPredicates when only free text", () => {
    const result = parseQuery("hello");
    if (!result.ok) throw new Error("parse failed");
    const compiled = compileToFtsAndPredicates(result.value);
    expect(compiled.sqlPredicates).toHaveLength(0);
  });
});
