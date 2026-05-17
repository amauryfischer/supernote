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
  /** SwitchIf(cond1, val1, cond2, val2, ..., default) — Coda alias of IfElse */
  SwitchIf(args) {
    if (args.length < 2) return err(makeEvalError("SwitchIf: expected at least 2 arguments"));
    for (let i = 0; i < args.length - 1; i += 2) {
      if (coerceToBool(args[i] ?? null)) return ok(args[i + 1] ?? null);
    }
    return ok(args.length % 2 === 1 ? (args[args.length - 1] ?? null) : null);
  },
  IsBlank(args) {
    const v = args[0] ?? null;
    if (v === null || v === undefined) return ok(true);
    if (typeof v === "string") return ok(v.length === 0);
    if (Array.isArray(v)) return ok(v.length === 0);
    return ok(false);
  },
  IsNotBlank(args) {
    const v = args[0] ?? null;
    if (v === null || v === undefined) return ok(false);
    if (typeof v === "string") return ok(v.length > 0);
    if (Array.isArray(v)) return ok(v.length > 0);
    return ok(true);
  },
  /** IfBlank(value, fallback) */
  IfBlank(args) {
    const v = args[0] ?? null;
    const fallback = args[1] ?? null;
    const blank =
      v === null || v === undefined ||
      (typeof v === "string" && v.length === 0) ||
      (Array.isArray(v) && v.length === 0);
    return ok(blank ? fallback : v);
  },
  IsNumber(args) { return ok(typeof args[0] === "number" && !isNaN(args[0])); },
  IsText(args) { return ok(typeof args[0] === "string"); },
  IsList(args) { return ok(Array.isArray(args[0])); },
  IsBoolean(args) { return ok(typeof args[0] === "boolean"); },
  True() { return ok(true); },
  False() { return ok(false); },
  Equal(args) {
    return ok(args[0] === args[1] || String(args[0] ?? "") === String(args[1] ?? ""));
  },
  NotEqual(args) {
    return ok(!(args[0] === args[1] || String(args[0] ?? "") === String(args[1] ?? "")));
  },
  /** Première valeur non-blank dans la liste. */
  Coalesce(args) {
    for (const v of args) {
      if (v !== null && v !== undefined && v !== "") return ok(v);
    }
    return ok(null);
  },
  /** SwitchTrue(cond1, val1, …, default) — alias clair pour IfElse. */
  SwitchTrue(args) {
    if (args.length < 2) return err(makeEvalError("SwitchTrue: expected at least 2 arguments"));
    for (let i = 0; i < args.length - 1; i += 2) {
      if (coerceToBool(args[i] ?? null)) return ok(args[i + 1] ?? null);
    }
    return ok(args.length % 2 === 1 ? (args[args.length - 1] ?? null) : null);
  },

  // ── Extension ─────────────────────────────────────────────

  /** IfNull — alias of IfBlank focused on null */
  IfNull(args) {
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
};
