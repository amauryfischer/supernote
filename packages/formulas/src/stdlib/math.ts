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
};
