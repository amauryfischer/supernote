// ============================================================
// Date stdlib functions
// ============================================================

import type { Value } from "../value.js";
import { coerceToNumber, coerceToString } from "../value.js";
import { makeEvalError, type EvalError } from "../errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";

// ── Duration value ────────────────────────────────────────────────────────────

export interface DurationValue {
  readonly _type: "duration";
  /** Fixed milliseconds component (days/hours/minutes/seconds/weeks). */
  readonly ms: number;
  /** Calendar months to add (non-fixed). */
  readonly months: number;
  /** Calendar years to add (non-fixed). */
  readonly years: number;
}

export function isDuration(v: Value): v is DurationValue {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "_type" in v && (v as { _type: string })._type === "duration";
}

function makeDuration(ms: number, months = 0, years = 0): DurationValue {
  return { _type: "duration", ms, months, years };
}

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
  // ── Coda parity ──────────────────────────────────────────────
  Date(args) {
    const y = coerceToNumber(args[0] ?? null);
    const m = coerceToNumber(args[1] ?? null);
    const d = coerceToNumber(args[2] ?? null);
    if (y === null || m === null || d === null) return err(makeEvalError("Date: expected (year, month, day)"));
    return ok(new Date(y, m - 1, d));
  },
  Time(args) {
    const h = coerceToNumber(args[0] ?? null) ?? 0;
    const m = coerceToNumber(args[1] ?? null) ?? 0;
    const s = coerceToNumber(args[2] ?? null) ?? 0;
    const d = new Date(0); d.setHours(h, m, s, 0); return ok(d);
  },
  Second(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("Second: expected date"));
    return ok(d.getSeconds());
  },
  Weekday(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("Weekday: expected date"));
    return ok(d.getDay()); // 0=Sun .. 6=Sat
  },
  WeekdayName(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("WeekdayName: expected date"));
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return ok(names[d.getDay()] ?? "");
  },
  MonthName(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("MonthName: expected date"));
    const names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return ok(names[d.getMonth()] ?? "");
  },
  Quarter(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("Quarter: expected date"));
    return ok(Math.floor(d.getMonth() / 3) + 1);
  },
  IsDate(args) {
    return ok(args[0] instanceof Date);
  },
  ToYearMonth(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("ToYearMonth: expected date"));
    return ok(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  },
  Yesterday(_args, now) {
    const d = now();
    return ok(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1));
  },
  Tomorrow(_args, now) {
    const d = now();
    return ok(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
  },
  StartOfMonth(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("StartOfMonth: expected date"));
    return ok(new Date(d.getFullYear(), d.getMonth(), 1));
  },
  EndOfMonth(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("EndOfMonth: expected date"));
    return ok(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  },

  // ── Constructors ─────────────────────────────────────────────
  DateOnly(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("DateOnly: expected date"));
    return ok(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
  },
  StartOfDay(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("StartOfDay: expected date"));
    return ok(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0));
  },
  EndOfDay(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("EndOfDay: expected date"));
    return ok(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999));
  },
  StartOfYear(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("StartOfYear: expected date"));
    return ok(new Date(d.getFullYear(), 0, 1));
  },
  EndOfYear(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("EndOfYear: expected date"));
    return ok(new Date(d.getFullYear(), 11, 31));
  },
  StartOfWeek(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("StartOfWeek: expected date"));
    const weekStart = coerceToNumber(args[1] ?? null) ?? 1; // 1=Monday default
    const day = d.getDay(); // 0=Sun..6=Sat
    const diff = (day - (weekStart % 7) + 7) % 7;
    const result = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
    return ok(result);
  },
  EndOfWeek(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("EndOfWeek: expected date"));
    const weekStart = coerceToNumber(args[1] ?? null) ?? 1;
    const day = d.getDay();
    const diff = (day - (weekStart % 7) + 7) % 7;
    const startOfWeek = new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
    return ok(new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + 6));
  },

  // ── Duration constructors ─────────────────────────────────────
  Days(args) {
    const n = coerceToNumber(args[0] ?? null) ?? 0;
    return ok(makeDuration(n * 86400000));
  },
  Hours(args) {
    const n = coerceToNumber(args[0] ?? null) ?? 0;
    return ok(makeDuration(n * 3600000));
  },
  Minutes(args) {
    const n = coerceToNumber(args[0] ?? null) ?? 0;
    return ok(makeDuration(n * 60000));
  },
  Seconds(args) {
    const n = coerceToNumber(args[0] ?? null) ?? 0;
    return ok(makeDuration(n * 1000));
  },
  Weeks(args) {
    const n = coerceToNumber(args[0] ?? null) ?? 0;
    return ok(makeDuration(n * 7 * 86400000));
  },
  Months(args) {
    const n = coerceToNumber(args[0] ?? null) ?? 0;
    return ok(makeDuration(0, n));
  },
  Years(args) {
    const n = coerceToNumber(args[0] ?? null) ?? 0;
    return ok(makeDuration(0, 0, n));
  },

  // ── Predicates ───────────────────────────────────────────────
  IsBefore(args) {
    const a = toDate(args[0] ?? null), b = toDate(args[1] ?? null);
    if (!a || !b) return err(makeEvalError("IsBefore: expected two dates"));
    return ok(a.getTime() < b.getTime());
  },
  IsAfter(args) {
    const a = toDate(args[0] ?? null), b = toDate(args[1] ?? null);
    if (!a || !b) return err(makeEvalError("IsAfter: expected two dates"));
    return ok(a.getTime() > b.getTime());
  },
  IsBetween(args) {
    const d = toDate(args[0] ?? null), a = toDate(args[1] ?? null), b = toDate(args[2] ?? null);
    if (!d || !a || !b) return err(makeEvalError("IsBetween: expected three dates"));
    const t = d.getTime();
    return ok(t >= a.getTime() && t <= b.getTime());
  },
  IsSameDay(args) {
    const a = toDate(args[0] ?? null), b = toDate(args[1] ?? null);
    if (!a || !b) return err(makeEvalError("IsSameDay: expected two dates"));
    return ok(a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());
  },
  IsToday(args, now) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("IsToday: expected date"));
    const t = now();
    return ok(d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate());
  },
  IsYesterday(args, now) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("IsYesterday: expected date"));
    const yesterday = new Date(now()); yesterday.setDate(yesterday.getDate() - 1);
    return ok(d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate());
  },
  IsTomorrow(args, now) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("IsTomorrow: expected date"));
    const tomorrow = new Date(now()); tomorrow.setDate(tomorrow.getDate() + 1);
    return ok(d.getFullYear() === tomorrow.getFullYear() && d.getMonth() === tomorrow.getMonth() && d.getDate() === tomorrow.getDate());
  },
  IsThisWeek(args, now) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("IsThisWeek: expected date"));
    const t = now();
    const weekMs = 7 * 86400000;
    const startOfWeek = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7));
    const endOfWeek = new Date(startOfWeek.getTime() + weekMs);
    return ok(d.getTime() >= startOfWeek.getTime() && d.getTime() < endOfWeek.getTime());
  },
  IsThisMonth(args, now) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("IsThisMonth: expected date"));
    const t = now();
    return ok(d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth());
  },
  IsThisYear(args, now) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("IsThisYear: expected date"));
    return ok(d.getFullYear() === now().getFullYear());
  },
  IsPast(args, now) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("IsPast: expected date"));
    return ok(d.getTime() < now().getTime());
  },
  IsFuture(args, now) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("IsFuture: expected date"));
    return ok(d.getTime() > now().getTime());
  },
  IsWeekend(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("IsWeekend: expected date"));
    const day = d.getDay();
    return ok(day === 0 || day === 6);
  },
  IsWeekday(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("IsWeekday: expected date"));
    const day = d.getDay();
    return ok(day >= 1 && day <= 5);
  },
  IsLeapYear(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("IsLeapYear: expected date"));
    const y = d.getFullYear();
    return ok((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0);
  },

  // ── Format ───────────────────────────────────────────────────
  FormatDate(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("FormatDate: expected date as first arg"));
    const fmt = coerceToString(args[1] ?? "YYYY-MM-DD");
    return ok(formatDate(d, fmt));
  },
  ToISO(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("ToISO: expected date"));
    return ok(d.toISOString());
  },
  ToUnix(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("ToUnix: expected date"));
    return ok(Math.floor(d.getTime() / 1000));
  },
  FromUnix(args) {
    const n = coerceToNumber(args[0] ?? null);
    if (n === null) return err(makeEvalError("FromUnix: expected number (unix seconds)"));
    return ok(new Date(n * 1000));
  },
  FromISO(args) {
    const s = coerceToString(args[0] ?? null);
    const d = new Date(s);
    if (isNaN(d.getTime())) return err(makeEvalError(`FromISO: cannot parse '${s}'`));
    return ok(d);
  },
  FromNow(args, now) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("FromNow: expected date"));
    const diffMs = now().getTime() - d.getTime();
    const absDiff = Math.abs(diffMs);
    const isPast = diffMs > 0;
    let label: string;
    if (absDiff < 60000) label = "il y a quelques secondes";
    else if (absDiff < 3600000) label = `il y a ${Math.floor(absDiff / 60000)} minute${Math.floor(absDiff / 60000) > 1 ? "s" : ""}`;
    else if (absDiff < 86400000) label = `il y a ${Math.floor(absDiff / 3600000)} heure${Math.floor(absDiff / 3600000) > 1 ? "s" : ""}`;
    else if (absDiff < 30 * 86400000) label = `il y a ${Math.floor(absDiff / 86400000)} jour${Math.floor(absDiff / 86400000) > 1 ? "s" : ""}`;
    else if (absDiff < 365 * 86400000) label = `il y a ${Math.floor(absDiff / (30 * 86400000))} mois`;
    else label = `il y a ${Math.floor(absDiff / (365 * 86400000))} an${Math.floor(absDiff / (365 * 86400000)) > 1 ? "s" : ""}`;
    if (!isPast) label = label.replace("il y a", "dans");
    return ok(label);
  },
  FormatRelative(args, now) {
    // Alias for FromNow
    return dateFunctions["FromNow"]!(args, now);
  },

  // ── Calendar ─────────────────────────────────────────────────
  BusinessDaysBetween(args) {
    const a = toDate(args[0] ?? null), b = toDate(args[1] ?? null);
    if (!a || !b) return err(makeEvalError("BusinessDaysBetween: expected two dates"));
    const start = a.getTime() <= b.getTime() ? a : b;
    const end = a.getTime() <= b.getTime() ? b : a;
    let count = 0;
    const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    while (cur.getTime() < new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime()) {
      const day = cur.getDay();
      if (day >= 1 && day <= 5) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return ok(a.getTime() <= b.getTime() ? count : -count);
  },
  AddBusinessDays(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("AddBusinessDays: expected date"));
    let n = coerceToNumber(args[1] ?? null) ?? 0;
    const result = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const step = n > 0 ? 1 : -1;
    n = Math.abs(n);
    while (n > 0) {
      result.setDate(result.getDate() + step);
      const day = result.getDay();
      if (day >= 1 && day <= 5) n--;
    }
    return ok(result);
  },
  DaysInMonth(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("DaysInMonth: expected date"));
    return ok(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
  },
  DaysInYear(args) {
    const d = toDate(args[0] ?? null);
    if (!d) return err(makeEvalError("DaysInYear: expected date"));
    const y = d.getFullYear();
    return ok((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365);
  },

  // ── Extension ─────────────────────────────────────────────

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
    return ok(makeDuration(ms));
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
  HumanDuration(args) {
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
};
