// ============================================================
// Logic stdlib functions
// ============================================================

import type { Value } from "../value.js";
import { coerceToBool } from "../value.js";
import { makeEvalError, type EvalError } from "../errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";

export const logicFunctions: Record<string, (args: Value[]) => Result<Value, EvalError>> = {
  /** If(condition, consequent, alternate) */
  If(args) {
    if (args.length < 2) return err(makeEvalError("If: expected at least 2 arguments"));
    const cond = coerceToBool(args[0] ?? null);
    return ok(cond ? (args[1] ?? null) : (args[2] ?? null));
  },
  /** IfElse(cond1, val1, cond2, val2, ..., default) */
  IfElse(args) {
    if (args.length < 2) return err(makeEvalError("IfElse: expected at least 2 arguments"));
    for (let i = 0; i < args.length - 1; i += 2) {
      if (coerceToBool(args[i] ?? null)) return ok(args[i + 1] ?? null);
    }
    return ok(args.length % 2 === 1 ? (args[args.length - 1] ?? null) : null);
  },
  And(args) {
    return ok(args.every(coerceToBool));
  },
  Or(args) {
    return ok(args.some(coerceToBool));
  },
  Not(args) {
    if (args.length !== 1) return err(makeEvalError("Not: expected 1 argument"));
    return ok(!coerceToBool(args[0] ?? null));
  },
  /** Switch(value, case1, result1, case2, result2, ..., default) */
  Switch(args) {
    if (args.length < 3) return err(makeEvalError("Switch: expected at least 3 arguments"));
    const value = args[0];
    for (let i = 1; i < args.length - 1; i += 2) {
      if (value === args[i] || String(value) === String(args[i])) return ok(args[i + 1] ?? null);
    }
    return ok(args.length % 2 === 0 ? (args[args.length - 1] ?? null) : null);
  },
};
