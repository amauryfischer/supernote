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

    // ── Extension ─────────────────────────────────────────────

    Get(args) {
      const ev = args[0];
      if (!ev || typeof ev !== "object" || !("_type" in ev) || (ev as EntityValue)._type !== "entity")
        return err(makeEvalError("Get: expected entity as first arg"));
      const field = typeof args[1] === "string" ? args[1] : null;
      if (!field) return err(makeEvalError("Get: second arg must be field name string"));
      const entity = (ev as EntityValue).entity;
      const val = entity.fields[field];
      if (val === null || val === undefined) return ok(args[2] ?? null);
      return ok(val as Value);
    },

    Has(args) {
      const ev = args[0];
      if (!ev || typeof ev !== "object" || !("_type" in ev) || (ev as EntityValue)._type !== "entity")
        return err(makeEvalError("Has: expected entity as first arg"));
      const field = typeof args[1] === "string" ? args[1] : null;
      if (!field) return err(makeEvalError("Has: second arg must be field name string"));
      const entity = (ev as EntityValue).entity;
      const val = entity.fields[field];
      return ok(val !== null && val !== undefined && val !== "");
    },

    EntityId(args) {
      const ev = args[0];
      if (!ev || typeof ev !== "object" || !("_type" in ev) || (ev as EntityValue)._type !== "entity")
        return err(makeEvalError("EntityId: expected entity"));
      return ok((ev as EntityValue).entity.id);
    },

    CreatedAt(args) {
      const ev = args[0];
      if (!ev || typeof ev !== "object" || !("_type" in ev) || (ev as EntityValue)._type !== "entity")
        return err(makeEvalError("CreatedAt: expected entity"));
      return ok((ev as EntityValue).entity.createdAt ?? null);
    },

    UpdatedAt(args) {
      const ev = args[0];
      if (!ev || typeof ev !== "object" || !("_type" in ev) || (ev as EntityValue)._type !== "entity")
        return err(makeEvalError("UpdatedAt: expected entity"));
      return ok((ev as EntityValue).entity.updatedAt ?? null);
    },

    FindAll(args) {
      const typeId = typeof args[0] === "string" ? args[0] : null;
      if (!typeId) return err(makeEvalError("FindAll: first arg must be type name string"));
      const pred = isLambda(args[1] ?? null) ? args[1] as LambdaValue : null;
      const entities = ctx.queryEntities(typeId);
      const wrapped: EntityValue[] = entities.map((e) => ({ _type: "entity", entity: e }));
      if (!pred) return ok(wrapped);
      const result: Value[] = [];
      for (const ev of wrapped) {
        const r = apply(pred, [ev]);
        if (!r.ok) return r;
        if (coerceToBool(r.value)) result.push(ev);
      }
      return ok(result);
    },

    CountOf(args) {
      const typeId = typeof args[0] === "string" ? args[0] : null;
      if (!typeId) return err(makeEvalError("CountOf: first arg must be type name string"));
      const pred = isLambda(args[1] ?? null) ? args[1] as LambdaValue : null;
      const entities = ctx.queryEntities(typeId);
      if (!pred) return ok(entities.length);
      const wrapped: EntityValue[] = entities.map((e) => ({ _type: "entity", entity: e }));
      let count = 0;
      for (const ev of wrapped) {
        const r = apply(pred, [ev]);
        if (!r.ok) return r;
        if (coerceToBool(r.value)) count++;
      }
      return ok(count);
    },
  };
}
