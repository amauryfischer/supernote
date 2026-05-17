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

// ============================================================
// BLOC 1 — Date sugar + duration + predicates
// ============================================================

describe("Bloc 1 — date constructors (Start*/End*)", () => {
  it("StartOfDay / EndOfDay", () => {
    const start = evalSrc("StartOfDay(Today())");
    expect(start instanceof Date).toBe(true);
    expect((start as Date).getHours()).toBe(0);
    const end = evalSrc("EndOfDay(Today())");
    expect((end as Date).getHours()).toBe(23);
    expect((end as Date).getSeconds()).toBe(59);
  });

  it("StartOfYear / EndOfYear", () => {
    const s = evalSrc("StartOfYear(Date(2026, 5, 14))") as Date;
    expect(s.getMonth()).toBe(0); expect(s.getDate()).toBe(1);
    const e = evalSrc("EndOfYear(Date(2026, 5, 14))") as Date;
    expect(e.getMonth()).toBe(11); expect(e.getDate()).toBe(31);
  });

  it("DateOnly strips time", () => {
    const d = evalSrc("DateOnly(Now())") as Date;
    expect(d.getHours()).toBe(0);
  });

  it("StartOfWeek / EndOfWeek (Mon default)", () => {
    // 2026-05-07 is a Thursday (day=4)
    const sow = evalSrc("StartOfWeek(Now())") as Date;
    expect(sow.getDay()).toBe(1); // Monday
    const eow = evalSrc("EndOfWeek(Now())") as Date;
    expect(eow.getDay()).toBe(0); // Sunday (next)
  });
});

describe("Bloc 1 — duration arithmetic", () => {
  it("Date + Days(7) adds 7 days", () => {
    const r = evalSrc("Date(2026, 5, 1) + Days(7)") as Date;
    expect(r.getDate()).toBe(8);
    expect(r.getMonth()).toBe(4); // May
  });

  it("Date + Months(1) adds 1 month", () => {
    const r = evalSrc("Date(2026, 1, 31) + Months(1)") as Date;
    // JS Date: 2026-02-31 → 2026-03-03 (overflow)
    expect(r instanceof Date).toBe(true);
  });

  it("Date + Hours(2) adds 2 hours", () => {
    const r = evalSrc("Date(2026, 5, 1) + Hours(2)") as Date;
    expect(r.getHours()).toBe(2);
  });

  it("Date - Days(3) subtracts 3 days", () => {
    const r = evalSrc("Date(2026, 5, 10) - Days(3)") as Date;
    expect(r.getDate()).toBe(7);
  });

  it("Date + Years(1) adds 1 year", () => {
    const r = evalSrc("Date(2026, 3, 15) + Years(1)") as Date;
    expect(r.getFullYear()).toBe(2027);
    expect(r.getMonth()).toBe(2);
    expect(r.getDate()).toBe(15);
  });
});

describe("Bloc 1 — date predicates", () => {
  it("IsBefore / IsAfter", () => {
    expect(evalSrc("IsBefore(Date(2026, 1, 1), Date(2026, 5, 1))")).toBe(true);
    expect(evalSrc("IsAfter(Date(2026, 5, 1), Date(2026, 1, 1))")).toBe(true);
  });

  it("IsBetween", () => {
    expect(evalSrc("IsBetween(Date(2026, 3, 1), Date(2026, 1, 1), Date(2026, 5, 1))")).toBe(true);
    expect(evalSrc("IsBetween(Date(2025, 1, 1), Date(2026, 1, 1), Date(2026, 5, 1))")).toBe(false);
  });

  it("IsSameDay", () => {
    expect(evalSrc("IsSameDay(Date(2026, 5, 7), Date(2026, 5, 7))")).toBe(true);
    expect(evalSrc("IsSameDay(Date(2026, 5, 7), Date(2026, 5, 8))")).toBe(false);
  });

  it("IsToday", () => {
    // FIXED_NOW = 2026-05-07
    expect(evalSrc("IsToday(Date(2026, 5, 7))")).toBe(true);
    expect(evalSrc("IsToday(Date(2026, 5, 8))")).toBe(false);
  });

  it("IsPast / IsFuture", () => {
    expect(evalSrc("IsPast(Date(2020, 1, 1))")).toBe(true);
    expect(evalSrc("IsFuture(Date(2030, 1, 1))")).toBe(true);
  });

  it("IsWeekend / IsWeekday", () => {
    expect(evalSrc("IsWeekend(Date(2026, 5, 9))")).toBe(true);  // Saturday
    expect(evalSrc("IsWeekday(Date(2026, 5, 7))")).toBe(true);  // Thursday
  });

  it("IsLeapYear", () => {
    expect(evalSrc("IsLeapYear(Date(2024, 1, 1))")).toBe(true);
    expect(evalSrc("IsLeapYear(Date(2026, 1, 1))")).toBe(false);
  });
});

describe("Bloc 1 — date format helpers", () => {
  it("FormatDate with tokens", () => {
    expect(evalSrc('FormatDate(Date(2026, 5, 7), "YYYY-MM-DD")')).toBe("2026-05-07");
  });

  it("ToISO / ToUnix / FromUnix", () => {
    const iso = evalSrc("ToISO(Now())") as string;
    expect(typeof iso).toBe("string");
    expect(iso).toContain("2026");
    const unix = evalSrc("ToUnix(Now())") as number;
    expect(typeof unix).toBe("number");
    const back = evalSrc(`FromUnix(${unix})`) as Date;
    expect(back instanceof Date).toBe(true);
    // Roundtrip: unix → Date → same instant
    expect(back.getTime()).toBe(FIXED_NOW.getTime());
  });

  it("FromISO", () => {
    const d = evalSrc('FromISO("2026-05-07")') as Date;
    expect(d instanceof Date).toBe(true);
    expect(d.getFullYear()).toBe(2026);
  });
});

