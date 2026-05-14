// ============================================================
// Comprehensive tests for @supernote/formulas
// ============================================================

import { describe, it, expect, vi } from "vitest";
import { parseFormula } from "./parser.js";
import { evaluate } from "./evaluator.js";
import { formulaDependencies } from "./dependencies.js";
import { formatError } from "./errors.js";
import type { FormulaContext, Value, Scope } from "./value.js";
import type { Entity, RelationEdge } from "@supernote/core/types";

// ------ Helpers ----------------------------------------------

function parse(src: string) {
  return parseFormula(src);
}

function evalSrc(src: string, ctx?: Partial<FormulaContext>, scope?: Scope): Value {
  const p = parse(src);
  if (!p.ok) throw new Error(formatError(p.error));
  const result = evaluate(p.value, makeCtx(ctx), scope);
  if (!result.ok) throw new Error(formatError(result.error));
  return result.value;
}

function evalErr(src: string, ctx?: Partial<FormulaContext>, scope?: Scope): string {
  const p = parse(src);
  if (!p.ok) return formatError(p.error);
  const result = evaluate(p.value, makeCtx(ctx), scope);
  if (!result.ok) return formatError(result.error);
  throw new Error(`Expected error but got: ${String(result.value)}`);
}

const FIXED_NOW = new Date("2026-05-07T12:00:00.000Z");

function makeCtx(overrides: Partial<FormulaContext> = {}): FormulaContext {
  return {
    resolveEntity: () => null,
    queryEntities: () => [],
    getRelations: () => [],
    now: () => FIXED_NOW,
    resolveVariable: () => null,
    ...overrides,
  };
}

function mustParse(src: string) {
  const r = parse(src);
  if (!r.ok) throw new Error(formatError(r.error));
  return r.value;
}

function makeEntity(id: string, fields: Record<string, unknown> = {}): Entity {
  return {
    id,
    typeId: "test",
    filePath: `/${id}.md`,
    fields: fields as Entity["fields"],
    body: "",
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

// ============================================================
// 1. PARSING — LITERALS
// ============================================================

describe("Parser — literals", () => {
  it("parses integer", () => {
    const r = parse("42");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("NumberLiteral");
  });

  it("parses float", () => {
    const r = parse("3.14");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.value as { value: number }).value).toBeCloseTo(3.14);
  });

  it("parses double-quoted string", () => {
    const r = parse('"hello world"');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.value as { value: string }).value).toBe("hello world");
  });

  it("parses single-quoted string", () => {
    const r = parse("'hello'");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.value as { value: string }).value).toBe("hello");
  });

  it("parses string with escape sequences", () => {
    expect(evalSrc('"line1\\nline2"')).toBe("line1\nline2");
  });

  it("parses true", () => {
    const r = parse("true");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("BoolLiteral");
    expect((r.value as { value: boolean }).value).toBe(true);
  });

  it("parses false", () => {
    expect(evalSrc("false")).toBe(false);
  });

  it("parses null", () => {
    expect(evalSrc("null")).toBe(null);
  });
});

// ============================================================
// 2. PARSING — OPERATORS & EXPRESSIONS
// ============================================================

describe("Parser — operators", () => {
  it("parses binary + expression", () => {
    const r = parse("1 + 2");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("BinaryOp");
  });

  it("parses comparison ==", () => {
    const r = parse("x == y");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("BinaryOp");
  });

  it("parses logical 'and' and 'or'", () => {
    const r = parse("true and false or true");
    expect(r.ok).toBe(true);
  });

  it("parses 'not' unary", () => {
    const r = parse("not true");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("UnaryOp");
  });

  it("parses unary minus", () => {
    const r = parse("-5");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("UnaryOp");
  });

  it("respects operator precedence (* over +)", () => {
    // 2 + 3 * 4 = 14
    expect(evalSrc("2 + 3 * 4")).toBe(14);
  });

  it("respects grouping with parentheses", () => {
    expect(evalSrc("(2 + 3) * 4")).toBe(20);
  });
});

// ============================================================
// 3. PARSING — COMPLEX STRUCTURES
// ============================================================

