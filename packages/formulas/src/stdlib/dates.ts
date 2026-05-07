// ============================================================
// Date stdlib functions
// ============================================================

import type { Value } from "../value.js";
import { coerceToNumber, coerceToString } from "../value.js";
import { makeEvalError, type EvalError } from "../errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";

function toDate(v: Value): Date | null {
  if (v instanceof Date) return v;
  const n = coerceToNumber(v);
  if (n !== null) return new Date(n);
  if (typeof v === "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Minimal date format function.
 * Tokens: YYYY, MM, DD, HH, mm, ss
 */
function formatDate(d: Date, fmt: string): string {
  return fmt
    .replace("YYYY", String(d.getFullYear()).padStart(4, "0"))
    .replace("MM", String(d.getMonth() + 1).padStart(2, "0"))
    .replace("DD", String(d.getDate()).padStart(2, "0"))
    .replace("HH", String(d.getHours()).padStart(2, "0"))
    .replace("mm", String(d.getMinutes()).padStart(2, "0"))
    .replace("ss", String(d.getSeconds()).padStart(2, "0"));
}

export const dateFunctions: Record<string, (args: Value[], now: () => Date) => Result<Value, EvalError>> = {
  Now(_args, now) { return ok(now()); },
  Today(_args, now) {
    const d = now();
    return ok(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  },
  DateAdd(args) {
    const [d, amount, unit] = args;
    const date = toDate(d ?? null);
    if (!date) return err(makeEvalError("DateAdd: first arg must be a date"));
    const n = coerceToNumber(amount ?? null) ?? 0;
    const u = coerceToString(unit ?? "day");
    const result = new Date(date);
    switch (u) {
      case "day": result.setDate(result.getDate() + n); break;
      case "week": result.setDate(result.getDate() + n * 7); break;
      case "month": result.setMonth(result.getMonth() + n); break;
      case "year": result.setFullYear(result.getFullYear() + n); break;
      case "hour": result.setHours(result.getHours() + n); break;
      case "minute": result.setMinutes(result.getMinutes() + n); break;
      default: return err(makeEvalError(`DateAdd: unknown unit '${u}'`));
    }
    return ok(result);
  },
  DateDiff(args) {
    const [a, b, unit] = args;
    const da = toDate(a ?? null);
    const db = toDate(b ?? null);
    if (!da || !db) return err(makeEvalError("DateDiff: expected two dates"));
    const ms = da.getTime() - db.getTime();
    const u = coerceToString(unit ?? "day");
    const divisors: Record<string, number> = {
      ms: 1, second: 1000, minute: 60000,
      hour: 3600000, day: 86400000,
      week: 7 * 86400000,
    };
    const div = divisors[u];
    if (!div) return err(makeEvalError(`DateDiff: unknown unit '${u}'`));
    return ok(Math.floor(ms / div));
  },
  Year(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("Year: expected date"));
    return ok(d.getFullYear());
  },
  Month(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("Month: expected date"));
    return ok(d.getMonth() + 1);
  },
  Day(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("Day: expected date"));
    return ok(d.getDate());
  },
  Hour(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("Hour: expected date"));
    return ok(d.getHours());
  },
  Minute(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("Minute: expected date"));
    return ok(d.getMinutes());
  },
  WeekOfYear(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("WeekOfYear: expected date"));
    const start = new Date(d.getFullYear(), 0, 1);
    const diff = d.getTime() - start.getTime();
    return ok(Math.ceil((diff / 86400000 + start.getDay() + 1) / 7));
  },
  Format(args) {
    const [d, fmt] = args;
    const date = toDate(d ?? null);
    if (!date) return err(makeEvalError("Format: expected date as first arg"));
    const f = coerceToString(fmt ?? "YYYY-MM-DD");
    return ok(formatDate(date, f));
  },
  ParseDate(args) {
    const s = coerceToString(args[0] ?? null);
    const d = new Date(s);
    if (isNaN(d.getTime())) return err(makeEvalError(`ParseDate: cannot parse '${s}'`));
    return ok(d);
  },
};
