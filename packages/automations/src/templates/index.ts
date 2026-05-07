// ============================================================
// Template engine — variable substitution and formula delegation
// ============================================================

import type { FormulaContext } from "../types/index.js";

/** Available template variable names */
export type TemplateVars = Record<string, unknown>;

const VAR_PATTERN = /\{\{([^}]+)\}\}/g;
const FORMULA_PREFIX = "formula:";

/**
 * Resolve a dot-path like "entity.fields.name" against an object.
 */
function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Format a resolved value as a string.
 */
function formatValue(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export interface TemplateEngineOptions {
  readonly formulaEvaluator?: (expr: string, ctx: FormulaContext) => unknown;
}

/**
 * Resolve all {{var.path}} and {{formula:expr}} placeholders in a template string.
 */
export function renderTemplate(
  template: string,
  vars: TemplateVars,
  ctx: FormulaContext,
  opts: TemplateEngineOptions = {}
): string {
  return template.replace(VAR_PATTERN, (_match, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed.startsWith(FORMULA_PREFIX)) {
      const expr = trimmed.slice(FORMULA_PREFIX.length).trim();
      if (opts.formulaEvaluator) {
        const result = opts.formulaEvaluator(expr, ctx);
        return formatValue(result);
      }
      return `{{formula:${expr}}}`;
    }
    const resolved = resolvePath(vars, trimmed);
    return formatValue(resolved);
  });
}

/**
 * Render all string values in a config object (recursive, 1 level deep records).
 */
export function renderConfigStrings(
  config: Record<string, unknown>,
  vars: TemplateVars,
  ctx: FormulaContext,
  opts: TemplateEngineOptions = {}
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string") {
      result[key] = renderTemplate(value, vars, ctx, opts);
    } else if (Array.isArray(value)) {
      result[key] = value.map((v) =>
        typeof v === "string" ? renderTemplate(v, vars, ctx, opts) : v
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}
