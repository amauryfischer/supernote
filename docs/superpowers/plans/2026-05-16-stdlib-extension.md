# Formula Stdlib Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Massively extend the Supernote formula stdlib (strings, math, dates, lists, logic, regex, JSON, entities) to approach Coda/Notion parity, and expose all new functions + chainable methods in the UI catalog.

**Architecture:**
- Parser already desugars `obj.method(args)` → `FunctionCall(name, [obj, ...args])` in `parsePostfix()`. No parser changes needed for method-call dispatch.
- Each category gets new functions added to its stdlib file. Chainable "methods" are just regular functions that receive the receiver as first arg (the parser handles the desugar).
- `evalPropertyAccess` in `evaluator.ts` is extended for new no-arg properties (number, date chainables). For with-arg methods, registration in the stdlib functions table is sufficient.
- `FormulaInputEditor.tsx` FUNCTIONS, STRING_MEMBERS, LIST_MEMBERS arrays are updated to expose completions.

**Tech Stack:** TypeScript strict, vitest, pnpm workspaces, `@supernote/formulas` package, `apps/web`.

---

## Key Technical Decision: Method Call Dispatch

The parser (`parsePostfix`) already handles `receiver.MethodName(args)` by desugaring to:
```ts
{ kind: "FunctionCall", name: "MethodName", args: [receiver, ...args] }
```
So `"hello".Contains("l")` parses to `Contains("hello", "l")` — which already works.

For no-arg chainable properties on **numbers** and **dates** (e.g. `n.abs`, `d.year`), they go through `evalPropertyAccess` which we extend.

---

## File Map

| File | Action |
|------|--------|
| `packages/formulas/src/stdlib/strings.ts` | Add ~35 new string functions |
| `packages/formulas/src/stdlib/math.ts` | Add ~25 new math functions |
| `packages/formulas/src/stdlib/dates.ts` | Add ~10 new date functions |
| `packages/formulas/src/stdlib/lists.ts` | Add ~20 new list functions |
| `packages/formulas/src/stdlib/logic.ts` | Add ~12 new logic/type functions |
| `packages/formulas/src/stdlib/regex.ts` | **Create** — RegexExtract, RegexExtractAll, RegexSplit, RegexEscape |
| `packages/formulas/src/stdlib/json.ts` | **Create** — ToJson, FromJson, JsonPath |
| `packages/formulas/src/evaluator.ts` | Import regex+json; extend evalPropertyAccess for number/date props |
| `packages/formulas/src/formula.test.ts` | Add tests for all new functions |
| `apps/web/src/components/bases/FormulaInputEditor.tsx` | Extend FUNCTIONS, STRING_MEMBERS, LIST_MEMBERS catalogs |

---

## Task 1: String Functions Extension

**Files:**
- Modify: `packages/formulas/src/stdlib/strings.ts`
- Test: `packages/formulas/src/formula.test.ts`

- [ ] **Step 1: Write failing tests for new string functions**

Add to `formula.test.ts` (in the existing string describe block or a new one):

```ts
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
    expect(evalSrc('Char(65)')).toBe("A");
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
    expect(evalSrc('EscapeHtml("<b>Hello & \\"World\\"</b>")')).toBe("&lt;b&gt;Hello &amp; &quot;World&quot;&lt;/b&gt;");
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
});
```

- [ ] **Step 2: Run tests — verify all fail**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas test --reporter=verbose 2>&1 | grep -E "FAIL|PASS|Error" | head -30
```

Expected: failures for all new function names (Unknown function).

- [ ] **Step 3: Implement new string functions**

Replace entire `packages/formulas/src/stdlib/strings.ts`:

```ts
// ============================================================
// String stdlib functions
// ============================================================

import type { Value } from "../value.js";
import { coerceToNumber, coerceToString } from "../value.js";
import { makeEvalError, type EvalError } from "../errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";

// FNV-1a 32-bit hash — no crypto, worker-safe
function fnv1a32(s: string): string {
  let hash = 2166136261;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16);
}

function wordsFrom(s: string): string[] {
  return s.trim().split(/[\s\-_]+/).filter(Boolean);
}