describe("Parser — complex structures", () => {
  it("parses property access chain", () => {
    const r = parse("entity.relation.fieldName");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("PropertyAccess");
  });

  it("parses function call with args", () => {
    const r = parse("Sum(1, 2, 3)");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("FunctionCall");
    expect((r.value as { name: string }).name).toBe("Sum");
  });

  it("parses lambda with single param", () => {
    const r = parse("x -> x * 2");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("Lambda");
  });

  it("parses lambda with multiple params", () => {
    const r = parse("(a, b) -> a + b");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("Lambda");
    expect((r.value as { params: string[] }).params).toEqual(["a", "b"]);
  });

  it("parses lambda inside function call", () => {
    const r = parse("Map(items, x -> x.amount)");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("FunctionCall");
  });

  it("parses list literal", () => {
    const r = parse("[1, 2, 3]");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("ListLiteral");
    expect((r.value as { elements: unknown[] }).elements).toHaveLength(3);
  });

  it("parses entity ref @EntityName", () => {
    const r = parse("@MyProject");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("EntityRef");
    expect((r.value as { ref: string }).ref).toBe("MyProject");
  });

  it("parses wikilink [[Note Title]]", () => {
    const r = parse("[[My Note]]");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("WikiLink");
    expect((r.value as { title: string }).title).toBe("My Note");
  });
});

// ============================================================
// 4. PARSING — ERROR CASES
// ============================================================

describe("Parser — error cases", () => {
  it("reports position on unexpected character", () => {
    const r = parse("1 $ 2");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.position.col).toBeGreaterThan(0);
    expect(r.error.message).toMatch(/\$/);
  });

  it("reports error on unterminated string", () => {
    const r = parse('"unterminated');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/Unterminated/i);
  });

  it("reports error on missing closing paren", () => {
    const r = parse("Sum(1, 2");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/'\)'/);
  });

  it("reports error on missing closing bracket", () => {
    const r = parse("[1, 2, 3");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toMatch(/']'/);
  });

  it("reports error on empty input trailing tokens", () => {
    const r = parse("1 2");
    expect(r.ok).toBe(false);
  });

  it("formatError includes line:col", () => {
    const r = parse("1 $ 2");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msg = formatError(r.error);
    expect(msg).toMatch(/ParseError/);
    expect(msg).toMatch(/\d+:\d+/);
  });
});

// ============================================================
// 5. EVALUATION — ARITHMETIC
// ============================================================

describe("Evaluator — arithmetic", () => {
  it("adds two numbers", () => {
    expect(evalSrc("10 + 5")).toBe(15);
  });

  it("subtracts", () => {
    expect(evalSrc("10 - 3")).toBe(7);
  });

  it("multiplies", () => {
    expect(evalSrc("4 * 5")).toBe(20);
  });

  it("divides", () => {
    expect(evalSrc("10 / 4")).toBe(2.5);
  });

  it("modulo", () => {
    expect(evalSrc("10 % 3")).toBe(1);
  });

  it("raises error on division by zero", () => {
    expect(evalErr("10 / 0")).toMatch(/zero/i);
  });

  it("string concatenation with +", () => {
    expect(evalSrc('"hello" + " " + "world"')).toBe("hello world");
  });

  it("propagates null through arithmetic", () => {
    expect(evalSrc("null + 5")).toBe(null);
  });

  it("negates a number", () => {
    expect(evalSrc("-7")).toBe(-7);
  });
});

// ============================================================
// 6. EVALUATION — COMPARISON & LOGIC
// ============================================================

describe("Evaluator — comparison and logic", () => {
  it("evaluates == true", () => {
    expect(evalSrc("5 == 5")).toBe(true);
  });

  it("evaluates != true", () => {
    expect(evalSrc("5 != 6")).toBe(true);
  });

  it("evaluates < correctly", () => {
    expect(evalSrc("3 < 5")).toBe(true);
    expect(evalSrc("5 < 3")).toBe(false);
  });

  it("evaluates >= correctly", () => {
    expect(evalSrc("5 >= 5")).toBe(true);
  });

  it("evaluates 'and'", () => {
    expect(evalSrc("true and false")).toBe(false);
    expect(evalSrc("true and true")).toBe(true);
  });

  it("evaluates 'or'", () => {
    expect(evalSrc("false or true")).toBe(true);
  });

  it("evaluates 'not'", () => {
    expect(evalSrc("not false")).toBe(true);
    expect(evalSrc("not true")).toBe(false);
  });
});

