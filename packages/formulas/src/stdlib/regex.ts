// ============================================================
// Regex stdlib functions
// ============================================================

import type { Value } from "../value.js";
import { coerceToNumber, coerceToString } from "../value.js";
import { makeEvalError, type EvalError } from "../errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";

export const regexFunctions: Record<string, (args: Value[]) => Result<Value, EvalError>> = {
  RegexExtract(args) {
    const s = coerceToString(args[0] ?? null);
    const pattern = coerceToString(args[1] ?? null);
    const group = Math.floor(coerceToNumber(args[2] ?? null) ?? 0);
    try {
      const m = s.match(new RegExp(pattern));
      if (!m) return ok(null);
      return ok(m[group] ?? null);
    } catch {
      return err(makeEvalError(`RegexExtract: invalid pattern '${pattern}'`));
    }
  },

  RegexExtractAll(args) {
    const s = coerceToString(args[0] ?? null);
    const pattern = coerceToString(args[1] ?? null);
    const group = Math.floor(coerceToNumber(args[2] ?? null) ?? 0);
    try {
      const re = new RegExp(pattern, "g");
      const out: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        out.push(m[group] ?? "");
        if (m.index === re.lastIndex) re.lastIndex++;
      }
      return ok(out);
    } catch {
      return err(makeEvalError(`RegexExtractAll: invalid pattern '${pattern}'`));
    }
  },

  RegexSplit(args) {
    const s = coerceToString(args[0] ?? null);
    const pattern = coerceToString(args[1] ?? null);
    try {
      return ok(s.split(new RegExp(pattern)));
    } catch {
      return err(makeEvalError(`RegexSplit: invalid pattern '${pattern}'`));
    }
  },

  RegexEscape(args) {
    const s = coerceToString(args[0] ?? null);
    return ok(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  },
};
