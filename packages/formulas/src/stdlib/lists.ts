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

    // Note: Reverse is handled by stringFunctions which supports both strings and lists.

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
    /** Coda-style `list.Contains(value)` */
    ListContains(args) {
      const list = requireList(args[0], "ListContains");
      if (!list.ok) return list;
      const target = args[1] ?? null;
      const targetStr = coerceToString(target);
      return ok(list.value.some((v) => v === target || coerceToString(v) === targetStr));
    },
    /** `In(value, list)` — Coda convention */
    In(args) {
      const target = args[0] ?? null;
      const list = requireList(args[1], "In");
      if (!list.ok) return list;
      const targetStr = coerceToString(target);
      return ok(list.value.some((v) => v === target || coerceToString(v) === targetStr));
    },
    RandomItem(args) {
      const list = requireList(args[0], "RandomItem");
      if (!list.ok) return list;
      if (list.value.length === 0) return ok(null);
      return ok(list.value[Math.floor(Math.random() * list.value.length)] ?? null);
    },
    /** Slice(list, start, end?) — 0-based, end exclusive */
    Slice(args) {
      const list = requireList(args[0], "Slice");
      if (!list.ok) return list;
      const start = coerceToNumber(args[1] ?? null) ?? 0;
      const end = args.length > 2 ? coerceToNumber(args[2] ?? null) ?? list.value.length : list.value.length;
      return ok(list.value.slice(start, end));
    },
    /** Coda-style chained sum: list.Sum() */
    ListSum(args) {
      const list = requireList(args[0], "ListSum");
      if (!list.ok) return list;
      let s = 0;
      for (const v of list.value) {
        const n = coerceToNumber(v);
        if (n !== null) s += n;
      }
      return ok(s);
    },
    Pluck(args) {
      const list = requireList(args[0], "Pluck");
      if (!list.ok) return list;
      const key = coerceToString(args[1] ?? null);
      const out: Value[] = [];
      for (const item of list.value) {
        if (item && typeof item === "object" && !Array.isArray(item) && "_type" in item && (item as { _type: string })._type === "entity") {
          const e = (item as { _type: "entity"; entity: { fields: Record<string, unknown> } }).entity;
          const v = e.fields[key];
          out.push(v !== undefined ? (v as Value) : null);
        } else { out.push(null); }
      }
      return ok(out);
    },
    MapFlatten(args) {
      const list = requireList(args[0], "MapFlatten");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "MapFlatten");
      if (!fn.ok) return fn;
      const out: Value[] = [];
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        if (Array.isArray(r.value)) out.push(...r.value);
        else out.push(r.value);
      }
      return ok(out);
    },

    // ── New aggregates — Bloc 4 ────────────────────────────────

    Any(args) {
      const list = requireList(args[0], "Any");
      if (!list.ok) return list;
      if (args[1] === undefined) return ok(list.value.length > 0);
      const fn = requireLambda(args[1], "Any");
      if (!fn.ok) return fn;
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        if (coerceToBool(r.value)) return ok(true);
      }
      return ok(false);
    },

    All(args) {
      const list = requireList(args[0], "All");
      if (!list.ok) return list;
      if (args[1] === undefined) return ok(list.value.every((v) => coerceToBool(v)));
      const fn = requireLambda(args[1], "All");
      if (!fn.ok) return fn;
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        if (!coerceToBool(r.value)) return ok(false);
      }
      return ok(true);
    },

    None(args) {
      const list = requireList(args[0], "None");
      if (!list.ok) return list;
      if (args[1] === undefined) return ok(list.value.length === 0);
      const fn = requireLambda(args[1], "None");
      if (!fn.ok) return fn;
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        if (coerceToBool(r.value)) return ok(false);
      }
      return ok(true);
    },

    Includes(args) {
      const list = requireList(args[0], "Includes");
      if (!list.ok) return list;
      const target = args[1] ?? null;
      const targetStr = coerceToString(target);
      return ok(list.value.some((v) => v === target || coerceToString(v) === targetStr));
    },

    IndexOf(args) {
      const list = requireList(args[0], "IndexOf");
      if (!list.ok) return list;
      const target = args[1] ?? null;
      const targetStr = coerceToString(target);
      const idx = list.value.findIndex((v) => v === target || coerceToString(v) === targetStr);
      return ok(idx);
    },

    Flatten(args) {
      const list = requireList(args[0], "Flatten");
      if (!list.ok) return list;
      const out: Value[] = [];
      for (const item of list.value) {
        if (Array.isArray(item)) out.push(...item);
        else out.push(item);
      }
      return ok(out);
    },

    FlatMap(args) {
      const list = requireList(args[0], "FlatMap");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "FlatMap");
      if (!fn.ok) return fn;
      const out: Value[] = [];
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        if (Array.isArray(r.value)) out.push(...r.value);
        else out.push(r.value);
      }
      return ok(out);
    },

    Chunk(args) {
      const list = requireList(args[0], "Chunk");
      if (!list.ok) return list;
      const n = Math.max(1, Math.floor(coerceToNumber(args[1] ?? null) ?? 1));
      const out: Value[] = [];
      for (let i = 0; i < list.value.length; i += n) {
        out.push(list.value.slice(i, i + n));
      }
      return ok(out);
    },

    Zip(args) {
      const a = requireList(args[0], "Zip");
      if (!a.ok) return a;
      const b = requireList(args[1], "Zip");
      if (!b.ok) return b;
      const len = Math.min(a.value.length, b.value.length);
      const out: Value[] = [];
      for (let i = 0; i < len; i++) out.push([a.value[i] ?? null, b.value[i] ?? null]);
      return ok(out);
    },

    Partition(args) {
      const list = requireList(args[0], "Partition");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "Partition");
      if (!fn.ok) return fn;
      const yes: Value[] = [], no: Value[] = [];
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        if (coerceToBool(r.value)) yes.push(item); else no.push(item);
      }
      return ok([yes, no] as Value);
    },

    DistinctBy(args) {
      const list = requireList(args[0], "DistinctBy");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "DistinctBy");
      if (!fn.ok) return fn;
      const seen = new Set<string>();
      const out: Value[] = [];
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        const key = coerceToString(r.value);
        if (!seen.has(key)) { seen.add(key); out.push(item); }
      }
      return ok(out);
    },

    SortBy(args) {
      const list = requireList(args[0], "SortBy");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "SortBy");
      if (!fn.ok) return fn;
      const pairs: Array<{ item: Value; key: Value }> = [];
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        pairs.push({ item, key: r.value });
      }
      pairs.sort((a, b) => {
        if (typeof a.key === "number" && typeof b.key === "number") return a.key - b.key;
        return coerceToString(a.key).localeCompare(coerceToString(b.key));
      });
      return ok(pairs.map((p) => p.item));
    },

    SortByDesc(args) {
      const list = requireList(args[0], "SortByDesc");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "SortByDesc");
      if (!fn.ok) return fn;
      const pairs: Array<{ item: Value; key: Value }> = [];
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        pairs.push({ item, key: r.value });
      }
      pairs.sort((a, b) => {
        if (typeof a.key === "number" && typeof b.key === "number") return b.key - a.key;
        return coerceToString(b.key).localeCompare(coerceToString(a.key));
      });
      return ok(pairs.map((p) => p.item));
    },

    MaxBy(args) {
      const list = requireList(args[0], "MaxBy");
      if (!list.ok) return list;
      if (list.value.length === 0) return ok(null);
      const fn = requireLambda(args[1], "MaxBy");
      if (!fn.ok) return fn;
      let best: Value = null, bestKey: number | null = null;
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        const k = coerceToNumber(r.value);
        if (k !== null && (bestKey === null || k > bestKey)) { bestKey = k; best = item; }
      }
      return ok(best);
    },

    MinBy(args) {
      const list = requireList(args[0], "MinBy");
      if (!list.ok) return list;
      if (list.value.length === 0) return ok(null);
      const fn = requireLambda(args[1], "MinBy");
      if (!fn.ok) return fn;
      let best: Value = null, bestKey: number | null = null;
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        const k = coerceToNumber(r.value);
        if (k !== null && (bestKey === null || k < bestKey)) { bestKey = k; best = item; }
      }
      return ok(best);
    },

    SumBy(args) {
      const list = requireList(args[0], "SumBy");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "SumBy");
      if (!fn.ok) return fn;
      let sum = 0;
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        const n = coerceToNumber(r.value);
        if (n !== null) sum += n;
      }
      return ok(sum);
    },

    AvgBy(args) {
      const list = requireList(args[0], "AvgBy");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "AvgBy");
      if (!fn.ok) return fn;
      let sum = 0, count = 0;
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        const n = coerceToNumber(r.value);
        if (n !== null) { sum += n; count++; }
      }
      return ok(count === 0 ? null : sum / count);
    },

    CountBy(args) {
      const list = requireList(args[0], "CountBy");
      if (!list.ok) return list;
      const fn = requireLambda(args[1], "CountBy");
      if (!fn.ok) return fn;
      const groups: Record<string, number> = {};
      for (const item of list.value) {
        const r = apply(fn.value, [item]);
        if (!r.ok) return r;
        const key = coerceToString(r.value);
        groups[key] = (groups[key] ?? 0) + 1;
      }
      return ok(Object.entries(groups).map(([k, v]) => [k, v] as Value));
    },

    Compact(args) {
      const list = requireList(args[0], "Compact");
      if (!list.ok) return list;
      return ok(list.value.filter((v) => v !== null && v !== undefined));
    },

    IsEmpty(args) {
      const list = requireList(args[0], "IsEmpty");
      if (!list.ok) return list;
      return ok(list.value.length === 0);
    },

    IsNotEmpty(args) {
      const list = requireList(args[0], "IsNotEmpty");
      if (!list.ok) return list;
      return ok(list.value.length > 0);
    },

    Mode(args) {
      const list = requireList(args[0], "Mode");
      if (!list.ok) return list;
      if (list.value.length === 0) return ok(null);
      const freq: Record<string, number> = {};
      for (const v of list.value) {
        const k = coerceToString(v);
        freq[k] = (freq[k] ?? 0) + 1;
      }
      let maxCount = 0, modeKey = "";
      for (const [k, c] of Object.entries(freq)) {
        if (c > maxCount) { maxCount = c; modeKey = k; }
      }
      return ok(list.value.find((v) => coerceToString(v) === modeKey) ?? null);
    },

    Range(args) {
      const list = requireList(args[0], "Range");
      if (!list.ok) return list;
      const nums = list.value.map((v) => coerceToNumber(v)).filter((n): n is number => n !== null);
      if (nums.length === 0) return ok(null);
      return ok(Math.max(...nums) - Math.min(...nums));
    },

    Stddev(args) {
      const list = requireList(args[0], "Stddev");
      if (!list.ok) return list;
      const nums = list.value.map((v) => coerceToNumber(v)).filter((n): n is number => n !== null);
      if (nums.length < 2) return ok(0);
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      const variance = nums.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / nums.length;
      return ok(Math.sqrt(variance));
    },

    Variance(args) {
      const list = requireList(args[0], "Variance");
      if (!list.ok) return list;
      const nums = list.value.map((v) => coerceToNumber(v)).filter((n): n is number => n !== null);
      if (nums.length < 2) return ok(0);
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      return ok(nums.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / nums.length);
    },

    Percentile(args) {
      const list = requireList(args[0], "Percentile");
      if (!list.ok) return list;
      const p = coerceToNumber(args[1] ?? null) ?? 50;
      const nums = list.value.map((v) => coerceToNumber(v)).filter((n): n is number => n !== null).sort((a, b) => a - b);
      if (nums.length === 0) return ok(null);
      const idx = Math.min(nums.length - 1, Math.floor((p / 100) * nums.length));
      return ok(nums[idx] ?? null);
    },

    // ── Extension ───────────────────────────────────────────────

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
        freq[k]!.count++;
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
  };
}