// ============================================================
// 7. EVALUATION — STDLIB MATH
// ============================================================

describe("Evaluator — stdlib Math", () => {
  it("Sum of list", () => {
    expect(evalSrc("Sum([1, 2, 3, 4])")).toBe(10);
  });

  it("Sum of spread args", () => {
    expect(evalSrc("Sum(1, 2, 3)")).toBe(6);
  });

  it("Average", () => {
    expect(evalSrc("Average([2, 4, 6])")).toBe(4);
  });

  it("Min and Max", () => {
    expect(evalSrc("Min([3, 1, 4, 1, 5])")).toBe(1);
    expect(evalSrc("Max([3, 1, 4, 1, 5])")).toBe(5);
  });

  it("Count of list", () => {
    expect(evalSrc("Count([1, 2, 3])")).toBe(3);
  });

  it("Abs", () => {
    expect(evalSrc("Abs(-5)")).toBe(5);
    expect(evalSrc("Abs(5)")).toBe(5);
  });

  it("Round with decimals", () => {
    expect(evalSrc("Round(3.456, 2)")).toBe(3.46);
  });

  it("Ceil and Floor", () => {
    expect(evalSrc("Ceil(3.2)")).toBe(4);
    expect(evalSrc("Floor(3.9)")).toBe(3);
  });

  it("Pow", () => {
    expect(evalSrc("Pow(2, 10)")).toBe(1024);
  });

  it("Sqrt", () => {
    expect(evalSrc("Sqrt(9)")).toBe(3);
  });

  it("Mod always non-negative", () => {
    expect(evalSrc("Mod(10, 3)")).toBe(1);
    expect(evalSrc("Mod(-1, 3)")).toBe(2);
  });

  it("raises error on Sqrt of negative", () => {
    expect(evalErr("Sqrt(-1)")).toMatch(/negative/i);
  });
});

// ============================================================
// 8. EVALUATION — STDLIB DATES
// ============================================================

