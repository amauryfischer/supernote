// ============================================================
// String stdlib functions
// ============================================================

import type { Value } from "../value.js";
import { coerceToNumber, coerceToString } from "../value.js";
import { makeEvalError, type EvalError } from "../errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";

export const stringFunctions: Record<string, (args: Value[]) => Result<Value, EvalError>> = {
  Concat(args) {
    return ok(args.map(coerceToString).join(""));
  },
  Length(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.length);
  },
  Upper(args) {
    return ok(coerceToString(args[0] ?? null).toUpperCase());
  },
  Lower(args) {
    return ok(coerceToString(args[0] ?? null).toLowerCase());
  },
  Trim(args) {
    return ok(coerceToString(args[0] ?? null).trim());
  },
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
    // List form: Contains(list, item)
    if (Array.isArray(a)) {
      const targetStr = coerceToString(b);
      return ok(a.some((v) => v === b || coerceToString(v) === targetStr));
    }
    const s = coerceToString(a);
    const sub = coerceToString(b);
    return ok(s.includes(sub));
  },
  StartsWith(args) {
    const s = coerceToString(args[0] ?? null);
    const prefix = coerceToString(args[1] ?? null);
    return ok(s.startsWith(prefix));
  },
  EndsWith(args) {
    const s = coerceToString(args[0] ?? null);
    const suffix = coerceToString(args[1] ?? null);
    return ok(s.endsWith(suffix));
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
      const re = new RegExp(pattern);
      const match = s.match(re);
      if (!match) return ok(null);
      return ok(match[0] ?? null);
    } catch {
      return err(makeEvalError(`RegexMatch: invalid pattern '${pattern}'`));
    }
  },
  Slugify(args) {
    const s = coerceToString(args[0] ?? null);
    const slug = s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return ok(slug);
  },
  // ── Coda aliases & extras ────────────────────────────────────
  Concatenate(args) {
    return ok(args.map(coerceToString).join(""));
  },
  /**
   * Format — polymorphic:
   *   Format(date, "YYYY-MM-DD")      → date formatting tokens
   *   Format("Hi {1}, {2}", a, b)     → text template substitution
   */
  Format(args) {
    if (args.length === 0) return ok("");
    const first = args[0] ?? null;
    if (first instanceof Date) {
      const fmt = coerceToString(args[1] ?? "YYYY-MM-DD");
      const d = first;
      const out = fmt
        .replace("YYYY", String(d.getFullYear()).padStart(4, "0"))
        .replace("MM", String(d.getMonth() + 1).padStart(2, "0"))
        .replace("DD", String(d.getDate()).padStart(2, "0"))
        .replace("HH", String(d.getHours()).padStart(2, "0"))
        .replace("mm", String(d.getMinutes()).padStart(2, "0"))
        .replace("ss", String(d.getSeconds()).padStart(2, "0"));
      return ok(out);
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
    const start = (coerceToNumber(args[1] ?? null) ?? 1) - 1; // Coda is 1-based
    const len = args.length > 2 ? coerceToNumber(args[2] ?? null) ?? 0 : s.length - start;
    return ok(s.slice(Math.max(0, start), Math.max(0, start) + Math.max(0, len)));
  },
  /** 1-based index of needle in haystack; 0 if not found (Coda semantics) */
  Find(args) {
    const haystack = coerceToString(args[0] ?? null);
    const needle = coerceToString(args[1] ?? null);
    const from = args.length > 2 ? (coerceToNumber(args[2] ?? null) ?? 1) - 1 : 0;
    const idx = haystack.indexOf(needle, Math.max(0, from));
    return ok(idx < 0 ? 0 : idx + 1);
  },
  RepeatString(args) {
    const s = coerceToString(args[0] ?? null);
    const n = Math.max(0, Math.floor(coerceToNumber(args[1] ?? null) ?? 0));
    return ok(s.repeat(n));
  },
  ToText(args) {
    return ok(coerceToString(args[0] ?? null));
  },
  ToNumber(args) {
    const n = coerceToNumber(args[0] ?? null);
    return ok(n);
  },
  Proper(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
  },
  Len(args) {
    const v = args[0] ?? null;
    if (Array.isArray(v)) return ok(v.length);
    return ok(coerceToString(v).length);
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
};