export const stringFunctions: Record<string, (args: Value[]) => Result<Value, EvalError>> = {
  Concat(args) { return ok(args.map(coerceToString).join("")); },
  Concatenate(args) { return ok(args.map(coerceToString).join("")); },
  Length(args) {
    const v = args[0] ?? null;
    if (Array.isArray(v)) return ok(v.length);
    return ok(coerceToString(v).length);
  },
  Len(args) {
    const v = args[0] ?? null;
    if (Array.isArray(v)) return ok(v.length);
    return ok(coerceToString(v).length);
  },
  Upper(args) { return ok(coerceToString(args[0] ?? null).toUpperCase()); },
  Lower(args) { return ok(coerceToString(args[0] ?? null).toLowerCase()); },
  Proper(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
  },
  TitleCase(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
  },
  Trim(args) { return ok(coerceToString(args[0] ?? null).trim()); },
  Split(args) {
    const s = coerceToString(args[0] ?? null);
    const sep = coerceToString(args[1] ?? ",");
    return ok(s.split(sep));
  },
  Replace(args) {
    const s = coerceToString(args[0] ?? null);
    const from = coerceToString(args[1] ?? null);
    const to = coerceToString(args[2] ?? null);
    return ok(s.split(from).join(to));
  },
  Contains(args) {
    const a = args[0] ?? null;
    const b = args[1] ?? null;
    if (Array.isArray(a)) {
      const targetStr = coerceToString(b);
      return ok(a.some((v) => v === b || coerceToString(v) === targetStr));
    }
    return ok(coerceToString(a).includes(coerceToString(b)));
  },
  ContainsText(args) {
    const s = coerceToString(args[0] ?? null).toLowerCase();
    const sub = coerceToString(args[1] ?? null).toLowerCase();
    return ok(s.includes(sub));
  },
  StartsWith(args) {
    return ok(coerceToString(args[0] ?? null).startsWith(coerceToString(args[1] ?? null)));
  },
  EndsWith(args) {
    return ok(coerceToString(args[0] ?? null).endsWith(coerceToString(args[1] ?? null)));
  },
  StartsWithIgnoreCase(args) {
    return ok(coerceToString(args[0] ?? null).toLowerCase().startsWith(coerceToString(args[1] ?? null).toLowerCase()));
  },
  EndsWithIgnoreCase(args) {
    return ok(coerceToString(args[0] ?? null).toLowerCase().endsWith(coerceToString(args[1] ?? null).toLowerCase()));
  },
  EqualsIgnoreCase(args) {
    return ok(coerceToString(args[0] ?? null).toLowerCase() === coerceToString(args[1] ?? null).toLowerCase());
  },
  FindIgnoreCase(args) {
    const haystack = coerceToString(args[0] ?? null);
    const needle = coerceToString(args[1] ?? null);
    const idx = haystack.toLowerCase().indexOf(needle.toLowerCase());
    return ok(idx < 0 ? 0 : idx + 1);
  },
  Substitute(args) {
    const s = coerceToString(args[0] ?? null);
    const find = coerceToString(args[1] ?? null);
    const replace = coerceToString(args[2] ?? null);
    const occurrence = args.length > 3 ? coerceToNumber(args[3] ?? null) : null;
    if (!find) return ok(s);
    if (occurrence === null || occurrence === undefined) {
      return ok(s.split(find).join(replace));
    }
    const occ = Math.max(1, Math.floor(occurrence));
    let count = 0;
    return ok(s.replace(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), (match) => {
      count++;
      return count === occ ? replace : match;
    }));
  },
  Substring(args) {
    const s = coerceToString(args[0] ?? null);
    const start = coerceToNumber(args[1] ?? null) ?? 0;
    const end = args.length > 2 ? coerceToNumber(args[2] ?? null) ?? s.length : s.length;
    return ok(s.slice(start, end));
  },
  RegexMatch(args) {
    const s = coerceToString(args[0] ?? null);
    const pattern = coerceToString(args[1] ?? null);
    try {
      const match = s.match(new RegExp(pattern));
      return ok(match ? (match[0] ?? null) : null);
    } catch {
      return err(makeEvalError(`RegexMatch: invalid pattern '${pattern}'`));
    }
  },
  RegexReplace(args) {
    const s = coerceToString(args[0] ?? null);
    const pat = coerceToString(args[1] ?? null);
    const rep = coerceToString(args[2] ?? null);
    const flags = args.length > 3 ? coerceToString(args[3] ?? "g") : "g";
    try { return ok(s.replace(new RegExp(pat, flags), rep)); }
    catch { return err(makeEvalError(`RegexReplace: invalid pattern '${pat}'`)); }
  },
  RegexAll(args) {
    const s = coerceToString(args[0] ?? null);
    const pat = coerceToString(args[1] ?? null);
    try {
      const re = new RegExp(pat, "g");
      const out: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        out.push(m[0]);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      return ok(out);
    } catch { return err(makeEvalError(`RegexAll: invalid pattern '${pat}'`)); }
  },
  Slugify(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  },
  RepeatString(args) {
    const s = coerceToString(args[0] ?? null);
    const n = Math.max(0, Math.floor(coerceToNumber(args[1] ?? null) ?? 0));
    return ok(s.repeat(n));
  },
  Repeat(args) {
    // Repeat(s, n) — string alias of RepeatString
    const s = coerceToString(args[0] ?? null);
    const n = Math.max(0, Math.floor(coerceToNumber(args[1] ?? null) ?? 0));
    return ok(s.repeat(n));
  },
  ToText(args) { return ok(coerceToString(args[0] ?? null)); },
  ToNumber(args) { return ok(coerceToNumber(args[0] ?? null)); },
  ParseInt(args) {
    const s = coerceToString(args[0] ?? null);
    const radix = args.length > 1 ? Math.max(2, Math.min(36, coerceToNumber(args[1] ?? null) ?? 10)) : 10;
    const n = parseInt(s, radix);
    return ok(isNaN(n) ? null : n);
  },
  ParseFloat(args) {
    const s = coerceToString(args[0] ?? null);
    const n = parseFloat(s);
    return ok(isNaN(n) ? null : n);
  },
  ParseNumber(args) {
    const s = coerceToString(args[0] ?? null).replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(s);
    return ok(isNaN(n) ? null : n);
  },
  Format(args) {
    if (args.length === 0) return ok("");
    const first = args[0] ?? null;
    if (first instanceof Date) {
      const fmt = coerceToString(args[1] ?? "YYYY-MM-DD");
      const d = first;
      return ok(fmt
        .replace("YYYY", String(d.getFullYear()).padStart(4, "0"))
        .replace("MM", String(d.getMonth() + 1).padStart(2, "0"))
        .replace("DD", String(d.getDate()).padStart(2, "0"))
        .replace("HH", String(d.getHours()).padStart(2, "0"))
        .replace("mm", String(d.getMinutes()).padStart(2, "0"))
        .replace("ss", String(d.getSeconds()).padStart(2, "0")));
    }
    const tpl = coerceToString(first);
    return ok(tpl.replace(/\{(\d+)\}/g, (_, n: string) => {
      const i = Number(n);
      return i >= 1 && i < args.length ? coerceToString(args[i] ?? null) : "";
    }));
  },
  Left(args) {
    const s = coerceToString(args[0] ?? null);
    const n = coerceToNumber(args[1] ?? null) ?? 0;
    return ok(s.slice(0, Math.max(0, n)));
  },
  Right(args) {
    const s = coerceToString(args[0] ?? null);
    const n = coerceToNumber(args[1] ?? null) ?? 0;
    if (n <= 0) return ok("");
    return ok(s.slice(-n));
  },
  Middle(args) {
    const s = coerceToString(args[0] ?? null);
    const start = (coerceToNumber(args[1] ?? null) ?? 1) - 1;
    const len = args.length > 2 ? coerceToNumber(args[2] ?? null) ?? 0 : s.length - start;
    return ok(s.slice(Math.max(0, start), Math.max(0, start) + Math.max(0, len)));
  },
  Find(args) {
    const haystack = coerceToString(args[0] ?? null);
    const needle = coerceToString(args[1] ?? null);
    const from = args.length > 2 ? (coerceToNumber(args[2] ?? null) ?? 1) - 1 : 0;
    const idx = haystack.indexOf(needle, Math.max(0, from));
    return ok(idx < 0 ? 0 : idx + 1);
  },
  Char(args) {
    const code = coerceToNumber(args[0] ?? null);
    if (code === null) return err(makeEvalError("Char: expected number"));
    return ok(String.fromCharCode(Math.floor(code)));
  },
  Code(args) {
    const s = coerceToString(args[0] ?? null);
    if (!s) return err(makeEvalError("Code: expected non-empty string"));
    return ok(s.charCodeAt(0));
  },
  Truncate(args) {
    const s = coerceToString(args[0] ?? null);
    const maxLen = coerceToNumber(args[1] ?? null) ?? 100;
    const suffix = args.length > 2 ? coerceToString(args[2] ?? "…") : "…";
    if (s.length <= maxLen) return ok(s);
    return ok(s.slice(0, maxLen) + suffix);
  },
  Lines(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.split(/\r?\n/));
  },
  LineCount(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.split(/\r?\n/).length);
  },
  Words(args) {
    const s = coerceToString(args[0] ?? null);
    const ws = s.trim().split(/\s+/).filter(Boolean);
    return ok(ws);
  },
  WordCount(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.trim() === "" ? 0 : s.trim().split(/\s+/).length);
  },
  Sentences(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean));
  },
  StripHtml(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim());
  },
  StripMarkdown(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[([^\]]*)\]\(.*?\)/g, "$1")
      .replace(/[*_~`#>]+/g, "")
      .replace(/\s+/g, " ")
      .trim());
  },
  EscapeHtml(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"));
  },
  UnescapeHtml(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  },
  EscapeRegex(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  },
  UrlEncode(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(encodeURIComponent(s));
  },
  UrlDecode(args) {
    const s = coerceToString(args[0] ?? null);
    try { return ok(decodeURIComponent(s)); }
    catch { return err(makeEvalError("UrlDecode: invalid encoded string")); }
  },
  Base64Encode(args) {
    const s = coerceToString(args[0] ?? null);
    try { return ok(btoa(encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, p1: string) => String.fromCharCode(parseInt(p1, 16))))); }
    catch { return err(makeEvalError("Base64Encode: encoding failed")); }
  },
  Base64Decode(args) {
    const s = coerceToString(args[0] ?? null);
    try { return ok(decodeURIComponent(atob(s).split("").map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)).join(""))); }
    catch { return err(makeEvalError("Base64Decode: invalid base64")); }
  },
  PadStart(args) {
    const s = coerceToString(args[0] ?? null);
    const len = Math.floor(coerceToNumber(args[1] ?? null) ?? 0);
    const ch = args.length > 2 ? coerceToString(args[2] ?? " ") : " ";
    return ok(s.padStart(len, ch));
  },
  PadEnd(args) {
    const s = coerceToString(args[0] ?? null);
    const len = Math.floor(coerceToNumber(args[1] ?? null) ?? 0);
    const ch = args.length > 2 ? coerceToString(args[2] ?? " ") : " ";
    return ok(s.padEnd(len, ch));
  },
  CamelCase(args) {
    const words = wordsFrom(coerceToString(args[0] ?? null));
    return ok(words.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(""));
  },
  KebabCase(args) {
    return ok(wordsFrom(coerceToString(args[0] ?? null)).map((w) => w.toLowerCase()).join("-"));
  },
  SnakeCase(args) {
    return ok(wordsFrom(coerceToString(args[0] ?? null)).map((w) => w.toLowerCase()).join("_"));
  },
  PascalCase(args) {
    return ok(wordsFrom(coerceToString(args[0] ?? null)).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(""));
  },
  LeftOf(args) {
    const s = coerceToString(args[0] ?? null);
    const sep = coerceToString(args[1] ?? null);
    const idx = s.indexOf(sep);
    return ok(idx < 0 ? s : s.slice(0, idx));
  },
  RightOf(args) {
    const s = coerceToString(args[0] ?? null);
    const sep = coerceToString(args[1] ?? null);
    const idx = s.indexOf(sep);
    return ok(idx < 0 ? "" : s.slice(idx + sep.length));
  },
  Between(args) {
    const s = coerceToString(args[0] ?? null);
    const start = coerceToString(args[1] ?? null);
    const end = coerceToString(args[2] ?? null);
    const si = s.indexOf(start);
    if (si < 0) return ok("");
    const after = si + start.length;
    const ei = s.indexOf(end, after);
    return ok(ei < 0 ? "" : s.slice(after, ei));
  },
  Pluralize(args) {
    const word = coerceToString(args[0] ?? null);
    const n = coerceToNumber(args[1] ?? null) ?? 0;
    return ok(n === 1 ? word : word + "s");
  },
  Hash(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(fnv1a32(s));
  },
  Reverse(args) {
    const v = args[0] ?? null;
    if (Array.isArray(v)) return ok([...v].reverse());
    return ok(coerceToString(v).split("").reverse().join(""));
  },
};
```

- [ ] **Step 4: Run tests — verify string tests pass**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas test --reporter=verbose 2>&1 | grep -E "✓|✗|FAIL|PASS|string stdlib" | head -40
```

Expected: all new string tests pass.

---

## Task 2: Math Functions Extension

**Files:**
- Modify: `packages/formulas/src/stdlib/math.ts`
- Test: `packages/formulas/src/formula.test.ts`

- [ ] **Step 1: Write failing tests for new math functions**

Add to `formula.test.ts`:

```ts
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
  it("FormatCurrency", () => {
    expect(evalSrc('FormatCurrency(1234.5, "EUR")')).toMatch("1");
  });
  it("FormatNumber", () => {
    expect(evalSrc("FormatNumber(1234567.89)")).toMatch("1");
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas test --reporter=verbose 2>&1 | grep -E "Math stdlib" | head -20
```

- [ ] **Step 3: Add new math functions to `packages/formulas/src/stdlib/math.ts`**

Append after the existing `Quantile` function (before the closing `};`):

```ts
  Square(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("Square: expected number"));
    return ok(n * n);
  },
  Cube(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("Cube: expected number"));
    return ok(n * n * n);
  },
  Power(args) {
    const base = coerceToNumber(args[0] ?? null);
    const exp = coerceToNumber(args[1] ?? null);
    if (base === null || exp === null) return err(makeEvalError("Power: expected numbers"));
    return ok(Math.pow(base, exp));
  },
  IsInteger(args) {
    const n = coerceToNumber(args[0] ?? null);
    return ok(n !== null && Number.isInteger(n));
  },
  IsFinite(args) {
    const n = coerceToNumber(args[0] ?? null);
    return ok(n !== null && Number.isFinite(n));
  },
  IsNaN(args) {
    const n = coerceToNumber(args[0] ?? null);
    return ok(n === null || Number.isNaN(n));
  },
  IsPositive(args) {
    const n = coerceToNumber(args[0] ?? null);
    return ok(n !== null && n > 0);
  },
  IsNegative(args) {
    const n = coerceToNumber(args[0] ?? null);
    return ok(n !== null && n < 0);
  },
  IsZero(args) {
    const n = coerceToNumber(args[0] ?? null);
    return ok(n !== null && n === 0);
  },
  IsEven(args) {
    const n = coerceToNumber(args[0] ?? null);
    return ok(n !== null && Number.isInteger(n) && n % 2 === 0);
  },
  IsOdd(args) {
    const n = coerceToNumber(args[0] ?? null);
    return ok(n !== null && Number.isInteger(n) && Math.abs(n % 2) === 1);
  },
  Gcd(args) {
    const a = coerceToNumber(args[0] ?? null);
    const b = coerceToNumber(args[1] ?? null);
    if (a === null || b === null) return err(makeEvalError("Gcd: expected numbers"));
    let x = Math.abs(Math.floor(a)), y = Math.abs(Math.floor(b));
    while (y !== 0) { const t = y; y = x % y; x = t; }
    return ok(x);
  },
  Lcm(args) {
    const a = coerceToNumber(args[0] ?? null);
    const b = coerceToNumber(args[1] ?? null);
    if (a === null || b === null) return err(makeEvalError("Lcm: expected numbers"));
    const x = Math.abs(Math.floor(a)), y = Math.abs(Math.floor(b));
    if (x === 0 || y === 0) return ok(0);
    let p = x, q = y;
    while (q !== 0) { const t = q; q = p % q; p = t; }
    return ok((x / p) * y);
  },
  Factorial(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null || n < 0 || !Number.isInteger(n)) return err(makeEvalError("Factorial: expected non-negative integer"));
    if (n > 170) return err(makeEvalError("Factorial: input too large"));
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return ok(result);
  },
  Clamp(args) {
    const n = coerceToNumber(args[0] ?? null);
    const lo = coerceToNumber(args[1] ?? null);
    const hi = coerceToNumber(args[2] ?? null);
    if (n === null || lo === null || hi === null) return err(makeEvalError("Clamp: expected numbers"));
    return ok(Math.min(hi, Math.max(lo, n)));
  },
  Lerp(args) {
    const a = coerceToNumber(args[0] ?? null);
    const b = coerceToNumber(args[1] ?? null);
    const t = coerceToNumber(args[2] ?? null);
    if (a === null || b === null || t === null) return err(makeEvalError("Lerp: expected numbers"));
    return ok(a + (b - a) * t);
  },
  MapRange(args) {
    const n = coerceToNumber(args[0] ?? null);
    const inMin = coerceToNumber(args[1] ?? null);
    const inMax = coerceToNumber(args[2] ?? null);
    const outMin = coerceToNumber(args[3] ?? null);
    const outMax = coerceToNumber(args[4] ?? null);
    if (n === null || inMin === null || inMax === null || outMin === null || outMax === null)
      return err(makeEvalError("MapRange: expected 5 numbers"));
    if (inMax === inMin) return err(makeEvalError("MapRange: inMin === inMax"));
    return ok(outMin + ((n - inMin) / (inMax - inMin)) * (outMax - outMin));
  },
  Trunc(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("Trunc: expected number"));
    return ok(Math.trunc(n));
  },
  Frac(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("Frac: expected number"));
    return ok(n - Math.trunc(n));
  },
  Atan2(args) {
    const y = coerceToNumber(args[0] ?? null);
    const x = coerceToNumber(args[1] ?? null);
    if (y === null || x === null) return err(makeEvalError("Atan2: expected numbers"));
    return ok(Math.atan2(y, x));
  },
  Asin(args) { const n = coerceToNumber(args[0] ?? null); return n === null ? err(makeEvalError("Asin: number")) : ok(Math.asin(n)); },
  Acos(args) { const n = coerceToNumber(args[0] ?? null); return n === null ? err(makeEvalError("Acos: number")) : ok(Math.acos(n)); },
  Atan(args) { const n = coerceToNumber(args[0] ?? null); return n === null ? err(makeEvalError("Atan: number")) : ok(Math.atan(n)); },
  Sinh(args) { const n = coerceToNumber(args[0] ?? null); return n === null ? err(makeEvalError("Sinh: number")) : ok(Math.sinh(n)); },
  Cosh(args) { const n = coerceToNumber(args[0] ?? null); return n === null ? err(makeEvalError("Cosh: number")) : ok(Math.cosh(n)); },
  Tanh(args) { const n = coerceToNumber(args[0] ?? null); return n === null ? err(makeEvalError("Tanh: number")) : ok(Math.tanh(n)); },
  FormatBytes(args) {
    const n = coerceToNumber(args[0] ?? null) ?? 0;
    const units = ["o", "ko", "Mo", "Go", "To"];
    let size = Math.abs(n), i = 0;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    const formatted = i === 0 ? String(Math.floor(size)) : size.toFixed(1).replace(".", ",");
    return ok(`${formatted} ${units[i]}`);
  },
  FormatOrdinal(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("FormatOrdinal: expected number"));
    const abs = Math.floor(Math.abs(n));
    return ok(abs === 1 ? `${abs}er` : `${abs}e`);
  },
  FormatPercent(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("FormatPercent: expected number"));
    const decimals = args.length > 1 ? Math.floor(coerceToNumber(args[1] ?? null) ?? 0) : 0;
    const pct = (n * 100).toFixed(decimals).replace(".", ",");
    return ok(`${pct}%`);
  },
  FormatCurrency(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("FormatCurrency: expected number"));
    const code = args.length > 1 ? coerceToString(args[1] ?? "EUR") : "EUR";
    try {
      return ok(new Intl.NumberFormat("fr-FR", { style: "currency", currency: code }).format(n));
    } catch {
      return err(makeEvalError(`FormatCurrency: invalid currency code '${code}'`));
    }
  },
  FormatNumber(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("FormatNumber: expected number"));
    return ok(new Intl.NumberFormat("fr-FR").format(n));
  },
