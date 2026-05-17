// ============================================================
// JSON stdlib functions
// ============================================================

import type { Value } from "../value.js";
import { coerceToString } from "../value.js";
import { makeEvalError, type EvalError } from "../errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";

function jsonPathGet(obj: unknown, path: string): unknown {
  // Supports "a.b.c" and "a[0].b"
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return null;
    if (typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export const jsonFunctions: Record<string, (args: Value[]) => Result<Value, EvalError>> = {
  ToJson(args) {
    const v = args[0] ?? null;
    try { return ok(JSON.stringify(v)); }
    catch { return err(makeEvalError("ToJson: serialization failed")); }
  },

  FromJson(args) {
    const s = coerceToString(args[0] ?? null);
    try { return ok(JSON.parse(s) as Value); }
    catch { return err(makeEvalError("FromJson: invalid JSON")); }
  },

  JsonPath(args) {
    const obj = args[0] ?? null;
    const path = coerceToString(args[1] ?? null);
    try {
      const result = jsonPathGet(obj, path);
      return ok(result !== undefined ? (result as Value) : null);
    } catch {
      return err(makeEvalError("JsonPath: invalid path"));
    }
  },
};