describe("Evaluator — stdlib Dates", () => {
  it("Now() returns the context time", () => {
    const result = evalSrc("Now()");
    expect(result instanceof Date).toBe(true);
    expect((result as Date).toISOString()).toBe("2026-05-07T12:00:00.000Z");
  });

  it("Today() returns date with time zeroed", () => {
    const result = evalSrc("Today()");
    expect(result instanceof Date).toBe(true);
    const d = result as Date;
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it("Year, Month, Day extraction", () => {
    expect(evalSrc("Year(Now())")).toBe(2026);
    expect(evalSrc("Month(Now())")).toBe(5);
    expect(evalSrc("Day(Now())")).toBe(7);
  });

  it("Format date", () => {
    expect(evalSrc('Format(Now(), "YYYY-MM-DD")')).toBe("2026-05-07");
  });

  it("DateAdd days", () => {
    const r = evalSrc('DateAdd(Now(), 7, "day")');
    expect(r instanceof Date).toBe(true);
    expect((r as Date).getDate()).toBe(14);
  });

  it("DateDiff in days", () => {
    const r = evalSrc('DateDiff(ParseDate("2026-05-14"), ParseDate("2026-05-07"), "day")');
    expect(r).toBe(7);
  });

  it("ParseDate", () => {
    const r = evalSrc('ParseDate("2026-01-01")');
    expect(r instanceof Date).toBe(true);
    expect((r as Date).getFullYear()).toBe(2026);
  });
});

// ============================================================
// 9. EVALUATION — STDLIB STRINGS
// ============================================================

describe("Evaluator — stdlib Strings", () => {
  it("Concat strings", () => {
    expect(evalSrc('Concat("hello", " ", "world")')).toBe("hello world");
  });

  it("Length", () => {
    expect(evalSrc('Length("hello")')).toBe(5);
  });

  it("Upper and Lower", () => {
    expect(evalSrc('Upper("hello")')).toBe("HELLO");
    expect(evalSrc('Lower("WORLD")')).toBe("world");
  });

  it("Trim", () => {
    expect(evalSrc('Trim("  hello  ")')).toBe("hello");
  });

  it("Split", () => {
    expect(evalSrc('Split("a,b,c", ",")')).toEqual(["a", "b", "c"]);
  });

  it("Replace", () => {
    expect(evalSrc('Replace("hello world", "world", "there")')).toBe("hello there");
  });

  it("Contains", () => {
    expect(evalSrc('Contains("hello world", "world")')).toBe(true);
    expect(evalSrc('Contains("hello", "xyz")')).toBe(false);
  });

  it("StartsWith / EndsWith", () => {
    expect(evalSrc('StartsWith("hello", "hel")')).toBe(true);
    expect(evalSrc('EndsWith("hello", "llo")')).toBe(true);
  });

  it("Substring", () => {
    expect(evalSrc('Substring("hello world", 6)')).toBe("world");
    expect(evalSrc('Substring("hello world", 0, 5)')).toBe("hello");
  });

  it("RegexMatch", () => {
    expect(evalSrc('RegexMatch("abc123", "\\\\d+")')).toBe("123");
    expect(evalSrc('RegexMatch("abc", "\\\\d+")')).toBe(null);
  });

  it("Slugify", () => {
    expect(evalSrc('Slugify("Hello World!")')).toBe("hello-world");
  });
});

// ============================================================
// 10. EVALUATION — STDLIB LISTS
// ============================================================

describe("Evaluator — stdlib Lists", () => {
  it("Map applies lambda", () => {
    expect(evalSrc("Map([1, 2, 3], x -> x * 2)")).toEqual([2, 4, 6]);
  });

  it("Filter applies predicate", () => {
    expect(evalSrc("Filter([1, 2, 3, 4, 5], x -> x > 2)")).toEqual([3, 4, 5]);
  });

  it("Reduce sums a list", () => {
    expect(evalSrc("Reduce([1, 2, 3, 4], (acc, x) -> acc + x, 0)")).toBe(10);
  });

  it("Sort ascending", () => {
    expect(evalSrc("Sort([3, 1, 2])")).toEqual([1, 2, 3]);
  });

  it("Sort with key function", () => {
    // sort strings by length
    const result = evalSrc('Sort(["bb", "aaa", "c"], x -> Length(x))');
    expect(result).toEqual(["c", "bb", "aaa"]);
  });

  it("Reverse", () => {
    expect(evalSrc("Reverse([1, 2, 3])")).toEqual([3, 2, 1]);
  });

  it("Unique deduplies", () => {
    expect(evalSrc("Unique([1, 2, 2, 3, 1])")).toEqual([1, 2, 3]);
  });

  it("First and Last", () => {
    expect(evalSrc("First([10, 20, 30])")).toBe(10);
    expect(evalSrc("Last([10, 20, 30])")).toBe(30);
  });

  it("Nth", () => {
    expect(evalSrc("Nth([10, 20, 30], 1)")).toBe(20);
  });

  it("Take and Drop", () => {
    expect(evalSrc("Take([1, 2, 3, 4, 5], 3)")).toEqual([1, 2, 3]);
    expect(evalSrc("Drop([1, 2, 3, 4, 5], 2)")).toEqual([3, 4, 5]);
  });

  it("Join", () => {
    expect(evalSrc('Join(["a", "b", "c"], "-")')).toBe("a-b-c");
  });

  it("CountIf", () => {
    expect(evalSrc("CountIf([1, 2, 3, 4, 5], x -> x > 3)")).toBe(2);
  });
});

// ============================================================
// 11. EVALUATION — LOGIC FUNCTIONS
// ============================================================

describe("Evaluator — stdlib Logic", () => {
  it("If(true, a, b) returns a", () => {
    expect(evalSrc('If(true, "yes", "no")')).toBe("yes");
  });

  it("If(false, a, b) returns b", () => {
    expect(evalSrc('If(false, "yes", "no")')).toBe("no");
  });

  it("Switch matches first case", () => {
    expect(evalSrc('Switch("b", "a", 1, "b", 2, "c", 3)')).toBe(2);
  });

  it("Switch uses default when no match", () => {
    expect(evalSrc('Switch("z", "a", 1, "b", 2, 99)')).toBe(99);
  });
});

// ============================================================
// 12. EVALUATION — ENTITY REFS AND CONTEXT
// ============================================================

describe("Evaluator — entity refs and context", () => {
  it("resolves @EntityRef via context", () => {
    const entity = makeEntity("proj-1", { name: "My Project", status: "active" });
    const ctx = makeCtx({
      resolveEntity: (ref) => (ref === "MyProject" ? entity : null),
    });
    const r = evaluate(mustParse("@MyProject"), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ _type: "entity" });
  });

  it("accesses entity field via property access", () => {
    const entity = makeEntity("proj-1", { name: "My Project", status: "active" });
    const ctx = makeCtx({
      resolveEntity: (ref) => (ref === "MyProject" ? entity : null),
    });
    const result = evalSrc("@MyProject.name", ctx);
    expect(result).toBe("My Project");
  });

  it("returns null for unknown entity ref", () => {
    expect(evalSrc("@UnknownEntity")).toBe(null);
  });

  it("null propagates through property access on null entity", () => {
    expect(evalSrc("@Unknown.someField")).toBe(null);
  });

  it("resolves [[wikilink]] via context", () => {
    const entity = makeEntity("note-1", { name: "My Note" });
    const ctx = makeCtx({
      resolveEntity: (ref) => (ref === "My Note" ? entity : null),
    });
    const result = evalSrc("[[My Note]]", ctx);
    expect(result).toMatchObject({ _type: "entity" });
  });

  it("Filter with entity type queries context", () => {
    const entities = [
      makeEntity("e1", { name: "Alice", age: 30 }),
      makeEntity("e2", { name: "Bob", age: 20 }),
    ];
    const ctx = makeCtx({
      queryEntities: (typeId) => (typeId === "Person" ? entities : []),
    });
    const r = evalSrc('Filter("Person", x -> x.age > 25)', ctx);
    expect(Array.isArray(r)).toBe(true);
    expect((r as Value[]).length).toBe(1);
  });
});

// ============================================================
// 13. EVALUATION — LAMBDAS AND CLOSURES
// ============================================================

describe("Evaluator — lambdas and closures", () => {
  it("lambda captures outer scope variable", () => {
    const ast = parse("Map([1, 2, 3], x -> x + base)");
    if (!ast.ok) throw new Error(formatError(ast.error));
    const result = evaluate(ast.value, makeCtx(), { base: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([11, 12, 13]);
  });

  it("nested lambdas preserve closures", () => {
    // Reduce with nested accumulation
    expect(evalSrc("Reduce([1, 2, 3], (acc, x) -> acc + x, 0)")).toBe(6);
  });

  it("multi-param lambda works in Reduce", () => {
    expect(evalSrc("Reduce([1, 2, 3, 4, 5], (acc, n) -> acc + n, 0)")).toBe(15);
  });
});

// ============================================================
// 14. EDGE CASES
// ============================================================

describe("Edge cases", () => {
  it("empty list Sum is 0", () => {
    expect(evalSrc("Sum([])")).toBe(0);
  });

  it("First on empty list returns null", () => {
    expect(evalSrc("First([])")).toBe(null);
  });

  it("Map on empty list", () => {
    expect(evalSrc("Map([], x -> x * 2)")).toEqual([]);
  });

  it("null propagates in comparison returns null", () => {
    expect(evalSrc("null + null")).toBe(null);
  });

  it("unknown function raises EvalError", () => {
    expect(evalErr("UndefinedFunction(1)")).toMatch(/EvalError/);
  });

  it("division by zero raises EvalError", () => {
    expect(evalErr("1 / 0")).toMatch(/zero/i);
  });

  it("Sqrt of negative raises EvalError", () => {
    expect(evalErr("Sqrt(-4)")).toMatch(/negative/i);
  });

  it("boolean coercion: 0 is falsy", () => {
    expect(evalSrc('If(0, "yes", "no")')).toBe("no");
  });

  it("number-string coercion in +", () => {
    expect(evalSrc('"count: " + 42')).toBe("count: 42");
  });
});

// ============================================================
// 15. DEPENDENCY ANALYSIS
// ============================================================

describe("formulaDependencies", () => {
  it("extracts no deps from pure arithmetic", () => {
    expect(formulaDependencies(mustParse("1 + 2 * 3"))).toHaveLength(0);
  });

  it("extracts entity dep from @Ref", () => {
    const deps = formulaDependencies(mustParse("@MyProject.name"));
    expect(deps.some((d) => d.kind === "entity" && d.id === "MyProject")).toBe(true);
  });

  it("extracts entity dep from [[wikilink]]", () => {
    const deps = formulaDependencies(mustParse("[[My Note]]"));
    expect(deps.some((d) => d.kind === "entity" && d.id === "My Note")).toBe(true);
  });

  it("extracts time dep from Now()", () => {
    const deps = formulaDependencies(mustParse("Now()"));
    expect(deps.some((d) => d.kind === "time")).toBe(true);
  });

  it("extracts entityType dep from Filter('Type', ...)", () => {
    const deps = formulaDependencies(mustParse('Filter("Person", x -> x.age > 18)'));
    expect(deps.some((d) => d.kind === "entityType" && d.id === "Person")).toBe(true);
  });

  it("deduplicates deps", () => {
    const deps = formulaDependencies(mustParse("@A.name == @A.id"));
    const entityDeps = deps.filter((d) => d.kind === "entity" && d.id === "A");
    expect(entityDeps).toHaveLength(1);
  });
});

// ============================================================
// Coda parity — added stdlib & syntax
// ============================================================

describe("Coda syntax — operators", () => {
  it("bare = is equality", () => {
    expect(evalSrc("1 = 1")).toBe(true);
    expect(evalSrc("1 = 2")).toBe(false);
  });
  it("<> is not-equal", () => {
    expect(evalSrc("1 <> 2")).toBe(true);
    expect(evalSrc("1 <> 1")).toBe(false);
  });
  it("&& and ||", () => {
    expect(evalSrc("true && false")).toBe(false);
    expect(evalSrc("true || false")).toBe(true);
  });
  it("case-insensitive AND/OR/NOT/TRUE", () => {
    expect(evalSrc("TRUE AND FALSE")).toBe(false);
    expect(evalSrc("TRUE OR FALSE")).toBe(true);
    expect(evalSrc("NOT FALSE")).toBe(true);
  });
});

describe("Coda chaining", () => {
  it("desugars x.Fn(args) to Fn(x, args)", () => {
    expect(evalSrc('"hello".Upper()')).toBe("HELLO");
    expect(evalSrc('[1, 2, 3].Sum()')).toBe(6);
    expect(evalSrc('[3, 1, 2].Sort().First()')).toBe(1);
  });
});

describe("Coda stdlib — strings", () => {
  it("Concatenate", () => {
    expect(evalSrc('Concatenate("a", "b", "c")')).toBe("abc");
  });
  it("Format text template", () => {
    expect(evalSrc('Format("Hi {1}, {2}!", "Bob", "rainy")')).toBe("Hi Bob, rainy!");
  });
  it("Left / Right / Middle", () => {
    expect(evalSrc('Left("abcdef", 3)')).toBe("abc");
    expect(evalSrc('Right("abcdef", 2)')).toBe("ef");
    expect(evalSrc('Middle("abcdef", 2, 3)')).toBe("bcd");
  });
  it("Find returns 1-based index, 0 if missing", () => {
    expect(evalSrc('Find("abcdef", "cd")')).toBe(3);
    expect(evalSrc('Find("abcdef", "zz")')).toBe(0);
  });
  it("Proper", () => {
    expect(evalSrc('Proper("hello world")')).toBe("Hello World");
  });
  it("RepeatString", () => {
    expect(evalSrc('RepeatString("ab", 3)')).toBe("ababab");
  });
});

describe("Coda stdlib — math", () => {
  it("RoundUp / RoundDown / Int / Sign", () => {
    expect(evalSrc("RoundUp(1.2)")).toBe(2);
    expect(evalSrc("RoundDown(1.8)")).toBe(1);
    expect(evalSrc("Int(-1.7)")).toBe(-1);
    expect(evalSrc("Sign(-3)")).toBe(-1);
    expect(evalSrc("Sign(0)")).toBe(0);
  });
  it("Log / Ln / Exp", () => {
    expect(evalSrc("Log(100)")).toBeCloseTo(2);
    expect(evalSrc("Ln(1)")).toBe(0);
    expect(evalSrc("Exp(0)")).toBe(1);
  });
  it("Sequence", () => {
    expect(evalSrc("Sequence(1, 4)")).toEqual([1, 2, 3, 4]);
    expect(evalSrc("Sequence(1, 10, 3)")).toEqual([1, 4, 7, 10]);
  });
  it("Median", () => {
    expect(evalSrc("Median([1, 2, 3, 4])")).toBe(2.5);
    expect(evalSrc("Median([5, 1, 3])")).toBe(3);
  });
});

describe("Coda stdlib — logic", () => {
  it("IsBlank / IsNotBlank / IfBlank", () => {
    expect(evalSrc('IsBlank("")')).toBe(true);
    expect(evalSrc('IsBlank("x")')).toBe(false);
    expect(evalSrc("IsBlank(null)")).toBe(true);
    expect(evalSrc("IsBlank([])")).toBe(true);
    expect(evalSrc('IsNotBlank("x")')).toBe(true);
    expect(evalSrc('IfBlank("", "fallback")')).toBe("fallback");
    expect(evalSrc('IfBlank("v", "fallback")')).toBe("v");
  });
  it("SwitchIf", () => {
    expect(evalSrc('SwitchIf(false, "a", true, "b", "default")')).toBe("b");
    expect(evalSrc('SwitchIf(false, "a", false, "b", "default")')).toBe("default");
  });
  it("type predicates", () => {
    expect(evalSrc("IsNumber(1)")).toBe(true);
    expect(evalSrc('IsText("hi")')).toBe(true);
    expect(evalSrc("IsList([1])")).toBe(true);
    expect(evalSrc("IsBoolean(true)")).toBe(true);
  });
});

describe("Coda stdlib — dates", () => {
  it("Date(y, m, d) builds a date", () => {
    const v = evalSrc("Date(2026, 5, 14)");
    expect(v instanceof Date).toBe(true);
    expect((v as Date).getFullYear()).toBe(2026);
    expect((v as Date).getMonth()).toBe(4);
    expect((v as Date).getDate()).toBe(14);
  });
  it("Weekday / WeekdayName / MonthName / Quarter", () => {
    const ctx: Partial<FormulaContext> = { now: () => new Date("2026-05-14T12:00:00Z") };
    expect(typeof evalSrc("Weekday(Now())", ctx)).toBe("number");
    expect(typeof evalSrc("WeekdayName(Now())", ctx)).toBe("string");
    expect(typeof evalSrc("MonthName(Now())", ctx)).toBe("string");
    expect(evalSrc("Quarter(Date(2026, 5, 14))")).toBe(2);
  });
});

describe("Coda stdlib — lists", () => {
  it("Contains polymorphic", () => {
    expect(evalSrc('Contains("hello", "ell")')).toBe(true);
    expect(evalSrc('Contains([1, 2, 3], 2)')).toBe(true);
    expect(evalSrc('Contains([1, 2, 3], 9)')).toBe(false);
  });
  it("In", () => {
    expect(evalSrc('In("b", ["a", "b", "c"])')).toBe(true);
    expect(evalSrc('In("z", ["a", "b"])')).toBe(false);
  });
  it("Slice", () => {
    expect(evalSrc('Slice([10, 20, 30, 40], 1, 3)')).toEqual([20, 30]);
  });
});

// ============================================================
// lexer $variable
// ============================================================

import { tokenize } from './lexer.js';

describe('lexer $variable', () => {
  it('emits Identifier "$name" for $tauxTVA', () => {
    const res = tokenize('$tauxTVA + 1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const tokens = res.value;
    expect(tokens[0]).toMatchObject({ kind: 'Identifier', raw: '$tauxTVA' });
  });

  it('rejects bare $ with no name', () => {
    const res = tokenize('$ + 1');
    expect(res.ok).toBe(false);
  });

  it('does not consume $ inside string literal', () => {
    const res = tokenize('"$nope"');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value[0]?.kind).toBe('String');
  });
});

// ============================================================
// where(currentValue) + list aggregat properties + entity projection
// ============================================================

describe("Coda — list aggregates as properties", () => {
  it(".count / .length / .sum / .avg / .min / .max", () => {
    expect(evalSrc("[1, 2, 3, 4].count")).toBe(4);
    expect(evalSrc("[1, 2, 3, 4].length")).toBe(4);
    expect(evalSrc("[1, 2, 3, 4].sum")).toBe(10);
    expect(evalSrc("[1, 2, 3, 4].avg")).toBe(2.5);
    expect(evalSrc("[1, 2, 3, 4].min")).toBe(1);
    expect(evalSrc("[1, 2, 3, 4].max")).toBe(4);
    expect(evalSrc("[3, 1, 2].first")).toBe(3);
    expect(evalSrc("[3, 1, 2].last")).toBe(2);
  });
});

describe("Coda — where with implicit currentValue", () => {
  it("list.where(predicate)", () => {
    expect(evalSrc("[1, 2, 3, 4, 5].where(currentValue > 2)")).toEqual([3, 4, 5]);
    expect(evalSrc("[1, 2, 3, 4, 5].where(currentValue > 2).count")).toBe(3);
  });
  it("Where(list, predicate) function form", () => {
    expect(evalSrc("Where([1, 2, 3, 4, 5], currentValue >= 4)")).toEqual([4, 5]);
  });
  it("explicit lambda still works", () => {
    expect(evalSrc("[1, 2, 3].where(x -> x > 1)")).toEqual([2, 3]);
  });
});

// ============================================================
// parser $variable
// ============================================================

describe('parser $variable', () => {
  it('parses $tauxTVA as VariableRef', () => {
    const res = parseFormula('$tauxTVA');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toMatchObject({ kind: 'VariableRef', name: 'tauxTVA' });
  });

  it('uses $variable in arithmetic', () => {
    const res = parseFormula('$a + $b * 2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ast = res.value as any;
    expect(ast.kind).toBe('BinaryOp');
    expect(ast.left).toMatchObject({ kind: 'VariableRef', name: 'a' });
  });
});

// ============================================================
// evaluator $variable
// ============================================================

describe('evaluator $variable', () => {
  function mkVarCtx(vars: Record<string, unknown>): FormulaContext {
    return {
      resolveEntity: () => null,
      queryEntities: () => [],
      getRelations: () => [],
      now: () => new Date('2026-01-01T00:00:00Z'),
      resolveVariable: (name) => (name in vars ? (vars[name] as Value) : null),
    };
  }

  it('resolves $name via context', () => {
    const ast = (parseFormula('$x + 1') as any).value;
    const res = evaluate(ast, mkVarCtx({ x: 41 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toBe(42);
  });

  it('errors on unknown variable', () => {
    const ast = (parseFormula('$missing') as any).value;
    const res = evaluate(ast, mkVarCtx({}));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toMatch(/unknown variable.*missing/i);
  });

  it('tracks variable dependency', () => {
    const ast = (parseFormula('$x') as any).value;
    const deps: any[] = [];
    const ctx = mkVarCtx({ x: 1 });
    const res = evaluate(ast, ctx, {}, { onDependency: (d: any) => deps.push(d) });
    expect(res.ok).toBe(true);
    expect(deps).toContainEqual({ kind: 'variable', id: 'x' });
  });
});

describe("Coda — entity projection from lists", () => {
  // Build a synthetic list of entity values via a Filter context
  const contacts: Entity[] = [
    { id: "a", typeId: "Contact", filePath: "", body: "", createdAt: new Date(), updatedAt: new Date(), fields: { age: 20, name: "Alice" } },
    { id: "b", typeId: "Contact", filePath: "", body: "", createdAt: new Date(), updatedAt: new Date(), fields: { age: 30, name: "Bob" } },
    { id: "c", typeId: "Contact", filePath: "", body: "", createdAt: new Date(), updatedAt: new Date(), fields: { age: 30, name: "Carol" } },
  ];
  const scope: Scope = {
    Contacts: contacts.map((e) => ({ _type: "entity", entity: e })),
    thisRow: { _type: "entity", entity: { id: "_", typeId: "X", filePath: "", body: "", createdAt: new Date(), updatedAt: new Date(), fields: { age: 30 } } },
  };
  it("base.age → list of ages", () => {
    expect(evalSrc("Contacts.age", undefined, scope)).toEqual([20, 30, 30]);
  });
  it("Contacts.where(currentValue.age == thisRow.age).count", () => {
    expect(evalSrc("Contacts.where(currentValue.age == thisRow.age).count", undefined, scope)).toBe(2);
  });
  it("aggregation pipeline: ages of matches summed", () => {
    expect(evalSrc("Contacts.where(currentValue.age >= 25).age.sum", undefined, scope)).toBe(60);
  });
});