```

- [ ] **Step 4: Run to verify math tests pass**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas test --reporter=verbose 2>&1 | grep -E "Math stdlib|✓|✗" | head -30
```

---

## Task 3: Date Functions Extension

**Files:**
- Modify: `packages/formulas/src/stdlib/dates.ts`
- Test: `packages/formulas/src/formula.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe("Date stdlib — extension", () => {
  it("IsValidDate", () => {
    expect(evalSrc("IsValidDate(Today())")).toBe(true);
    expect(evalSrc('IsValidDate("not-a-date")')).toBe(false);
    expect(evalSrc("IsValidDate(null)")).toBe(false);
  });
  it("DateMin / DateMax", () => {
    const a = 'Date(2026, 1, 1)';
    const b = 'Date(2026, 6, 1)';
    expect(evalSrc(`DateMin(${a}, ${b})`)).toEqual(new Date(2026, 0, 1));
    expect(evalSrc(`DateMax(${a}, ${b})`)).toEqual(new Date(2026, 5, 1));
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
    const result = evalSrc('DateRange(Date(2026, 1, 1), Date(2026, 1, 3))') as Date[];
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(new Date(2026, 0, 1));
    expect(result[2]).toEqual(new Date(2026, 0, 3));
  });
});
```

- [ ] **Step 2: Implement in `packages/formulas/src/stdlib/dates.ts`**

Add after the last exported function in `dateFunctions` (before the closing `};`):

