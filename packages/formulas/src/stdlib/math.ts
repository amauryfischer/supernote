// ============================================================
// Math stdlib functions
// ============================================================

import type { Value } from "../value.js";
import { coerceToNumber } from "../value.js";
import { makeEvalError, type EvalError } from "../errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";

function nums(args: Value[]): Result<number[], EvalError> {
  const result: number[] = [];
  for (const a of args) {
    const n = coerceToNumber(a);
    if (n === null) return err(makeEvalError(`Expected number, got ${typeof a}`));
    result.push(n);
  }
  return ok(result);
}

function flatNums(args: Value[]): Result<number[], EvalError> {
  const all: Value[] = [];
  for (const a of args) {
    if (Array.isArray(a)) all.push(...a);
    else all.push(a);
  }
  return nums(all);
}

export const mathFunctions: Record<string, (args: Value[]) => Result<Value, EvalError>> = {
  Sum(args) {
    const ns = flatNums(args);
    if (!ns.ok) return ns;
    return ok(ns.value.reduce((a, b) => a + b, 0));
  },
  Average(args) {
    const ns = flatNums(args);
    if (!ns.ok) return ns;
    if (ns.value.length === 0) return ok(0);
    return ok(ns.value.reduce((a, b) => a + b, 0) / ns.value.length);
  },
  Min(args) {
    const ns = flatNums(args);
    if (!ns.ok) return ns;
    if (ns.value.length === 0) return ok(null);
    return ok(Math.min(...ns.value));
  },
  Max(args) {
    const ns = flatNums(args);
    if (!ns.ok) return ns;
    if (ns.value.length === 0) return ok(null);
    return ok(Math.max(...ns.value));
  },
  Count(args) {
    if (args.length === 1 && Array.isArray(args[0])) return ok(args[0].length);
    return ok(args.length);
  },
  CountIf(args) {
    const [list, fn] = args;
    if (!Array.isArray(list)) return err(makeEvalError("CountIf: first arg must be a list"));
    if (typeof fn !== "object" || fn === null || !("_type" in fn) || (fn as { _type: string })._type !== "lambda") {
      return err(makeEvalError("CountIf: second arg must be a lambda"));
    }
    // Counted by caller; here we just validate shape and return placeholder
    // The actual lambda application is done in the evaluator
    return err(makeEvalError("CountIf: must be called via evaluator (lambda application required)"));
  },
  Abs(args) {
    if (args.length !== 1) return err(makeEvalError("Abs: expected 1 argument"));
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("Abs: expected number"));
    return ok(Math.abs(n));
  },
  Round(args) {
    if (args.length < 1) return err(makeEvalError("Round: expected at least 1 argument"));
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("Round: expected number"));
    const decimals = args.length > 1 ? coerceToNumber(args[1] ?? null) ?? 0 : 0;
    const factor = Math.pow(10, decimals);
    return ok(Math.round(n * factor) / factor);
  },
  Ceil(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("Ceil: expected number"));
    return ok(Math.ceil(n));
  },
  Floor(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("Floor: expected number"));
    return ok(Math.floor(n));
  },
  Pow(args) {
    if (args.length !== 2) return err(makeEvalError("Pow: expected 2 arguments"));
    const base = coerceToNumber(args[0] ?? null);
    const exp = coerceToNumber(args[1] ?? null);
    if (base === null || exp === null) return err(makeEvalError("Pow: expected numbers"));
    return ok(Math.pow(base, exp));
  },
  Sqrt(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("Sqrt: expected number"));
    if (n < 0) return err(makeEvalError("Sqrt: negative number"));
    return ok(Math.sqrt(n));
  },
  Mod(args) {
    if (args.length !== 2) return err(makeEvalError("Mod: expected 2 arguments"));
    const a = coerceToNumber(args[0] ?? null);
    const b = coerceToNumber(args[1] ?? null);
    if (a === null || b === null) return err(makeEvalError("Mod: expected numbers"));
    if (b === 0) return err(makeEvalError("Mod: division by zero"));
    return ok(((a % b) + b) % b); // always non-negative modulo
  },
  // ── Coda parity ──────────────────────────────────────────────
  Avg(args) {
    const ns = flatNums(args);
    if (!ns.ok) return ns;
    if (ns.value.length === 0) return ok(0);
    return ok(ns.value.reduce((a, b) => a + b, 0) / ns.value.length);
  },
  Median(args) {
    const ns = flatNums(args);
    if (!ns.ok) return ns;
    if (ns.value.length === 0) return ok(null);
    const sorted = [...ns.value].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return ok(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2);
  },
  Product(args) {
    const ns = flatNums(args);
    if (!ns.ok) return ns;
    return ok(ns.value.reduce((a, b) => a * b, 1));
  },
  RoundUp(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("RoundUp: expected number"));
    const d = args.length > 1 ? coerceToNumber(args[1] ?? null) ?? 0 : 0;
    const f = Math.pow(10, d);
    return ok(Math.ceil(n * f) / f);
  },
  RoundDown(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("RoundDown: expected number"));
    const d = args.length > 1 ? coerceToNumber(args[1] ?? null) ?? 0 : 0;
    const f = Math.pow(10, d);
    return ok(Math.floor(n * f) / f);
  },
  Int(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("Int: expected number"));
    return ok(Math.trunc(n));
  },
  Sign(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("Sign: expected number"));
    return ok(Math.sign(n));
  },
  Log(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null || n <= 0) return err(makeEvalError("Log: expected positive number"));
    const base = args.length > 1 ? coerceToNumber(args[1] ?? null) ?? 10 : 10;
    return ok(Math.log(n) / Math.log(base));
  },
  Ln(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null || n <= 0) return err(makeEvalError("Ln: expected positive number"));
    return ok(Math.log(n));
  },
  Exp(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("Exp: expected number"));
    return ok(Math.exp(n));
  },
  Sin(args) { const n = coerceToNumber(args[0] ?? null); return n === null ? err(makeEvalError("Sin: number")) : ok(Math.sin(n)); },
  Cos(args) { const n = coerceToNumber(args[0] ?? null); return n === null ? err(makeEvalError("Cos: number")) : ok(Math.cos(n)); },
  Tan(args) { const n = coerceToNumber(args[0] ?? null); return n === null ? err(makeEvalError("Tan: number")) : ok(Math.tan(n)); },
  PI() { return ok(Math.PI); },
  E() { return ok(Math.E); },
  Random() { return ok(Math.random()); },
  RandomBetween(args) {
    const lo = coerceToNumber(args[0] ?? null);
    const hi = coerceToNumber(args[1] ?? null);
    if (lo === null || hi === null) return err(makeEvalError("RandomBetween: expected numbers"));
    return ok(Math.floor(Math.random() * (hi - lo + 1)) + lo);
  },
  Sequence(args) {
    const start = coerceToNumber(args[0] ?? null) ?? 1;
    const end = coerceToNumber(args[1] ?? null);
    if (end === null) return err(makeEvalError("Sequence: expected end value"));
    const step = args.length > 2 ? coerceToNumber(args[2] ?? null) ?? 1 : 1;
    if (step === 0) return err(makeEvalError("Sequence: step cannot be 0"));
    const out: number[] = [];
    if (step > 0) for (let i = start; i <= end; i += step) out.push(i);
    else for (let i = start; i >= end; i += step) out.push(i);
    return ok(out);
  },
  Variance(args) {
    const ns = flatNums(args);
    if (!ns.ok) return ns;
    const n = ns.value.length;
    if (n === 0) return ok(null);
    const mean = ns.value.reduce((a, b) => a + b, 0) / n;
    const sq = ns.value.reduce((s, v) => s + (v - mean) ** 2, 0);
    return ok(sq / n);
  },
  StdDev(args) {
    const ns = flatNums(args);
    if (!ns.ok) return ns;
    const n = ns.value.length;
    if (n === 0) return ok(null);
    const mean = ns.value.reduce((a, b) => a + b, 0) / n;
    const sq = ns.value.reduce((s, v) => s + (v - mean) ** 2, 0);
    return ok(Math.sqrt(sq / n));
  },
  Quantile(args) {
    if (args.length !== 2) return err(makeEvalError("Quantile: expected (list, q)"));
    const first = args[0];
    if (!Array.isArray(first)) return err(makeEvalError("Quantile: first arg must be a list"));
    const ns = flatNums(first as Value[]);
    if (!ns.ok) return ns;
    if (ns.value.length === 0) return ok(null);
    const q = coerceToNumber(args[1] ?? null) ?? 0;
    const sorted = [...ns.value].sort((a, b) => a - b);
    const pos = q * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return ok(sorted[lo] ?? null);
    const frac = pos - lo;
    return ok((sorted[lo] ?? 0) * (1 - frac) + (sorted[hi] ?? 0) * frac);
  },
};
