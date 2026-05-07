// ============================================================
// Runtime value types for the formula evaluator
// ============================================================

import type { Entity, RelationEdge } from "@supernote/core/types";
import type { FormulaAST } from "./ast.js";

// ------ Value union ------------------------------------------

export type Value =
  | null
  | boolean
  | number
  | string
  | Date
  | Value[]
  | EntityValue
  | LambdaValue;

export interface EntityValue {
  readonly _type: "entity";
  readonly entity: Entity;
}

export interface LambdaValue {
  readonly _type: "lambda";
  readonly params: string[];
  readonly body: FormulaAST;
  readonly closure: Scope;
}

export type Scope = Record<string, Value>;

// ------ Context interface ------------------------------------

export interface FormulaContext {
  /** Resolve an entity by id, name, or wikilink title */
  resolveEntity(ref: string): Entity | null;
  /** Query entities of a given type with optional AST predicate */
  queryEntities(typeId: string, predicate?: FormulaAST): Entity[];
  /** Get relation edges from an entity */
  getRelations(entityId: string, relationTypeId?: string): RelationEdge[];
  /** Stable current time (for deterministic evaluation) */
  now(): Date;
}

// ------ Dependency tracking ----------------------------------

export type DependencyKind = "entity" | "entityType" | "relation" | "time";

export interface Dependency {
  readonly kind: DependencyKind;
  /** Entity id, type id, or relation type id */
  readonly id: string;
}

// ------ Type guards ------------------------------------------

export function isEntity(v: Value): v is EntityValue {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "_type" in v && (v as EntityValue)._type === "entity";
}

export function isLambda(v: Value): v is LambdaValue {
  return typeof v === "object" && v !== null && !Array.isArray(v) && "_type" in v && (v as LambdaValue)._type === "lambda";
}

// ------ Coercions (documented) --------------------------------
//
// number  → string  : String(n)                 — always safe
// string  → number  : parseFloat(s)             — NaN propagates as EvalError
// bool    → number  : true→1, false→0           — standard JS semantics
// number  → bool    : 0/NaN→false, else→true
// Date    → number  : .getTime()                — ms since epoch
// number  → Date    : new Date(n)               — ms since epoch
// null    propagates through arithmetic → null  — Coda/Notion semantics

export function coerceToNumber(v: Value): number | null {
  if (v === null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return isNaN(n) ? null : n;
  }
  if (v instanceof Date) return v.getTime();
  return null;
}

export function coerceToString(v: Value): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(coerceToString).join(", ");
  if (isEntity(v)) return String(v.entity.fields["name"] ?? v.entity.id);
  return String(v);
}

export function coerceToBool(v: Value): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0 && !isNaN(v);
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