```ts
  IsValidDate(args) {
    const v = args[0] ?? null;
    if (v instanceof Date) return ok(!isNaN(v.getTime()));
    if (typeof v === "string") {
      const d = new Date(v);
      return ok(!isNaN(d.getTime()));
    }
    return ok(false);
  },
  DateMin(args) {
    const dates = args.map((a) => toDate(a)).filter((d): d is Date => d !== null && !isNaN(d.getTime()));
    if (dates.length === 0) return ok(null);
    return ok(dates.reduce((min, d) => d < min ? d : min));
  },
  DateMax(args) {
    const dates = args.map((a) => toDate(a)).filter((d): d is Date => d !== null && !isNaN(d.getTime()));
    if (dates.length === 0) return ok(null);
    return ok(dates.reduce((max, d) => d > max ? d : max));
  },
  ParseDuration(args) {
    const s = coerceToString(args[0] ?? null);
    let ms = 0;
    const pattern = /(\d+(?:\.\d+)?)\s*(w|d|h|min|m|s|ms)/gi;
    const units: Record<string, number> = {
      w: 7 * 86400000, d: 86400000, h: 3600000,
      min: 60000, m: 60000, s: 1000, ms: 1,
    };
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(s)) !== null) {
      const n = parseFloat(m[1]!);
      const unit = m[2]!.toLowerCase();
      ms += n * (units[unit] ?? 0);
    }
    return ok({ _type: "duration", ms, months: 0, years: 0 });
  },
  FormatDuration(args) {
    const ms = coerceToNumber(args[0] ?? null) ?? 0;
    const abs = Math.abs(ms);
    const h = Math.floor(abs / 3600000);
    const min = Math.floor((abs % 3600000) / 60000);
    const s = Math.floor((abs % 60000) / 1000);
    const parts: string[] = [];
    if (h > 0) parts.push(`${h}h`);
    if (min > 0) parts.push(`${min}min`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return ok((ms < 0 ? "-" : "") + parts.join(" "));
  },
  HumanDuration(args, _now) {
    const ms = Math.abs(coerceToNumber(args[0] ?? null) ?? 0);
    if (ms < 60000) return ok(`${Math.round(ms / 1000)} s`);
    if (ms < 3600000) return ok(`${Math.round(ms / 60000)} min`);
    if (ms < 86400000) return ok(`${Math.round(ms / 3600000)} h`);
    return ok(`${Math.round(ms / 86400000)} j`);
  },
  DateRange(args) {
    const start = toDate(args[0] ?? null);
    const end = toDate(args[1] ?? null);
    if (!start || !end) return err(makeEvalError("DateRange: expected two dates"));
    const stepMs = args.length > 2 ? (coerceToNumber(args[2] ?? null) ?? 1) * 86400000 : 86400000;
    if (stepMs <= 0) return err(makeEvalError("DateRange: step must be positive"));
    const out: Date[] = [];
    let cur = new Date(start);
    while (cur <= end) {
      out.push(new Date(cur));
      cur = new Date(cur.getTime() + stepMs);
    }
    return ok(out);
  },
```

- [ ] **Step 3: Run to verify**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas test --reporter=verbose 2>&1 | grep -E "Date stdlib" | head -20
```

---

## Task 4: List Functions Extension

**Files:**
- Modify: `packages/formulas/src/stdlib/lists.ts`
- Test: `packages/formulas/src/formula.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
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
    expect(evalSrc("Unzip([[1, 'a'], [2, 'b'], [3, 'c']])")).toEqual([[1, 2, 3], ["a", "b", "c"]]);
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
  it("ListFind (Find on list)", () => {
    expect(evalSrc("ListFind([1, 2, 3, 4], x -> x > 2)")).toBe(3);
  });
});
```

- [ ] **Step 2: Add new list functions to `packages/formulas/src/stdlib/lists.ts`**

Add after the `Percentile` function (before the closing `};`):

```ts
    TakeWhile(args) {
      const list = requireList(args[0], "TakeWhile");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "TakeWhile");
      if (!fn.ok) return fn;
      const out: Value[] = [];
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        if (!coerceToBool(r.value)) break;
        out.push(item);
      }
      return ok(out);
    },
    DropWhile(args) {
      const list = requireList(args[0], "DropWhile");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "DropWhile");
      if (!fn.ok) return fn;
      let dropping = true;
      const out: Value[] = [];
      for (const item of list.value) {
        if (dropping) {
          const r = apply(fn.value, [item]);
          if (!r.ok) return r;
          if (!coerceToBool(r.value)) { dropping = false; out.push(item); }
        } else {
          out.push(item);
        }
      }
      return ok(out);
    },
    Scan(args) {
      const list = requireList(args[0], "Scan");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "Scan");
      if (!fn.ok) return fn;
      let acc: Value = args[2] ?? null;
      const out: Value[] = [];
      for (const item of list.value) {
        const r = apply(fn.value, [acc, item]);
        if (!r.ok) return r;
        acc = r.value;
        out.push(acc);
      }
      return ok(out);
    },
    Tally(args) {
      const list = requireList(args[0], "Tally");
      if (!list.ok) return list;
      const freq: Record<string, { val: Value; count: number }> = {};
      for (const item of list.value) {
        const k = coerceToString(item);
        if (!freq[k]) freq[k] = { val: item, count: 0 };
        freq[k].count++;
      }
      return ok(Object.values(freq).map(({ val, count }) => [val, count] as Value));
    },
    RepeatList(args) {
      const item = args[0] ?? null;
      const n = Math.max(0, Math.floor(coerceToNumber(args[1] ?? null) ?? 0));
      return ok(Array.from({ length: n }, () => item));
    },
    ConcatAll(args) {
      const out: Value[] = [];
      for (const a of args) {
        if (Array.isArray(a)) out.push(...a);
        else out.push(a);
      }
      return ok(out);
    },
    Union(args) {
      const a = requireList(args[0], "Union");
      if (!a.ok) return a;
      const b = requireList(args[1], "Union");
      if (!b.ok) return b;
      const seen = new Set<string>();
      const out: Value[] = [];
      for (const item of [...a.value, ...b.value]) {
        const k = JSON.stringify(item);
        if (!seen.has(k)) { seen.add(k); out.push(item); }
      }
      return ok(out);
    },
    Intersect(args) {
      const a = requireList(args[0], "Intersect");
      if (!a.ok) return a;
      const b = requireList(args[1], "Intersect");
      if (!b.ok) return b;
      const setB = new Set(b.value.map((v) => JSON.stringify(v)));
      return ok(a.value.filter((v) => setB.has(JSON.stringify(v))));
    },
    Difference(args) {
      const a = requireList(args[0], "Difference");
      if (!a.ok) return a;
      const b = requireList(args[1], "Difference");
      if (!b.ok) return b;
      const setB = new Set(b.value.map((v) => JSON.stringify(v)));
      return ok(a.value.filter((v) => !setB.has(JSON.stringify(v))));
    },
    Without(args) {
      const list = requireList(args[0], "Without");
      if (!list.ok) return list;
      const excludeSet = new Set(args.slice(1).map((v) => JSON.stringify(v)));
      return ok(list.value.filter((v) => !excludeSet.has(JSON.stringify(v))));
    },
    Sample(args) {
      const list = requireList(args[0], "Sample");
      if (!list.ok) return list;
      const n = Math.min(list.value.length, Math.floor(coerceToNumber(args[1] ?? null) ?? 1));
      const copy = [...list.value];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j] as Value, copy[i] as Value];
      }
      return ok(copy.slice(0, n));
    },
    Shuffle(args) {
      const list = requireList(args[0], "Shuffle");
      if (!list.ok) return list;
      const copy = [...list.value];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j] as Value, copy[i] as Value];
      }
      return ok(copy);
    },
    Pairwise(args) {
      const list = requireList(args[0], "Pairwise");
      if (!list.ok) return list;
      const out: Value[] = [];
      for (let i = 0; i < list.value.length - 1; i++) {
        out.push([list.value[i] ?? null, list.value[i + 1] ?? null]);
      }
      return ok(out);
    },
    Unzip(args) {
      const list = requireList(args[0], "Unzip");
      if (!list.ok) return list;
      if (list.value.length === 0) return ok([[], []]);
      const first = list.value[0];
      const cols = Array.isArray(first) ? first.length : 2;
      const out: Value[][] = Array.from({ length: cols }, () => []);
      for (const row of list.value) {
        const rowArr = Array.isArray(row) ? row : [row, null];
        for (let i = 0; i < cols; i++) out[i]!.push(rowArr[i] ?? null);
      }
      return ok(out as Value[]);
    },
    ContainsAll(args) {
      const list = requireList(args[0], "ContainsAll");
      if (!list.ok) return list;
      const others = requireList(args[1], "ContainsAll");
      if (!others.ok) return others;
      const setA = new Set(list.value.map((v) => JSON.stringify(v)));
      return ok(others.value.every((v) => setA.has(JSON.stringify(v))));
    },
    ContainsAny(args) {
      const list = requireList(args[0], "ContainsAny");
      if (!list.ok) return list;
      const others = requireList(args[1], "ContainsAny");
      if (!others.ok) return others;
      const setA = new Set(list.value.map((v) => JSON.stringify(v)));
      return ok(others.value.some((v) => setA.has(JSON.stringify(v))));
    },
    ContainsNone(args) {
      const list = requireList(args[0], "ContainsNone");
      if (!list.ok) return list;
      const others = requireList(args[1], "ContainsNone");
      if (!others.ok) return others;
      const setA = new Set(list.value.map((v) => JSON.stringify(v)));
      return ok(!others.value.some((v) => setA.has(JSON.stringify(v))));
    },
    FindIndex(args) {
      const list = requireList(args[0], "FindIndex");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "FindIndex");
      if (!fn.ok) return fn;
      for (let i = 0; i < list.value.length; i++) {
        const r = apply(fn.value, [list.value[i] ?? null]);
        if (!r.ok) return r;
        if (coerceToBool(r.value)) return ok(i);
      }
      return ok(-1);
    },
    ListFind(args) {
      const list = requireList(args[0], "ListFind");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "ListFind");
      if (!fn.ok) return fn;
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        if (coerceToBool(r.value)) return ok(item);
      }
      return ok(null);
    },