describe("Bloc 1 — calendar helpers", () => {
  it("BusinessDaysBetween", () => {
    // Mon to Fri = 4 business days
    const r = evalSrc("BusinessDaysBetween(Date(2026, 5, 4), Date(2026, 5, 8))");
    expect(r).toBe(4);
  });

  it("AddBusinessDays", () => {
    // Start Monday 2026-05-04, add 5 business days → 2026-05-11 (Monday)
    const r = evalSrc("AddBusinessDays(Date(2026, 5, 4), 5)") as Date;
    expect(r instanceof Date).toBe(true);
    expect(r.getDay()).toBe(1); // Monday
  });

  it("DaysInMonth", () => {
    expect(evalSrc("DaysInMonth(Date(2026, 2, 1))")).toBe(28);
    expect(evalSrc("DaysInMonth(Date(2024, 2, 1))")).toBe(29);
    expect(evalSrc("DaysInMonth(Date(2026, 1, 1))")).toBe(31);
  });

  it("DaysInYear", () => {
    expect(evalSrc("DaysInYear(Date(2024, 1, 1))")).toBe(366);
    expect(evalSrc("DaysInYear(Date(2026, 1, 1))")).toBe(365);
  });
});

// ============================================================
// BLOC 2 — String member access
// ============================================================

describe("Bloc 2 — string property access", () => {
  it(".upper / .lower", () => {
    expect(evalSrc('"hello".upper')).toBe("HELLO");
    expect(evalSrc('"WORLD".lower')).toBe("world");
  });

  it(".trim / .trimStart / .trimEnd", () => {
    expect(evalSrc('"  hi  ".trim')).toBe("hi");
    expect(evalSrc('"  hi  ".trimStart')).toBe("hi  ");
    expect(evalSrc('"  hi  ".trimEnd')).toBe("  hi");
  });

  it(".length", () => {
    expect(evalSrc('"hello".length')).toBe(5);
  });

  it(".reverse", () => {
    expect(evalSrc('"abc".reverse')).toBe("cba");
  });

  it(".slugify", () => {
    expect(evalSrc('"Héllo Wörld!".slugify')).toBe("hello-world");
  });

  it(".isBlank / .isEmpty", () => {
    expect(evalSrc('"   ".isBlank')).toBe(true);
    expect(evalSrc('"hi".isBlank')).toBe(false);
    expect(evalSrc('"".isEmpty')).toBe(true);
  });

  it(".isNotBlank / .isNotEmpty", () => {
    expect(evalSrc('"hi".isNotBlank')).toBe(true);
    expect(evalSrc('"   ".isNotBlank')).toBe(false);
  });

  it(".proper", () => {
    expect(evalSrc('"hello world".proper')).toBe("Hello World");
  });
});

describe("Bloc 2 — isNull / isNotNull on any value", () => {
  it("null.isNull === true", () => {
    expect(evalSrc("null.isNull")).toBe(true);
  });
  it("non-null.isNull === false", () => {
    expect(evalSrc('"hello".isNull')).toBe(false);
  });
  it("null.isNotNull === false", () => {
    expect(evalSrc("null.isNotNull")).toBe(false);
  });
  it("non-null.isNotNull === true", () => {
    expect(evalSrc("42.isNotNull")).toBe(true);
  });
});

// ============================================================
// BLOC 3 — Coalesce / ?? / ?. / Try / NullIf
// ============================================================

describe("Bloc 3 — ?? nullish coalescing", () => {
  it("null ?? fallback returns fallback", () => {
    expect(evalSrc('null ?? "default"')).toBe("default");
  });
  it("value ?? fallback returns value", () => {
    expect(evalSrc('42 ?? "default"')).toBe(42);
  });
  it("chained ?? picks first non-null", () => {
    expect(evalSrc('null ?? null ?? "found"')).toBe("found");
  });
});

describe("Bloc 3 — ?. optional chaining", () => {
  it("null?.prop returns null without error", () => {
    expect(evalSrc("null?.foo")).toBe(null);
  });
});

describe("Bloc 3 — Try", () => {
  it("Try returns value on success", () => {
    expect(evalSrc('Try(1 + 1, 99)')).toBe(2);
  });
  it("Try returns fallback on error", () => {
    expect(evalSrc('Try(UndefinedFunc(), 99)')).toBe(99);
  });
  it("Try returns null when no fallback and error", () => {
    expect(evalSrc('Try(UndefinedFunc())')).toBe(null);
  });
});

describe("Bloc 3 — NullIf", () => {
  it("NullIf(5, 5) returns null", () => {
    expect(evalSrc("NullIf(5, 5)")).toBe(null);
  });
  it("NullIf(5, 3) returns 5", () => {
    expect(evalSrc("NullIf(5, 3)")).toBe(5);
  });
});

describe("Bloc 3 — Coalesce (existing, already in logicFunctions)", () => {
  it("Coalesce picks first non-null/empty", () => {
    expect(evalSrc('Coalesce(null, "", "hello")')).toBe("hello");
    expect(evalSrc('Coalesce(null, 42)')).toBe(42);
  });
});

