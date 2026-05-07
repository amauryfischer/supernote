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
    const s = coerceToString(args[0] ?? null);
    const sub = coerceToString(args[1] ?? null);
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
};