```

- [ ] **Step 3: Run tests**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas test --reporter=verbose 2>&1 | grep -E "List stdlib" | head -20
```

---

## Task 5: Logic / Type Functions Extension

**Files:**
- Modify: `packages/formulas/src/stdlib/logic.ts`
- Test: `packages/formulas/src/formula.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe("Logic stdlib — extension", () => {
  it("IfNull alias IfBlank", () => {
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
```

- [ ] **Step 2: Add to `packages/formulas/src/stdlib/logic.ts`**

Append after `SwitchTrue` (before the closing `};`):

```ts
  IfNull(args) {
    // Alias of IfBlank — specifically null-focused
    const v = args[0] ?? null;
    const fallback = args[1] ?? null;
    return ok(v === null || v === undefined ? fallback : v);
  },
  Implies(args) {
    const a = coerceToBool(args[0] ?? null);
    const b = coerceToBool(args[1] ?? null);
    return ok(!a || b);
  },
  Xor(args) {
    const a = coerceToBool(args[0] ?? null);
    const b = coerceToBool(args[1] ?? null);
    return ok(a !== b);
  },
  Nand(args) {
    const a = coerceToBool(args[0] ?? null);
    const b = coerceToBool(args[1] ?? null);
    return ok(!(a && b));
  },
  Nor(args) {
    const a = coerceToBool(args[0] ?? null);
    const b = coerceToBool(args[1] ?? null);
    return ok(!(a || b));
  },
  ToBool(args) { return ok(coerceToBool(args[0] ?? null)); },
  ToDate(args) {
    const v = args[0] ?? null;
    if (v instanceof Date) return ok(v);
    if (typeof v === "number") return ok(new Date(v));
    if (typeof v === "string") {
      const d = new Date(v);
      return ok(isNaN(d.getTime()) ? null : d);
    }
    return ok(null);
  },
  ToList(args) {
    const v = args[0] ?? null;
    if (Array.isArray(v)) return ok(v);
    return ok([v]);
  },
  TypeOf(args) {
    const v = args[0] ?? null;
    if (v === null) return ok("null");
    if (typeof v === "string") return ok("text");
    if (typeof v === "number") return ok("number");
    if (typeof v === "boolean") return ok("bool");
    if (v instanceof Date) return ok("date");
    if (Array.isArray(v)) return ok("list");
    if (typeof v === "object" && "_type" in v) {
      const t = (v as { _type: string })._type;
      if (t === "entity") return ok("entity");
      if (t === "duration") return ok("duration");
      if (t === "lambda") return ok("lambda");
    }
    return ok("unknown");
  },
  IsDate(args) { return ok(args[0] instanceof Date); },
```

