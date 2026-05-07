// ============================================================
// Entity stdlib functions (require FormulaContext)
// ============================================================

import type { Value, EntityValue, LambdaValue, FormulaContext } from "../value.js";
import { isLambda, coerceToBool } from "../value.js";
import { makeEvalError, type EvalError } from "../errors.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";
import type { ApplyFn } from "./lists.js";

export function makeEntityFunctions(
  ctx: FormulaContext,
  apply: ApplyFn,
): Record<string, (args: Value[]) => Result<Value, EvalError>> {
  return {
    /** Filter(EntityTypeName, predicate) or Filter(list, predicate) */
    Filter(args) {
      // If first arg is a string, treat as entity type query
      if (typeof args[0] === "string") {
        const typeId = args[0];
        const fn = isLambda(args[1] ?? null) ? args[1] as LambdaValue : null;
        const entities = ctx.queryEntities(typeId);
        const wrapped: EntityValue[] = entities.map((e) => ({ _type: "entity", entity: e }));
        if (!fn) return ok(wrapped);
        const result: Value[] = [];
        for (const ev of wrapped) {
          const r = apply(fn, [ev]);
          if (!r.ok) return r;
          if (coerceToBool(r.value)) result.push(ev);
        }
        return ok(result);
      }
      // Fall back to list filter
      if (Array.isArray(args[0])) {
        const fn = isLambda(args[1] ?? null) ? args[1] as LambdaValue : null;
        if (!fn) return err(makeEvalError("Filter: second arg must be a lambda"));
        const result: Value[] = [];
        for (const item of args[0]) {
          const r = apply(fn, [item]);
          if (!r.ok) return r;
          if (coerceToBool(r.value)) result.push(item);
        }
        return ok(result);
      }
      return err(makeEvalError("Filter: first arg must be a list or entity type name"));
    },

    Lookup(args) {
      if (typeof args[0] !== "object" || args[0] === null || !("_type" in args[0])) {
        return err(makeEvalError("Lookup: expected entity as first arg"));
      }
      const ev = args[0] as EntityValue;
      const relType = typeof args[1] === "string" ? args[1] : undefined;
      const edges = ctx.getRelations(ev.entity.id, relType);
      const results: EntityValue[] = [];
      for (const edge of edges) {
        const target = ctx.resolveEntity(edge.targetId);
        if (target) results.push({ _type: "entity", entity: target });
      }
      return ok(results);
    },

    Backlinks(args) {
      if (typeof args[0] !== "object" || args[0] === null || !("_type" in args[0])) {
        return err(makeEvalError("Backlinks: expected entity as first arg"));
      }
      const ev = args[0] as EntityValue;
      // Backlinks are relations where this entity is the target
      // Implementation delegates to context
      const edges = ctx.getRelations(ev.entity.id);
      const results: EntityValue[] = edges
        .map((e) => ctx.resolveEntity(e.sourceId))
        .filter((e): e is NonNullable<typeof e> => e !== null)
        .map((e) => ({ _type: "entity" as const, entity: e }));
      return ok(results);
    },

    Tags(args) {
      if (typeof args[0] !== "object" || args[0] === null || !("_type" in args[0])) {
        return err(makeEvalError("Tags: expected entity as first arg"));
      }
      const ev = args[0] as EntityValue;
      return ok(ev.entity.tags ?? []);
    },
  };
}
