// ============================================================
// Math stdlib functions
// ============================================================

import type { Value } from "../value.js";
import { coerceToNumber, coerceToString } from "../value.js";
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

  // ── Extension ─────────────────────────────────────────────

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
    if (n === null || n < 0 || !Number.isInteger(n)) {
      return err(makeEvalError("Factorial: expected non-negative integer"));
    }
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
  Asin(args) {
    const n = coerceToNumber(args[0] ?? null);
    return n === null ? err(makeEvalError("Asin: number")) : ok(Math.asin(n));
  },
  Acos(args) {
    const n = coerceToNumber(args[0] ?? null);
    return n === null ? err(makeEvalError("Acos: number")) : ok(Math.acos(n));
  },
  Atan(args) {
    const n = coerceToNumber(args[0] ?? null);
    return n === null ? err(makeEvalError("Atan: number")) : ok(Math.atan(n));
  },
  Sinh(args) {
    const n = coerceToNumber(args[0] ?? null);
    return n === null ? err(makeEvalError("Sinh: number")) : ok(Math.sinh(n));
  },
  Cosh(args) {
    const n = coerceToNumber(args[0] ?? null);
    return n === null ? err(makeEvalError("Cosh: number")) : ok(Math.cosh(n));
  },
  Tanh(args) {
    const n = coerceToNumber(args[0] ?? null);
    return n === null ? err(makeEvalError("Tanh: number")) : ok(Math.tanh(n));
  },
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
};