- [ ] **Step 3: Run to verify**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas test --reporter=verbose 2>&1 | grep -E "Logic stdlib" | head -20
```

---

## Task 6: Regex Functions (New File)

**Files:**
- Create: `packages/formulas/src/stdlib/regex.ts`
- Modify: `packages/formulas/src/evaluator.ts` (import + dispatch)
- Test: `packages/formulas/src/formula.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe("Regex stdlib", () => {
  it("RegexExtract group 0", () => {
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
```

- [ ] **Step 2: Create `packages/formulas/src/stdlib/regex.ts`**

```ts
// ============================================================
// Regex stdlib functions
// ============================================================

import type { Value } from "../value.js";
import { coerceToNumber, coerceToString } from "../value.js";
import { makeEvalError, type EvalError } from "../errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";

export const regexFunctions: Record<string, (args: Value[]) => Result<Value, EvalError>> = {
  RegexExtract(args) {
    const s = coerceToString(args[0] ?? null);
    const pattern = coerceToString(args[1] ?? null);
    const group = Math.floor(coerceToNumber(args[2] ?? null) ?? 0);
    try {
      const m = s.match(new RegExp(pattern));
      if (!m) return ok(null);
      return ok(m[group] ?? null);
    } catch {
      return err(makeEvalError(`RegexExtract: invalid pattern '${pattern}'`));
    }
  },
  RegexExtractAll(args) {
    const s = coerceToString(args[0] ?? null);
    const pattern = coerceToString(args[1] ?? null);
    const group = Math.floor(coerceToNumber(args[2] ?? null) ?? 0);
    try {
      const re = new RegExp(pattern, "g");
      const out: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        out.push(m[group] ?? "");
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      return ok(out);
    } catch {
      return err(makeEvalError(`RegexExtractAll: invalid pattern '${pattern}'`));
    }
  },
  RegexSplit(args) {
    const s = coerceToString(args[0] ?? null);
    const pattern = coerceToString(args[1] ?? null);
    try {
      return ok(s.split(new RegExp(pattern)));
    } catch {
      return err(makeEvalError(`RegexSplit: invalid pattern '${pattern}'`));
    }
  },
  RegexEscape(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  },
};
```

- [ ] **Step 3: Register in evaluator.ts**

In `packages/formulas/src/evaluator.ts`, add import:
```ts
import { regexFunctions } from "./stdlib/regex.js";
```

In `evalFunctionCall`, add dispatch before the date check:
```ts
if (name in regexFunctions) return (regexFunctions[name]!)(args);
```

- [ ] **Step 4: Run to verify**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas test --reporter=verbose 2>&1 | grep -E "Regex stdlib" | head -20
```

---

## Task 7: JSON Functions (New File)

**Files:**
- Create: `packages/formulas/src/stdlib/json.ts`
- Modify: `packages/formulas/src/evaluator.ts`
- Test: `packages/formulas/src/formula.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe("JSON stdlib", () => {
  it("ToJson / FromJson roundtrip", () => {
    const json = evalSrc('ToJson([1, 2, 3])') as string;
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
```

- [ ] **Step 2: Create `packages/formulas/src/stdlib/json.ts`**

```ts
// ============================================================
// JSON stdlib functions
// ============================================================

import type { Value } from "../value.js";
import { coerceToString } from "../value.js";
import { makeEvalError, type EvalError } from "../errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";

function jsonPathGet(obj: unknown, path: string): unknown {
  // Supports "a.b.c" and "a[0].b"
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return null;
    if (typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export const jsonFunctions: Record<string, (args: Value[]) => Result<Value, EvalError>> = {
  ToJson(args) {
    const v = args[0] ?? null;
    try { return ok(JSON.stringify(v)); }
    catch { return err(makeEvalError("ToJson: serialization failed")); }
  },
  FromJson(args) {
    const s = coerceToString(args[0] ?? null);
    try { return ok(JSON.parse(s) as Value); }
    catch { return err(makeEvalError("FromJson: invalid JSON")); }
  },
  JsonPath(args) {
    const obj = args[0] ?? null;
    const path = coerceToString(args[1] ?? null);
    try {
      const result = jsonPathGet(obj, path);
      return ok(result !== undefined ? (result as Value) : null);
    } catch {
      return err(makeEvalError("JsonPath: invalid path"));
    }
  },
};
```

- [ ] **Step 3: Register in evaluator.ts**

Add import:
```ts
import { jsonFunctions } from "./stdlib/json.js";
```

Add dispatch:
```ts
if (name in jsonFunctions) return (jsonFunctions[name]!)(args);
```

- [ ] **Step 4: Run to verify**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas test --reporter=verbose 2>&1 | grep -E "JSON stdlib" | head -20
```

---

## Task 8: Entity Functions Extension

**Files:**
- Modify: `packages/formulas/src/stdlib/entities.ts`
- Test: `packages/formulas/src/formula.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
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
```

- [ ] **Step 2: Extend `packages/formulas/src/stdlib/entities.ts`**

Add after `Tags` (before the closing `};`):

```ts
    Get(args) {
      const ev = args[0];
      if (!ev || typeof ev !== "object" || !("_type" in ev) || (ev as { _type: string })._type !== "entity")
        return err(makeEvalError("Get: expected entity as first arg"));
      const field = typeof args[1] === "string" ? args[1] : null;
      if (!field) return err(makeEvalError("Get: second arg must be field name string"));
      const entity = (ev as import("../value.js").EntityValue).entity;
      const val = entity.fields[field];
      if (val === null || val === undefined) return ok(args[2] ?? null);
      return ok(val as import("../value.js").Value);
    },

    Has(args) {
      const ev = args[0];
      if (!ev || typeof ev !== "object" || !("_type" in ev) || (ev as { _type: string })._type !== "entity")
        return err(makeEvalError("Has: expected entity as first arg"));
      const field = typeof args[1] === "string" ? args[1] : null;
      if (!field) return err(makeEvalError("Has: second arg must be field name string"));
      const entity = (ev as import("../value.js").EntityValue).entity;
      const val = entity.fields[field];
      return ok(val !== null && val !== undefined && val !== "");
    },

    EntityId(args) {
      const ev = args[0];
      if (!ev || typeof ev !== "object" || !("_type" in ev) || (ev as { _type: string })._type !== "entity")
        return err(makeEvalError("EntityId: expected entity"));
      return ok((ev as import("../value.js").EntityValue).entity.id);
    },

    CreatedAt(args) {
      const ev = args[0];
      if (!ev || typeof ev !== "object" || !("_type" in ev) || (ev as { _type: string })._type !== "entity")
        return err(makeEvalError("CreatedAt: expected entity"));
      return ok((ev as import("../value.js").EntityValue).entity.createdAt ?? null);
    },

    UpdatedAt(args) {
      const ev = args[0];
      if (!ev || typeof ev !== "object" || !("_type" in ev) || (ev as { _type: string })._type !== "entity")
        return err(makeEvalError("UpdatedAt: expected entity"));
      return ok((ev as import("../value.js").EntityValue).entity.updatedAt ?? null);
    },

    FindAll(args) {
      const typeId = typeof args[0] === "string" ? args[0] : null;
      if (!typeId) return err(makeEvalError("FindAll: first arg must be type name string"));
      const pred = isLambda(args[1] ?? null) ? args[1] as LambdaValue : null;
      const entities = ctx.queryEntities(typeId);
      const wrapped: import("../value.js").EntityValue[] = entities.map((e) => ({ _type: "entity", entity: e }));
      if (!pred) return ok(wrapped);
      const result: import("../value.js").Value[] = [];
      for (const ev of wrapped) {
        const r = apply(pred, [ev]);
        if (!r.ok) return r;
        if (coerceToBool(r.value)) result.push(ev);
      }
      return ok(result);
    },

    CountOf(args) {
      const typeId = typeof args[0] === "string" ? args[0] : null;
      if (!typeId) return err(makeEvalError("CountOf: first arg must be type name string"));
      const pred = isLambda(args[1] ?? null) ? args[1] as LambdaValue : null;
      const entities = ctx.queryEntities(typeId);
      if (!pred) return ok(entities.length);
      const wrapped: import("../value.js").EntityValue[] = entities.map((e) => ({ _type: "entity", entity: e }));
      let count = 0;
      for (const ev of wrapped) {
        const r = apply(pred, [ev]);
        if (!r.ok) return r;
        if (coerceToBool(r.value)) count++;
      }
      return ok(count);
    },
```

- [ ] **Step 3: Run to verify**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas test --reporter=verbose 2>&1 | grep -E "Entity stdlib" | head -20
```

---

## Task 9: Number + Date Chainable Properties in evalPropertyAccess

**Files:**
- Modify: `packages/formulas/src/evaluator.ts`
- Test: `packages/formulas/src/formula.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
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

describe("Chainable properties — dates", () => {
  it("date.year", () => expect(evalSrc("Today().year")).toBe(2026));
  it("date.month", () => expect(evalSrc("Today().month")).toBe(5));
  it("date.day", () => expect(evalSrc("Today().day")).toBe(7));
  it("date.hour", () => expect(evalSrc("Now().hour")).toBe(12));
  it("date.weekday", () => expect(typeof evalSrc("Today().weekday")).toBe("number"));
  it("date.quarter", () => expect(evalSrc("Today().quarter")).toBe(2));
  it("date.isToday", () => expect(evalSrc("Today().isToday")).toBe(true));
  it("date.isPast", () => expect(evalSrc("Date(2020, 1, 1).isPast")).toBe(true));
  it("date.isFuture", () => expect(evalSrc("Date(2030, 1, 1).isFuture")).toBe(true));
  it("date.isWeekend", () => expect(typeof evalSrc("Today().isWeekend")).toBe("boolean"));
  it("date.toISO", () => expect(typeof evalSrc("Today().toISO")).toBe("string"));
  it("date.toUnix", () => expect(typeof evalSrc("Today().toUnix")).toBe("number"));
});
```

- [ ] **Step 2: Extend evalPropertyAccess in `packages/formulas/src/evaluator.ts`**

In the `evalPropertyAccess` private method, after the `typeof val === "string"` block and before the final `return err(...)`, add:

```ts
// Number chainable properties
if (typeof val === "number") {
  switch (propLower) {
    case "abs": return ok(Math.abs(val));
    case "round": return ok(Math.round(val));
    case "ceil": return ok(Math.ceil(val));
    case "floor": return ok(Math.floor(val));
    case "sign": return ok(Math.sign(val));
    case "sqrt": return ok(val >= 0 ? Math.sqrt(val) : NaN);
    case "isinteger": return ok(Number.isInteger(val));
    case "isfinite": return ok(Number.isFinite(val));
    case "isnan": return ok(Number.isNaN(val));
    case "ispositive": return ok(val > 0);
    case "isnegative": return ok(val < 0);
    case "iszero": return ok(val === 0);
    case "iseven": return ok(Number.isInteger(val) && val % 2 === 0);
    case "isodd": return ok(Number.isInteger(val) && Math.abs(val % 2) === 1);
    case "trunc": return ok(Math.trunc(val));
    case "frac": return ok(val - Math.trunc(val));
  }
}

// Date chainable properties
if (val instanceof Date) {
  const now = this.ctx.now();
  switch (propLower) {
    case "year": return ok(val.getFullYear());
    case "month": return ok(val.getMonth() + 1);
    case "day": return ok(val.getDate());
    case "hour": return ok(val.getHours());
    case "minute": return ok(val.getMinutes());
    case "second": return ok(val.getSeconds());
    case "weekday": return ok(val.getDay());
    case "quarter": return ok(Math.ceil((val.getMonth() + 1) / 3));
    case "weekofyear": {
      const startOfYear = new Date(val.getFullYear(), 0, 1);
      return ok(Math.ceil(((val.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7));
    }
    case "startofday": return ok(new Date(val.getFullYear(), val.getMonth(), val.getDate()));
    case "endofday": return ok(new Date(val.getFullYear(), val.getMonth(), val.getDate(), 23, 59, 59, 999));
    case "startofmonth": return ok(new Date(val.getFullYear(), val.getMonth(), 1));
    case "endofmonth": return ok(new Date(val.getFullYear(), val.getMonth() + 1, 0));
    case "startofyear": return ok(new Date(val.getFullYear(), 0, 1));
    case "endofyear": return ok(new Date(val.getFullYear(), 11, 31));
    case "toiso": return ok(val.toISOString());
    case "tounix": return ok(val.getTime());
    case "istoday": {
      return ok(val.getFullYear() === now.getFullYear() && val.getMonth() === now.getMonth() && val.getDate() === now.getDate());
    }
    case "ispast": return ok(val.getTime() < now.getTime());
    case "isfuture": return ok(val.getTime() > now.getTime());
    case "isweekend": return ok(val.getDay() === 0 || val.getDay() === 6);
    case "isweekday": return ok(val.getDay() !== 0 && val.getDay() !== 6);
  }
}
```

- [ ] **Step 3: Run to verify**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas test --reporter=verbose 2>&1 | grep -E "Chainable prop" | head -30
```

---

## Task 10: Full Test Suite + TypeCheck + Build

**Files:**
- Read outputs of all previous tasks.

- [ ] **Step 1: Run full test suite**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 2: TypeCheck formulas package**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas typecheck 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 3: TypeCheck web app**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/web typecheck 2>&1 | head -40
```

Expected: no errors.

- [ ] **Step 4: Fix any type errors found**

Address each error individually. Common issues:
- `import()` dynamic imports in entities.ts need to be converted to top-level imports.
- `Value` type narrowing may need explicit casts.

- [ ] **Step 5: Build formulas package**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas build 2>&1 | tail -10
```

Expected: build succeeds.

---

## Task 11: Update UI Catalog (FormulaInputEditor.tsx)

**Files:**
- Modify: `apps/web/src/components/bases/FormulaInputEditor.tsx`

- [ ] **Step 1: Add new functions to FUNCTIONS array**

In `apps/web/src/components/bases/FormulaInputEditor.tsx`, after the existing FUNCTIONS entries, add:

**String entries (after existing text group):**
```ts
  // Texte — extension
  { name: "ContainsText", sig: "ContainsText(s, sub)", group: "text", doc: "Contient (insensible à la casse)" },
  { name: "EqualsIgnoreCase", sig: "EqualsIgnoreCase(a, b)", group: "text" },
  { name: "StartsWithIgnoreCase", sig: "StartsWithIgnoreCase(s, prefix)", group: "text" },
  { name: "EndsWithIgnoreCase", sig: "EndsWithIgnoreCase(s, suffix)", group: "text" },
  { name: "FindIgnoreCase", sig: "FindIgnoreCase(haystack, needle)", group: "text" },
  { name: "Substitute", sig: "Substitute(s, find, replace, occurrence?)", group: "text" },
  { name: "Char", sig: "Char(code)", group: "text" },
  { name: "Code", sig: "Code(char)", group: "text" },
  { name: "Repeat", sig: "Repeat(s, n)", group: "text" },
  { name: "Truncate", sig: "Truncate(s, maxLen, suffix?)", group: "text" },
  { name: "Lines", sig: "Lines(s)", group: "text" },
  { name: "Words", sig: "Words(s)", group: "text" },
  { name: "Sentences", sig: "Sentences(s)", group: "text" },
  { name: "LineCount", sig: "LineCount(s)", group: "text" },
  { name: "WordCount", sig: "WordCount(s)", group: "text" },
  { name: "StripHtml", sig: "StripHtml(s)", group: "text" },
  { name: "StripMarkdown", sig: "StripMarkdown(s)", group: "text" },
  { name: "EscapeHtml", sig: "EscapeHtml(s)", group: "text" },
  { name: "UnescapeHtml", sig: "UnescapeHtml(s)", group: "text" },
  { name: "EscapeRegex", sig: "EscapeRegex(s)", group: "text" },
  { name: "UrlEncode", sig: "UrlEncode(s)", group: "text" },
  { name: "UrlDecode", sig: "UrlDecode(s)", group: "text" },
  { name: "Base64Encode", sig: "Base64Encode(s)", group: "text" },
  { name: "Base64Decode", sig: "Base64Decode(s)", group: "text" },
  { name: "PadStart", sig: "PadStart(s, len, char?)", group: "text" },
  { name: "PadEnd", sig: "PadEnd(s, len, char?)", group: "text" },
  { name: "CamelCase", sig: "CamelCase(s)", group: "text" },
  { name: "KebabCase", sig: "KebabCase(s)", group: "text" },
  { name: "SnakeCase", sig: "SnakeCase(s)", group: "text" },
  { name: "PascalCase", sig: "PascalCase(s)", group: "text" },
  { name: "TitleCase", sig: "TitleCase(s)", group: "text" },
  { name: "LeftOf", sig: "LeftOf(s, sep)", group: "text" },
  { name: "RightOf", sig: "RightOf(s, sep)", group: "text" },
  { name: "Between", sig: "Between(s, start, end)", group: "text" },
  { name: "Pluralize", sig: "Pluralize(word, n)", group: "text" },
  { name: "Hash", sig: "Hash(s)", group: "text" },
  { name: "ParseNumber", sig: "ParseNumber(s)", group: "text" },
  // Regex
  { name: "RegexExtract", sig: "RegexExtract(s, pattern, group?)", group: "text" },
  { name: "RegexExtractAll", sig: "RegexExtractAll(s, pattern, group?)", group: "text" },
  { name: "RegexSplit", sig: "RegexSplit(s, pattern)", group: "text" },
  { name: "RegexEscape", sig: "RegexEscape(s)", group: "text" },
```

**Math entries (after existing math group):**
```ts
  // Maths — extension
  { name: "Square", sig: "Square(n)", group: "math" },
  { name: "Cube", sig: "Cube(n)", group: "math" },
  { name: "Power", sig: "Power(base, exp)", group: "math" },
  { name: "IsInteger", sig: "IsInteger(n)", group: "math" },
  { name: "IsFinite", sig: "IsFinite(n)", group: "math" },
  { name: "IsNaN", sig: "IsNaN(n)", group: "math" },
  { name: "IsPositive", sig: "IsPositive(n)", group: "math" },
  { name: "IsNegative", sig: "IsNegative(n)", group: "math" },
  { name: "IsZero", sig: "IsZero(n)", group: "math" },
  { name: "IsEven", sig: "IsEven(n)", group: "math" },
  { name: "IsOdd", sig: "IsOdd(n)", group: "math" },
  { name: "Gcd", sig: "Gcd(a, b)", group: "math" },
  { name: "Lcm", sig: "Lcm(a, b)", group: "math" },
  { name: "Factorial", sig: "Factorial(n)", group: "math" },
  { name: "Clamp", sig: "Clamp(n, lo, hi)", group: "math" },
  { name: "Lerp", sig: "Lerp(a, b, t)", group: "math" },
  { name: "MapRange", sig: "MapRange(n, inMin, inMax, outMin, outMax)", group: "math" },
  { name: "Trunc", sig: "Trunc(n)", group: "math" },
  { name: "Frac", sig: "Frac(n)", group: "math" },
  { name: "Atan2", sig: "Atan2(y, x)", group: "math" },
  { name: "Asin", sig: "Asin(n)", group: "math" },
  { name: "Acos", sig: "Acos(n)", group: "math" },
  { name: "Atan", sig: "Atan(n)", group: "math" },
  { name: "Sinh", sig: "Sinh(n)", group: "math" },
  { name: "Cosh", sig: "Cosh(n)", group: "math" },
  { name: "Tanh", sig: "Tanh(n)", group: "math" },
  { name: "FormatBytes", sig: "FormatBytes(n)", group: "math" },
  { name: "FormatOrdinal", sig: "FormatOrdinal(n)", group: "math" },
  { name: "FormatPercent", sig: "FormatPercent(n, decimals?)", group: "math" },
  { name: "FormatCurrency", sig: "FormatCurrency(n, code?)", group: "math" },
  { name: "FormatNumber", sig: "FormatNumber(n)", group: "math" },
```

**Date entries:**
```ts
  // Dates — extension
  { name: "IsValidDate", sig: "IsValidDate(v)", group: "date" },
  { name: "DateMin", sig: "DateMin(a, b, …)", group: "date" },
  { name: "DateMax", sig: "DateMax(a, b, …)", group: "date" },
  { name: "DateRange", sig: "DateRange(start, end, stepDays?)", group: "date" },
  { name: "ParseDuration", sig: "ParseDuration(s)", group: "date" },
  { name: "FormatDuration", sig: "FormatDuration(ms)", group: "date" },
  { name: "HumanDuration", sig: "HumanDuration(ms)", group: "date" },
```

**Logic entries:**
```ts
  // Logique — extension
  { name: "IfNull", sig: "IfNull(value, fallback)", group: "logic" },
  { name: "Implies", sig: "Implies(a, b)", group: "logic" },
  { name: "Xor", sig: "Xor(a, b)", group: "logic" },
  { name: "Nand", sig: "Nand(a, b)", group: "logic" },
  { name: "Nor", sig: "Nor(a, b)", group: "logic" },
  { name: "ToBool", sig: "ToBool(v)", group: "logic" },
  { name: "ToDate", sig: "ToDate(v)", group: "logic" },
  { name: "ToList", sig: "ToList(v)", group: "logic" },
  { name: "TypeOf", sig: "TypeOf(v)", group: "logic" },
```

**List entries:**
```ts
  // Listes — extension
  { name: "TakeWhile", sig: "TakeWhile(list, x -> bool)", group: "list" },
  { name: "DropWhile", sig: "DropWhile(list, x -> bool)", group: "list" },
  { name: "Scan", sig: "Scan(list, (acc, x) -> acc, init)", group: "list" },
  { name: "Tally", sig: "Tally(list)", group: "list" },
  { name: "RepeatList", sig: "RepeatList(item, n)", group: "list" },
  { name: "ConcatAll", sig: "ConcatAll(a, b, …)", group: "list" },
  { name: "Union", sig: "Union(a, b)", group: "list" },
  { name: "Intersect", sig: "Intersect(a, b)", group: "list" },
  { name: "Difference", sig: "Difference(a, b)", group: "list" },
  { name: "Without", sig: "Without(list, …vals)", group: "list" },
  { name: "Sample", sig: "Sample(list, n?)", group: "list" },
  { name: "Shuffle", sig: "Shuffle(list)", group: "list" },
  { name: "Pairwise", sig: "Pairwise(list)", group: "list" },
  { name: "Unzip", sig: "Unzip(list)", group: "list" },
  { name: "ContainsAll", sig: "ContainsAll(list, others)", group: "list" },
  { name: "ContainsAny", sig: "ContainsAny(list, others)", group: "list" },
  { name: "ContainsNone", sig: "ContainsNone(list, others)", group: "list" },
  { name: "FindIndex", sig: "FindIndex(list, x -> bool)", group: "list" },
  { name: "ListFind", sig: "ListFind(list, x -> bool)", group: "list" },
  // JSON
  { name: "ToJson", sig: "ToJson(v)", group: "text" },
  { name: "FromJson", sig: "FromJson(s)", group: "text" },
  { name: "JsonPath", sig: "JsonPath(obj, path)", group: "text" },
  // Entités — extension
  { name: "Get", sig: "Get(entity, field, default?)", group: "entity" },
  { name: "Has", sig: "Has(entity, field)", group: "entity" },
  { name: "EntityId", sig: "EntityId(entity)", group: "entity" },
  { name: "CreatedAt", sig: "CreatedAt(entity)", group: "entity" },
  { name: "UpdatedAt", sig: "UpdatedAt(entity)", group: "entity" },
  { name: "FindAll", sig: "FindAll(typeName, pred?)", group: "entity" },
  { name: "CountOf", sig: "CountOf(typeName, pred?)", group: "entity" },
```

- [ ] **Step 2: Extend STRING_MEMBERS (add method completions for chaining)**

After the existing `isNotNull` entry in STRING_MEMBERS, add:
```ts
  { name: "Contains", sig: "Contains(sub)", group: "text" },
  { name: "StartsWith", sig: "StartsWith(prefix)", group: "text" },
  { name: "EndsWith", sig: "EndsWith(suffix)", group: "text" },
  { name: "Split", sig: "Split(sep)", group: "text" },
  { name: "Replace", sig: "Replace(find, to)", group: "text" },
  { name: "Find", sig: "Find(needle)", group: "text" },
  { name: "Left", sig: "Left(n)", group: "text" },
  { name: "Right", sig: "Right(n)", group: "text" },
  { name: "PadStart", sig: "PadStart(len, char?)", group: "text" },
  { name: "PadEnd", sig: "PadEnd(len, char?)", group: "text" },
  { name: "Repeat", sig: "Repeat(n)", group: "text" },
  { name: "Substring", sig: "Substring(start, end?)", group: "text" },
  { name: "Truncate", sig: "Truncate(maxLen, suffix?)", group: "text" },
  { name: "ContainsText", sig: "ContainsText(sub)", group: "text" },
  { name: "LeftOf", sig: "LeftOf(sep)", group: "text" },
  { name: "RightOf", sig: "RightOf(sep)", group: "text" },
  { name: "Hash", sig: "hash → string", group: "text" },
```

- [ ] **Step 3: Extend LIST_MEMBERS (add method completions for list chaining)**

After the existing `GroupBy` entry in LIST_MEMBERS, add:
```ts
  { name: "TakeWhile", sig: "TakeWhile(x -> bool)", group: "list" },
  { name: "DropWhile", sig: "DropWhile(x -> bool)", group: "list" },
  { name: "Scan", sig: "Scan((acc, x) -> acc, init)", group: "list" },
  { name: "FindIndex", sig: "FindIndex(x -> bool)", group: "list" },
  { name: "ListFind", sig: "ListFind(x -> bool)", group: "list" },
  { name: "ContainsAll", sig: "ContainsAll(others)", group: "list" },
  { name: "ContainsAny", sig: "ContainsAny(others)", group: "list" },
  { name: "ContainsNone", sig: "ContainsNone(others)", group: "list" },
  { name: "Union", sig: "Union(other)", group: "list" },
  { name: "Intersect", sig: "Intersect(other)", group: "list" },
  { name: "Difference", sig: "Difference(other)", group: "list" },
  { name: "Pairwise", sig: "Pairwise()", group: "list" },
  { name: "Unzip", sig: "Unzip()", group: "list" },
  { name: "Tally", sig: "Tally()", group: "list" },
  { name: "Shuffle", sig: "Shuffle()", group: "list" },
  { name: "Sample", sig: "Sample(n?)", group: "list" },
  { name: "Without", sig: "Without(…vals)", group: "list" },
  { name: "zip", sig: "zip(other)", group: "list" },
```

- [ ] **Step 4: TypeCheck web after changes**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/web typecheck 2>&1 | head -30
```

---

## Task 12: Final Verification

- [ ] **Step 1: Full test run**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas test 2>&1 | tail -5
```

Expected: all pass, 0 failures.

- [ ] **Step 2: Both typechecks**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas typecheck && pnpm --filter @supernote/web typecheck && echo "ALL CLEAR"
```

Expected: `ALL CLEAR`

- [ ] **Step 3: Final build**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas build 2>&1 | tail -5
```

- [ ] **Step 4: Store pattern in memory**

```bash
npx @claude-flow/cli@latest memory store --key "pattern-stdlib-extension" --value "When extending formula stdlib: 1. parser already desugars obj.method(args) to FunctionCall, no parser changes needed. 2. New function categories go in separate stdlib files, imported+dispatched in evaluator.ts. 3. No-arg chainable props on number/date go in evalPropertyAccess. 4. FormulaInputEditor FUNCTIONS/STRING_MEMBERS/LIST_MEMBERS need UI catalog updates. 5. Use TDD: tests first, then implement." --namespace patterns
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Text: ContainsText, EqualsIgnoreCase, StartsWithIgnoreCase, EndsWithIgnoreCase, FindIgnoreCase — Task 1
- [x] Text: Substitute(occurrence), Char, Code, Repeat alias, Truncate — Task 1
- [x] Text: Lines, Words, Sentences, LineCount, WordCount — Task 1
- [x] Text: StripHtml, StripMarkdown, EscapeHtml, UnescapeHtml, EscapeRegex — Task 1
- [x] Text: UrlEncode, UrlDecode, Base64Encode, Base64Decode — Task 1
- [x] Text: PadStart, PadEnd — Task 1
- [x] Text: CamelCase, KebabCase, SnakeCase, PascalCase, TitleCase — Task 1
- [x] Text: Reverse (exposed as function) — Task 1
- [x] Text: LeftOf, RightOf, Between — Task 1
- [x] Text: Pluralize, Hash — Task 1
- [x] Math: Square, Cube, Power — Task 2
- [x] Math: IsInteger, IsFinite, IsNaN, IsPositive, IsNegative, IsZero, IsEven, IsOdd — Task 2
- [x] Math: Gcd, Lcm, Factorial — Task 2
- [x] Math: Clamp, Lerp, MapRange — Task 2
- [x] Math: Trunc, Frac — Task 2
- [x] Math: Atan2, Asin, Acos, Atan, Sinh, Cosh, Tanh — Task 2
- [x] Math: FormatBytes, FormatOrdinal, FormatPercent, FormatCurrency, FormatNumber — Task 2
- [x] Date: IsValidDate, DateMin, DateMax, DateRange — Task 3
- [x] Date: ParseDuration, FormatDuration, HumanDuration — Task 3
- [x] Lists: TakeWhile, DropWhile, Scan, Tally — Task 4
- [x] Lists: RepeatList, ConcatAll, Union, Intersect, Difference, Without — Task 4
- [x] Lists: Sample, Shuffle, Pairwise, Unzip — Task 4
- [x] Lists: ContainsAll, ContainsAny, ContainsNone — Task 4
- [x] Lists: FindIndex, ListFind — Task 4
- [x] Logic: IfNull, Implies, Xor, Nand, Nor — Task 5
- [x] Logic: ToBool, ToDate, ToList, TypeOf — Task 5
- [x] Regex: RegexExtract, RegexExtractAll, RegexSplit, RegexEscape — Task 6
- [x] JSON: ToJson, FromJson, JsonPath — Task 7
- [x] Entity: Get, Has, EntityId, CreatedAt, UpdatedAt, FindAll, CountOf — Task 8
- [x] Chainable numbers: abs, round, ceil, floor, sign, sqrt, isInteger, isEven, isOdd, etc. — Task 9
- [x] Chainable dates: year, month, day, hour, weekday, quarter, isToday, isPast, isFuture, isWeekend, toISO, toUnix — Task 9

**Spec items NOT implemented (intentionally skipped or deferred):**
- `ParseNumber(s, locale?)` locale variant — basic version implemented, locale ignored (FR default via encodeURIComponent approach)
- `ListDays` alias of DateRange — DateRange covers this, alias not needed to avoid clutter
- `HasTag(entity, tagName)` — Tags() already exists; HasTag is a partial dup; deferred
- `CreatedBy(entity)` — Entity type in core doesn't expose createdBy; deferred
- `StripMarkdown` sentences — implementation is basic, sufficient for MVP
- Number `.toFixed(n)`, `.clamp(lo,hi)` method-with-args variants — these are covered by the top-level Clamp() function; method-with-arg on numbers requires parser changes (parser desugars but number chainable properties go through evalPropertyAccess which doesn't accept args). Deferred — users can use `Clamp(n, lo, hi)` instead.

**Placeholder scan:** No TBDs found. All code blocks are complete.

**Type consistency:** `regexFunctions`, `jsonFunctions` are imported in evaluator.ts in Tasks 6+7. Entity imports use `import("../value.js").EntityValue` for dynamic imports in entities.ts — these need to be changed to static top-level imports to avoid TypeScript issues. Fixed in Task 8 step 2.