// ============================================================
// BLOC 4 — List aggregates
// ============================================================

describe("Bloc 4 — Any / All / None", () => {
  it("Any with predicate", () => {
    expect(evalSrc("Any([1, 2, 3], x -> x > 2)")).toBe(true);
    expect(evalSrc("Any([1, 2, 3], x -> x > 10)")).toBe(false);
  });
  it("All with predicate", () => {
    expect(evalSrc("All([2, 4, 6], x -> x % 2 == 0)")).toBe(true);
    expect(evalSrc("All([1, 2, 3], x -> x > 1)")).toBe(false);
  });
  it("None with predicate", () => {
    expect(evalSrc("None([1, 2, 3], x -> x > 10)")).toBe(true);
    expect(evalSrc("None([1, 2, 3], x -> x > 2)")).toBe(false);
  });
});

describe("Bloc 4 — Includes / IndexOf", () => {
  it("Includes", () => {
    expect(evalSrc("Includes([1, 2, 3], 2)")).toBe(true);
    expect(evalSrc("Includes([1, 2, 3], 9)")).toBe(false);
  });
  it("IndexOf", () => {
    expect(evalSrc("IndexOf([10, 20, 30], 20)")).toBe(1);
    expect(evalSrc("IndexOf([10, 20], 99)")).toBe(-1);
  });
});

describe("Bloc 4 — Flatten / FlatMap / Compact", () => {
  it("Flatten 1 level", () => {
    // [[...]] parses as WikiLink — build nested list via scope
    const scope: Scope = { nested: [[1, 2], [3, 4]] as Value };
    expect(evalSrc("Flatten(nested)", undefined, scope)).toEqual([1, 2, 3, 4]);
  });
  it("FlatMap", () => {
    expect(evalSrc("FlatMap([1, 2, 3], x -> [x, x * 2])")).toEqual([1, 2, 2, 4, 3, 6]);
  });
  it("Compact removes nulls", () => {
    expect(evalSrc("Compact([1, null, 2, null, 3])")).toEqual([1, 2, 3]);
  });
});

