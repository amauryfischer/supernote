// ============================================================
// List stdlib functions
// Higher-order functions (Map, Filter, etc.) receive a pre-bound
// applyLambda callback from the evaluator so that closures work.
// ============================================================

import type { Value, LambdaValue } from "../value.js";
import { isLambda, coerceToBool, coerceToString, coerceToNumber } from "../value.js";
import { makeEvalError, type EvalError } from "../errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";

export type ApplyFn = (fn: LambdaValue, args: Value[]) => Result<Value, EvalError>;

function requireList(v: Value | undefined, name: string): Result<Value[], EvalError> {
  const val: Value = v ?? null;
  if (!Array.isArray(val)) return err(makeEvalError(`${name}: first arg must be a list`));
  return ok(val);
}

function requireLambda(v: Value | undefined, name: string): Result<LambdaValue, EvalError> {
  const val: Value = v ?? null;
  if (!isLambda(val)) return err(makeEvalError(`${name}: expected a lambda`));
  return ok(val);
}

export function makeListFunctions(apply: ApplyFn): Record<string, (args: Value[]) => Result<Value, EvalError>> {
  return {
    Map(args) {
      const list = requireList(args[0], "Map");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "Map");
      if (!fn.ok) return fn;
      const result: Value[] = [];
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        result.push(r.value);
      }
      return ok(result);
    },

    Filter(args) {
      const list = requireList(args[0], "Filter");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "Filter");
      if (!fn.ok) return fn;
      const result: Value[] = [];
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        if (coerceToBool(r.value)) result.push(item);
      }
      return ok(result);
    },

    Reduce(args) {
      const list = requireList(args[0], "Reduce");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "Reduce");
      if (!fn.ok) return fn;
      let acc: Value = args[2] ?? null;
      for (const item of list.value) {
        const r = apply(fn.value, [acc, item]);
        if (!r.ok) return r;
        acc = r.value;
      }
      return ok(acc);
    },

    Sort(args) {
      const list = requireList(args[0], "Sort");
      if (!list.ok) return list;
      const keyFn = isLambda(args[1] ?? null) ? args[1] as LambdaValue : null;
      const sorted = [...list.value];

      if (keyFn) {
        const pairs: Array<{ item: Value; key: Value }> = [];
        for (const item of sorted) {
          const r = apply(keyFn, [item]);
          if (!r.ok) return r;
          pairs.push({ item, key: r.value });
        }
        pairs.sort((a, b) => {
          const ak = a.key, bk = b.key;
          if (typeof ak === "number" && typeof bk === "number") return ak - bk;
          return coerceToString(ak).localeCompare(coerceToString(bk));
        });
        return ok(pairs.map((p) => p.item));
      }

      sorted.sort((a, b) => {
        if (typeof a === "number" && typeof b === "number") return a - b;
        return coerceToString(a).localeCompare(coerceToString(b));
      });
      return ok(sorted);
    },

    Reverse(args) {
      const list = requireList(args[0], "Reverse");
      if (!list.ok) return list;
      return ok([...list.value].reverse());
    },

    Unique(args) {
      const list = requireList(args[0], "Unique");
      if (!list.ok) return list;
      const seen = new Set<string>();
      return ok(list.value.filter((v) => {
        const key = JSON.stringify(v);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }));
    },

    /** List Concat (different from string Concat) */
    ListConcat(args) {
      const result: Value[] = [];
      for (const a of args) {
        if (Array.isArray(a)) result.push(...a);
        else result.push(a);
      }
      return ok(result);
    },

    First(args) {
      const list = requireList(args[0], "First");
      if (!list.ok) return list;
      return ok(list.value[0] ?? null);
    },

    Last(args) {
      const list = requireList(args[0], "Last");
      if (!list.ok) return list;
      return ok(list.value[list.value.length - 1] ?? null);
    },

    Nth(args) {
      const list = requireList(args[0], "Nth");
      if (!list.ok) return list;
      const n = coerceToNumber(args[1] ?? null) ?? 0;
      return ok(list.value[n] ?? null);
    },

    Take(args) {
      const list = requireList(args[0], "Take");
      if (!list.ok) return list;
      const n = coerceToNumber(args[1] ?? null) ?? 0;
      return ok(list.value.slice(0, n));
    },

    Drop(args) {
      const list = requireList(args[0], "Drop");
      if (!list.ok) return list;
      const n = coerceToNumber(args[1] ?? null) ?? 0;
      return ok(list.value.slice(n));
    },

    GroupBy(args) {
      const list = requireList(args[0], "GroupBy");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "GroupBy");
      if (!fn.ok) return fn;
      const groups: Record<string, Value[]> = {};
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        const key = coerceToString(r.value);
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      }
      // Return as list of {key, items} objects (represented as [key, [items]])
      return ok(Object.entries(groups).map(([k, v]) => [k, v] as Value));
    },

    Join(args) {
      const list = requireList(args[0], "Join");
      if (!list.ok) return list;
      const sep = coerceToString(args[1] ?? ",");
      return ok(list.value.map(coerceToString).join(sep));
    },

    CountIf(args) {
      const list = requireList(args[0], "CountIf");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "CountIf");
      if (!fn.ok) return fn;
      let count = 0;
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        if (coerceToBool(r.value)) count++;
      }
      return ok(count);
    },
  };
}