describe("Bloc 4 — Chunk / Zip / Partition", () => {
  it("Chunk", () => {
    expect(evalSrc("Chunk([1, 2, 3, 4, 5], 2)")).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("Zip", () => {
    expect(evalSrc('Zip([1, 2, 3], ["a", "b", "c"])')).toEqual([[1, "a"], [2, "b"], [3, "c"]]);
  });
  it("Partition", () => {
    const r = evalSrc("Partition([1, 2, 3, 4], x -> x % 2 == 0)") as [number[], number[]];
    expect(r[0]).toEqual([2, 4]);
    expect(r[1]).toEqual([1, 3]);
  });
});

describe("Bloc 4 — SortBy / SortByDesc / MaxBy / MinBy / SumBy / AvgBy", () => {
  it("SortBy ascending", () => {
    expect(evalSrc("SortBy([3, 1, 2], x -> x)")).toEqual([1, 2, 3]);
  });
  it("SortByDesc descending", () => {
    expect(evalSrc("SortByDesc([3, 1, 2], x -> x)")).toEqual([3, 2, 1]);
  });
  it("MaxBy / MinBy", () => {
    expect(evalSrc("MaxBy([3, 1, 4], x -> x)")).toBe(4);
    expect(evalSrc("MinBy([3, 1, 4], x -> x)")).toBe(1);
  });
  it("SumBy", () => {
    expect(evalSrc("SumBy([1, 2, 3], x -> x * 2)")).toBe(12);
  });
  it("AvgBy", () => {
    expect(evalSrc("AvgBy([2, 4, 6], x -> x)")).toBe(4);
  });
});

describe("Bloc 4 — DistinctBy / CountBy", () => {
  it("DistinctBy", () => {
    expect(evalSrc('DistinctBy(["a", "b", "a"], x -> x)')).toEqual(["a", "b"]);
  });
  it("CountBy returns {key, count} entries", () => {
    const r = evalSrc('CountBy(["a", "b", "a"], x -> x)') as [string, number][];
    expect(r.some(([k, v]) => k === "a" && v === 2)).toBe(true);
  });
});

describe("Bloc 4 — Stddev / Variance / Mode / Range / Percentile", () => {
  it("Stddev", () => {
    const s = evalSrc("Stddev([2, 4, 4, 4, 5, 5, 7, 9])") as number;
    expect(s).toBeCloseTo(2, 0);
  });
  it("Variance", () => {
    const v = evalSrc("Variance([2, 4])") as number;
    expect(v).toBe(1);
  });
  it("Mode", () => {
    expect(evalSrc("Mode([1, 2, 2, 3])")).toBe(2);
  });
  it("Range", () => {
    expect(evalSrc("Range([1, 5, 3])")).toBe(4);
  });
  it("Percentile", () => {
    const p50 = evalSrc("Percentile([1, 2, 3, 4, 5], 50)");
    expect(typeof p50).toBe("number");
  });
});

describe("Bloc 4 — list property aliases", () => {
  it(".any / .all / .none", () => {
    expect(evalSrc("[1, 2, 3].any")).toBe(true);
    expect(evalSrc("[].any")).toBe(false);
    expect(evalSrc("[1, 2].all")).toBe(true);
    expect(evalSrc("[].none")).toBe(true);
  });
  it(".isEmpty / .isNotEmpty", () => {
    expect(evalSrc("[].isEmpty")).toBe(true);
    expect(evalSrc("[1].isNotEmpty")).toBe(true);
  });
  it(".compact", () => {
    expect(evalSrc("[1, null, 2].compact")).toEqual([1, 2]);
  });
  it(".flatten", () => {
    // [[...]] parses as WikiLink — build nested list via scope
    const scope: Scope = { nested: [[1, 2], [3]] as Value };
    expect(evalSrc("nested.flatten", undefined, scope)).toEqual([1, 2, 3]);
  });
  it(".distinct", () => {
    expect(evalSrc("[1, 2, 2, 3].distinct")).toEqual([1, 2, 3]);
  });
  it(".median", () => {
    expect(evalSrc("[1, 2, 3].median")).toBe(2);
  });
  it(".stddev", () => {
    expect(typeof evalSrc("[1, 2, 3, 4, 5].stddev")).toBe("number");
  });
  it(".variance", () => {
    expect(typeof evalSrc("[1, 2, 3].variance")).toBe("number");
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

// ============================================================
// STRING STDLIB — EXTENSION
// ============================================================

describe("String stdlib — extension", () => {
  it("ContainsText case-insensitive", () => {
    expect(evalSrc('ContainsText("Hello World", "world")')).toBe(true);
    expect(evalSrc('ContainsText("Hello World", "xyz")')).toBe(false);
  });
  it("EqualsIgnoreCase", () => {
    expect(evalSrc('EqualsIgnoreCase("Hello", "hello")')).toBe(true);
    expect(evalSrc('EqualsIgnoreCase("Hello", "world")')).toBe(false);
  });
  it("StartsWithIgnoreCase", () => {
    expect(evalSrc('StartsWithIgnoreCase("Hello", "hel")')).toBe(true);
  });
  it("EndsWithIgnoreCase", () => {
    expect(evalSrc('EndsWithIgnoreCase("Hello", "LLO")')).toBe(true);
  });
  it("FindIgnoreCase", () => {
    expect(evalSrc('FindIgnoreCase("Hello World", "WORLD")')).toBe(7);
  });
  it("Substitute all occurrences", () => {
    expect(evalSrc('Substitute("aababc", "a", "x")')).toBe("xxbxbc");
  });
  it("Substitute Nth occurrence", () => {
    expect(evalSrc('Substitute("aababc", "a", "x", 2)')).toBe("axbabc");
  });
  it("Char / Code", () => {
    expect(evalSrc("Char(65)")).toBe("A");
    expect(evalSrc('Code("A")')).toBe(65);
  });
  it("Repeat string alias", () => {
    expect(evalSrc('Repeat("ab", 3)')).toBe("ababab");
  });
  it("Truncate", () => {
    expect(evalSrc('Truncate("Hello World", 5)')).toBe("Hello…");
    expect(evalSrc('Truncate("Hello World", 5, "...")')).toBe("Hello...");
    expect(evalSrc('Truncate("Hi", 5)')).toBe("Hi");
  });
  it("Lines / LineCount", () => {
    expect(evalSrc('Lines("a\\nb\\nc")')).toEqual(["a", "b", "c"]);
    expect(evalSrc('LineCount("a\\nb\\nc")')).toBe(3);
  });
  it("Words / WordCount", () => {
    expect(evalSrc('Words("hello world foo")')).toEqual(["hello", "world", "foo"]);
    expect(evalSrc('WordCount("hello world foo")')).toBe(3);
  });
  it("StripHtml", () => {
    expect(evalSrc('StripHtml("<b>Hello</b> <i>World</i>")')).toBe("Hello World");
  });
  it("EscapeHtml / UnescapeHtml", () => {
    expect(evalSrc('EscapeHtml("<b>Hello & World</b>")')).toBe("&lt;b&gt;Hello &amp; World&lt;/b&gt;");
    expect(evalSrc('UnescapeHtml("&lt;b&gt;Hello&lt;/b&gt;")')).toBe("<b>Hello</b>");
  });
  it("UrlEncode / UrlDecode", () => {
    expect(evalSrc('UrlEncode("hello world")')).toBe("hello%20world");
    expect(evalSrc('UrlDecode("hello%20world")')).toBe("hello world");
  });
  it("Base64Encode / Base64Decode ASCII", () => {
    expect(evalSrc('Base64Encode("Hello")')).toBe("SGVsbG8=");
    expect(evalSrc('Base64Decode("SGVsbG8=")')).toBe("Hello");
  });
  it("PadStart / PadEnd", () => {
    expect(evalSrc('PadStart("5", 3, "0")')).toBe("005");
    expect(evalSrc('PadEnd("hi", 5, "-")')).toBe("hi---");
  });
  it("CamelCase", () => {
    expect(evalSrc('CamelCase("hello world foo")')).toBe("helloWorldFoo");
  });
  it("KebabCase", () => {
    expect(evalSrc('KebabCase("Hello World Foo")')).toBe("hello-world-foo");
  });
  it("SnakeCase", () => {
    expect(evalSrc('SnakeCase("Hello World Foo")')).toBe("hello_world_foo");
  });
  it("PascalCase", () => {
    expect(evalSrc('PascalCase("hello world")')).toBe("HelloWorld");
  });
  it("TitleCase alias Proper", () => {
    expect(evalSrc('TitleCase("hello world")')).toBe("Hello World");
  });
  it("LeftOf / RightOf / Between", () => {
    expect(evalSrc('LeftOf("hello-world", "-")')).toBe("hello");
    expect(evalSrc('RightOf("hello-world", "-")')).toBe("world");
    expect(evalSrc('Between("(hello)", "(", ")")')).toBe("hello");
  });
  it("Pluralize", () => {
    expect(evalSrc('Pluralize("item", 1)')).toBe("item");
    expect(evalSrc('Pluralize("item", 2)')).toBe("items");
  });
  it("Hash returns hex string", () => {
    const h = evalSrc('Hash("hello")') as string;
    expect(typeof h).toBe("string");
    expect(h.length).toBeGreaterThan(0);
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
  });
  it("StripMarkdown", () => {
    expect(evalSrc('StripMarkdown("**bold** and _italic_")')).toBe("bold and italic");
  });
  it("Reverse as function on string", () => {
    expect(evalSrc('Reverse("abc")')).toBe("cba");
  });
  it("ParseNumber", () => {
    expect(evalSrc('ParseNumber("3,14")')).toBe(3.14);
    expect(evalSrc('ParseNumber("42")')).toBe(42);
  });
});

// ============================================================
// MATH STDLIB — EXTENSION
// ============================================================

describe("Math stdlib — extension", () => {
  it("Square / Cube / Power", () => {
    expect(evalSrc("Square(4)")).toBe(16);
    expect(evalSrc("Cube(3)")).toBe(27);
    expect(evalSrc("Power(2, 10)")).toBe(1024);
  });
  it("IsInteger / IsFinite / IsNaN", () => {
    expect(evalSrc("IsInteger(3)")).toBe(true);
    expect(evalSrc("IsInteger(3.5)")).toBe(false);
    expect(evalSrc("IsFinite(1)")).toBe(true);
    expect(evalSrc("IsNaN(0)")).toBe(false);
  });
  it("IsPositive / IsNegative / IsZero / IsEven / IsOdd", () => {
    expect(evalSrc("IsPositive(1)")).toBe(true);
    expect(evalSrc("IsNegative(-1)")).toBe(true);
    expect(evalSrc("IsZero(0)")).toBe(true);
    expect(evalSrc("IsEven(4)")).toBe(true);
    expect(evalSrc("IsOdd(3)")).toBe(true);
  });
  it("Gcd / Lcm", () => {
    expect(evalSrc("Gcd(12, 8)")).toBe(4);
    expect(evalSrc("Lcm(4, 6)")).toBe(12);
  });
  it("Factorial", () => {
    expect(evalSrc("Factorial(5)")).toBe(120);
    expect(evalSrc("Factorial(0)")).toBe(1);
  });
  it("Clamp", () => {
    expect(evalSrc("Clamp(5, 1, 10)")).toBe(5);
    expect(evalSrc("Clamp(-5, 1, 10)")).toBe(1);
    expect(evalSrc("Clamp(15, 1, 10)")).toBe(10);
  });
  it("Lerp", () => {
    expect(evalSrc("Lerp(0, 100, 0.5)")).toBe(50);
  });
  it("MapRange", () => {
    expect(evalSrc("MapRange(5, 0, 10, 0, 100)")).toBe(50);
  });
  it("Trunc / Frac", () => {
    expect(evalSrc("Trunc(3.7)")).toBe(3);
    expect(evalSrc("Trunc(-3.7)")).toBe(-3);
    expect(evalSrc("Frac(3.75)")).toBeCloseTo(0.75);
  });
  it("Atan2 / Asin / Acos / Atan / Sinh / Cosh / Tanh", () => {
    expect(evalSrc("Atan2(1, 1)")).toBeCloseTo(Math.atan2(1, 1));
    expect(evalSrc("Asin(1)")).toBeCloseTo(Math.PI / 2);
    expect(evalSrc("Acos(1)")).toBeCloseTo(0);
    expect(evalSrc("Atan(1)")).toBeCloseTo(Math.PI / 4);
    expect(evalSrc("Sinh(0)")).toBeCloseTo(0);
    expect(evalSrc("Cosh(0)")).toBeCloseTo(1);
    expect(evalSrc("Tanh(0)")).toBeCloseTo(0);
  });
  it("FormatBytes", () => {
    expect(evalSrc("FormatBytes(0)")).toBe("0 o");
    expect(evalSrc("FormatBytes(1024)")).toBe("1,0 ko");
    expect(evalSrc("FormatBytes(1048576)")).toBe("1,0 Mo");
  });
  it("FormatOrdinal FR", () => {
    expect(evalSrc("FormatOrdinal(1)")).toBe("1er");
    expect(evalSrc("FormatOrdinal(2)")).toBe("2e");
    expect(evalSrc("FormatOrdinal(21)")).toBe("21e");
  });
  it("FormatPercent", () => {
    expect(evalSrc("FormatPercent(0.42)")).toBe("42%");
    expect(evalSrc("FormatPercent(0.333, 1)")).toBe("33,3%");
  });
  it("FormatCurrency returns string with number", () => {
    const r = evalSrc('FormatCurrency(1234.5, "EUR")') as string;
    expect(typeof r).toBe("string");
    expect(r).toMatch("1");
  });
  it("FormatNumber returns string", () => {
    const r = evalSrc("FormatNumber(1234567.89)") as string;
    expect(typeof r).toBe("string");
    expect(r).toMatch("1");
  });
});

// ============================================================
// DATE STDLIB — EXTENSION
// ============================================================

describe("Date stdlib — extension", () => {
  it("IsValidDate", () => {
    expect(evalSrc("IsValidDate(Today())")).toBe(true);
    expect(evalSrc('IsValidDate("not-a-date")')).toBe(false);
    expect(evalSrc("IsValidDate(null)")).toBe(false);
  });
  it("DateMin / DateMax", () => {
    expect(evalSrc("DateMin(Date(2026, 1, 1), Date(2026, 6, 1))")).toEqual(new Date(2026, 0, 1));
    expect(evalSrc("DateMax(Date(2026, 1, 1), Date(2026, 6, 1))")).toEqual(new Date(2026, 5, 1));
  });
  it("ParseDuration", () => {
    const d = evalSrc('ParseDuration("1h30m")') as { _type: string; ms: number };
    expect(d._type).toBe("duration");
    expect(d.ms).toBe(90 * 60 * 1000);
  });
  it("FormatDuration", () => {
    expect(evalSrc("FormatDuration(3661000)")).toBe("1h 1min 1s");
  });
  it("HumanDuration", () => {
    const result = evalSrc("HumanDuration(3600000)") as string;
    expect(result).toMatch(/1\s*h/);
  });
  it("DateRange returns list of dates", () => {
    const result = evalSrc("DateRange(Date(2026, 1, 1), Date(2026, 1, 3))") as Date[];
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(new Date(2026, 0, 1));
    expect(result[2]).toEqual(new Date(2026, 0, 3));
  });
});

// ============================================================
// LIST STDLIB — EXTENSION
// ============================================================

describe("List stdlib — extension", () => {
  it("TakeWhile", () => {
    expect(evalSrc("TakeWhile([1, 2, 3, 4, 5], x -> x < 4)")).toEqual([1, 2, 3]);
  });
  it("DropWhile", () => {
    expect(evalSrc("DropWhile([1, 2, 3, 4, 5], x -> x < 3)")).toEqual([3, 4, 5]);
  });
  it("Scan", () => {
    expect(evalSrc("Scan([1, 2, 3], (acc, x) -> acc + x, 0)")).toEqual([1, 3, 6]);
  });
  it("Tally", () => {
    const result = evalSrc('Tally(["a", "b", "a", "c", "b", "a"])') as Value[];
    expect(result).toHaveLength(3);
  });
  it("RepeatList", () => {
    expect(evalSrc("RepeatList(42, 3)")).toEqual([42, 42, 42]);
  });
  it("ConcatAll", () => {
    expect(evalSrc("ConcatAll([1, 2], [3, 4], [5])")).toEqual([1, 2, 3, 4, 5]);
  });
  it("Union", () => {
    expect(evalSrc("Union([1, 2, 3], [2, 3, 4])")).toEqual([1, 2, 3, 4]);
  });
  it("Intersect", () => {
    expect(evalSrc("Intersect([1, 2, 3], [2, 3, 4])")).toEqual([2, 3]);
  });
  it("Difference", () => {
    expect(evalSrc("Difference([1, 2, 3], [2, 3, 4])")).toEqual([1]);
  });
  it("Without", () => {
    expect(evalSrc("Without([1, 2, 3, 4], 2, 4)")).toEqual([1, 3]);
  });
  it("Pairwise", () => {
    expect(evalSrc("Pairwise([1, 2, 3])")).toEqual([[1, 2], [2, 3]]);
  });
  it("Unzip", () => {
    const pairs: Value = [[1, 2], [3, 4]];
    const result = evalSrc("Unzip(pairs)", undefined, { pairs }) as Value[][];
    expect(result[0]).toEqual([1, 3]);
    expect(result[1]).toEqual([2, 4]);
  });
  it("ContainsAll", () => {
    expect(evalSrc("ContainsAll([1, 2, 3, 4], [2, 3])")).toBe(true);
    expect(evalSrc("ContainsAll([1, 2, 3], [2, 5])")).toBe(false);
  });
  it("ContainsAny", () => {
    expect(evalSrc("ContainsAny([1, 2, 3], [3, 4, 5])")).toBe(true);
    expect(evalSrc("ContainsAny([1, 2, 3], [4, 5])")).toBe(false);
  });
  it("ContainsNone", () => {
    expect(evalSrc("ContainsNone([1, 2, 3], [4, 5])")).toBe(true);
  });
  it("FindIndex", () => {
    expect(evalSrc("FindIndex([1, 2, 3, 4], x -> x > 2)")).toBe(2);
  });
  it("ListFind", () => {
    expect(evalSrc("ListFind([1, 2, 3, 4], x -> x > 2)")).toBe(3);
  });
});

// ============================================================
// LOGIC STDLIB — EXTENSION
// ============================================================

describe("Logic stdlib — extension", () => {
  it("IfNull alias", () => {
    expect(evalSrc("IfNull(null, 42)")).toBe(42);
    expect(evalSrc("IfNull(5, 42)")).toBe(5);
  });
  it("Implies", () => {
    expect(evalSrc("Implies(true, false)")).toBe(false);
    expect(evalSrc("Implies(false, false)")).toBe(true);
    expect(evalSrc("Implies(false, true)")).toBe(true);
    expect(evalSrc("Implies(true, true)")).toBe(true);
  });
  it("Xor", () => {
    expect(evalSrc("Xor(true, false)")).toBe(true);
    expect(evalSrc("Xor(true, true)")).toBe(false);
  });
  it("Nand", () => {
    expect(evalSrc("Nand(true, true)")).toBe(false);
    expect(evalSrc("Nand(true, false)")).toBe(true);
  });
  it("Nor", () => {
    expect(evalSrc("Nor(false, false)")).toBe(true);
    expect(evalSrc("Nor(true, false)")).toBe(false);
  });
  it("ToBool", () => {
    expect(evalSrc("ToBool(1)")).toBe(true);
    expect(evalSrc("ToBool(0)")).toBe(false);
    expect(evalSrc('ToBool("hello")')).toBe(true);
    expect(evalSrc('ToBool("")')).toBe(false);
  });
  it("ToDate", () => {
    const d = evalSrc('ToDate("2026-01-15")');
    expect(d instanceof Date).toBe(true);
  });
  it("ToList wraps non-list in list", () => {
    expect(evalSrc("ToList(42)")).toEqual([42]);
    expect(evalSrc("ToList([1, 2])")).toEqual([1, 2]);
  });
  it("TypeOf", () => {
    expect(evalSrc('TypeOf("hello")')).toBe("text");
    expect(evalSrc("TypeOf(42)")).toBe("number");
    expect(evalSrc("TypeOf(true)")).toBe("bool");
    expect(evalSrc("TypeOf(Today())")).toBe("date");
    expect(evalSrc("TypeOf([1, 2])")).toBe("list");
    expect(evalSrc("TypeOf(null)")).toBe("null");
  });
  it("IsDate", () => {
    expect(evalSrc("IsDate(Today())")).toBe(true);
    expect(evalSrc('IsDate("2026-01-01")')).toBe(false);
  });
});

// ============================================================
// REGEX STDLIB
// ============================================================

describe("Regex stdlib", () => {
  it("RegexExtract group 0", () => {
    // formula string "\\w+" → after lexer escape: \w+
    expect(evalSrc('RegexExtract("hello world", "\\\\w+")')).toBe("hello");
  });
  it("RegexExtract group 1", () => {
    expect(evalSrc('RegexExtract("2026-05-16", "(\\\\d{4})-(\\\\d{2})-(\\\\d{2})", 1)')).toBe("2026");
  });
  it("RegexExtractAll", () => {
    expect(evalSrc('RegexExtractAll("one two three", "\\\\w+")')).toEqual(["one", "two", "three"]);
  });
  it("RegexSplit", () => {
    expect(evalSrc('RegexSplit("a1b2c3", "\\\\d")')).toEqual(["a", "b", "c", ""]);
  });
  it("RegexEscape", () => {
    expect(evalSrc('RegexEscape("hello.world+1")')).toBe("hello\\.world\\+1");
  });
});

// ============================================================
// JSON STDLIB
// ============================================================

describe("JSON stdlib", () => {
  it("ToJson / FromJson roundtrip", () => {
    const json = evalSrc("ToJson([1, 2, 3])") as string;
    expect(json).toBe("[1,2,3]");
    expect(evalSrc(`FromJson('${json}')`)).toEqual([1, 2, 3]);
  });
  it("JsonPath simple", () => {
    expect(evalSrc('JsonPath(FromJson(\'{"a":{"b":42}}\'), "a.b")')).toBe(42);
  });
  it("JsonPath array index", () => {
    expect(evalSrc('JsonPath(FromJson(\'{"items":[10,20,30]}\'), "items[1]")')).toBe(20);
  });
});

// ============================================================
// ENTITY STDLIB — EXTENSION
// ============================================================

describe("Entity stdlib — extension", () => {
  const entity = makeEntity("e1", { name: "Alice", age: 30 });
  const ctx: Partial<FormulaContext> = {
    resolveEntity: (ref) => ref === "e1" || ref === "Alice" ? entity : null,
    queryEntities: () => [entity],
  };

  it("Get field safe", () => {
    expect(evalSrc('Get(@e1, "age")', ctx)).toBe(30);
    expect(evalSrc('Get(@e1, "missing", "default")', ctx)).toBe("default");
  });
  it("Has field", () => {
    expect(evalSrc('Has(@e1, "age")', ctx)).toBe(true);
    expect(evalSrc('Has(@e1, "missing")', ctx)).toBe(false);
  });
  it("EntityId returns entity id", () => {
    expect(evalSrc("EntityId(@e1)", ctx)).toBe("e1");
  });
  it("CreatedAt / UpdatedAt", () => {
    expect(evalSrc("CreatedAt(@e1)", ctx)).toEqual(FIXED_NOW);
    expect(evalSrc("UpdatedAt(@e1)", ctx)).toEqual(FIXED_NOW);
  });
  it("CountOf", () => {
    expect(evalSrc('CountOf("test")', ctx)).toBe(1);
  });
  it("FindAll", () => {
    const result = evalSrc('FindAll("test")', ctx) as Value[];
    expect(result).toHaveLength(1);
  });
});

// ============================================================
// CHAINABLE PROPERTIES — NUMBERS
// ============================================================

describe("Chainable properties — numbers", () => {
  it("n.abs", () => expect(evalSrc("(-5).abs")).toBe(5));
  it("n.round", () => expect(evalSrc("(3.7).round")).toBe(4));
  it("n.ceil", () => expect(evalSrc("(3.2).ceil")).toBe(4));
  it("n.floor", () => expect(evalSrc("(3.9).floor")).toBe(3));
  it("n.sign", () => expect(evalSrc("(-5).sign")).toBe(-1));
  it("n.sqrt", () => expect(evalSrc("(16).sqrt")).toBe(4));
  it("n.isInteger", () => expect(evalSrc("(3).isInteger")).toBe(true));
  it("n.isEven", () => expect(evalSrc("(4).isEven")).toBe(true));
  it("n.isOdd", () => expect(evalSrc("(3).isOdd")).toBe(true));
});

// ============================================================
// CHAINABLE PROPERTIES — DATES
// ============================================================

describe("Chainable properties — dates", () => {
  const fixedLocal = new Date(FIXED_NOW.getFullYear(), FIXED_NOW.getMonth(), FIXED_NOW.getDate());
  it("date.year", () => expect(evalSrc("Today().year")).toBe(fixedLocal.getFullYear()));
  it("date.month", () => expect(evalSrc("Today().month")).toBe(fixedLocal.getMonth() + 1));
  it("date.day", () => expect(evalSrc("Today().day")).toBe(fixedLocal.getDate()));
  it("date.hour", () => expect(evalSrc("Now().hour")).toBe(FIXED_NOW.getHours()));
  it("date.weekday", () => expect(typeof evalSrc("Today().weekday")).toBe("number"));
  it("date.quarter", () => expect(evalSrc("Today().quarter")).toBe(2));
  it("date.isToday", () => expect(evalSrc("Today().isToday")).toBe(true));
  it("date.isPast", () => expect(evalSrc("Date(2020, 1, 1).isPast")).toBe(true));
  it("date.isFuture", () => expect(evalSrc("Date(2030, 1, 1).isFuture")).toBe(true));
  it("date.isWeekend", () => expect(typeof evalSrc("Today().isWeekend")).toBe("boolean"));
  it("date.toISO", () => expect(typeof evalSrc("Today().toISO")).toBe("string"));
  it("date.toUnix", () => expect(typeof evalSrc("Today().toUnix")).toBe("number"));
});

// ============================================================
// RELATION CHAIN — EntityValue nested access
// ============================================================

describe("Evaluator — relation field chain", () => {
  // Helper: cast a plain object with EntityValue fields to Entity (runtime shape matches)
  function ent<T extends { id: string; typeId: string; filePath: string; body: string; createdAt: Date; updatedAt: Date; fields: Record<string, unknown> }>(e: T): Entity {
    return e as unknown as Entity;
  }

  function makeRelatedEntities() {
    const marques = [
      ent({ id: "m1", typeId: "Marque", filePath: "/m1.md", body: "", createdAt: FIXED_NOW, updatedAt: FIXED_NOW, fields: { name: "BMW", type: "luxe" } }),
      ent({ id: "m2", typeId: "Marque", filePath: "/m2.md", body: "", createdAt: FIXED_NOW, updatedAt: FIXED_NOW, fields: { name: "Dacia", type: "économique" } }),
    ];

    // After two-pass resolution, voitures.marque is an EntityValue pointing to a marque entity
    const voitures = [
      ent({ id: "v1", typeId: "Voiture", filePath: "/v1.md", body: "", createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
        fields: { name: "X5", marque: { _type: "entity" as const, entity: marques[0]! } } }),
      ent({ id: "v2", typeId: "Voiture", filePath: "/v2.md", body: "", createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
        fields: { name: "Sandero", marque: { _type: "entity" as const, entity: marques[1]! } } }),
    ];

    const scope: Scope = {
      Voitures: voitures.map((e) => ({ _type: "entity" as const, entity: e })),
      thisRow: { _type: "entity" as const, entity: ent({ id: "__thisRow__", typeId: "Voiture", filePath: "", body: "", createdAt: FIXED_NOW, updatedAt: FIXED_NOW, fields: {} }) },
    };

    return scope;
  }

  it("accesses nested relation field via currentValue.marque.type", () => {
    const scope = makeRelatedEntities();
    const result = evalSrc(
      'Voitures.where(currentValue.marque.type == "luxe").count',
      undefined,
      scope,
    );
    expect(result).toBe(1);
  });

  it("accesses nested relation field name", () => {
    const scope = makeRelatedEntities();
    // project the name field of the marque relation
    const result = evalSrc(
      "Voitures.Map(currentValue -> currentValue.marque.name)",
      undefined,
      scope,
    );
    expect(result).toEqual(["BMW", "Dacia"]);
  });

  it("returns null for missing relation target", () => {
    const scope: Scope = {
      Voitures: [
        {
          _type: "entity" as const,
          entity: ent({ id: "v3", typeId: "Voiture", filePath: "/v3.md", body: "", createdAt: FIXED_NOW, updatedAt: FIXED_NOW, fields: { name: "Aucun", marque: null } }),
        },
      ],
    };
    const result = evalSrc("Voitures.Map(currentValue -> currentValue.marque)", undefined, scope);
    expect(result).toEqual([null]);
  });

  it("handles many-cardinality: access to list of EntityValues", () => {
    const tags = [
      ent({ id: "t1", typeId: "Tag", filePath: "/t1.md", body: "", createdAt: FIXED_NOW, updatedAt: FIXED_NOW, fields: { name: "tech" } }),
      ent({ id: "t2", typeId: "Tag", filePath: "/t2.md", body: "", createdAt: FIXED_NOW, updatedAt: FIXED_NOW, fields: { name: "news" } }),
    ];
    const entity = ent({
      id: "e1",
      typeId: "Article",
      filePath: "/e1.md",
      body: "",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      fields: {
        title: "Hello",
        // many-cardinality: list of EntityValues
        tags: [
          { _type: "entity" as const, entity: tags[0]! },
          { _type: "entity" as const, entity: tags[1]! },
        ],
      },
    });
    const scope: Scope = {
      Articles: [{ _type: "entity" as const, entity: entity }],
    };
    const result = evalSrc(
      "Articles.first.tags.count",
      undefined,
      scope,
    );
    expect(result).toBe(2);
  });
});
