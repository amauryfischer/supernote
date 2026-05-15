import type { Database } from './sqlite-adapter.js';
import type { Variable, VariableInput } from '@supernote/core';
import {
  parseFormula,
  evaluate,
  type FormulaContext,
  type Value as FormulaValue,
} from '@supernote/formulas';

// ── Internal row shape ────────────────────────────────────────────────────────

interface VariableRow {
  id: string;
  name: string;
  type: 'number' | 'string' | 'boolean' | 'date';
  value_kind: 'literal' | 'formula';
  literal_json: string | null;
  formula_expr: string | null;
  createdAt: number;
  updatedAt: number;
}

// ── Low-level exec helpers ────────────────────────────────────────────────────

function execRows<T>(db: Database, sql: string, params: (string | number | null)[] = []): T[] {
  const res = db.exec(sql, params);
  if (!res.length || !res[0]) return [];
  const { columns, values } = res[0];
  return values.map(
    (v) => Object.fromEntries(columns.map((c, i) => [c, v[i] ?? null])) as T,
  );
}

// ── Row → domain conversion ───────────────────────────────────────────────────

function rowToVariable(r: VariableRow): Variable {
  const value: Variable['value'] =
    r.value_kind === 'literal'
      ? { kind: 'literal', value: JSON.parse(r.literal_json!) as string | number | boolean }
      : { kind: 'formula', expression: r.formula_expr! };
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    value,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ── Public CRUD helpers ───────────────────────────────────────────────────────

export function listVariables(db: Database): Variable[] {
  return execRows<VariableRow>(db, 'SELECT * FROM "variable" ORDER BY "name"').map(rowToVariable);
}

export function getVariable(db: Database, id: string): Variable | null {
  const r = execRows<VariableRow>(
    db,
    'SELECT * FROM "variable" WHERE id = ?',
    [id],
  )[0];
  return r ? rowToVariable(r) : null;
}

export function insertVariable(
  db: Database,
  input: VariableInput & { id: string },
): Variable {
  const now = Date.now();
  const literal_json = input.value.kind === 'literal' ? JSON.stringify(input.value.value) : null;
  const formula_expr = input.value.kind === 'formula' ? input.value.expression : null;
  db.exec(
    'INSERT INTO "variable" (id, name, type, value_kind, literal_json, formula_expr, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [input.id, input.name, input.type, input.value.kind, literal_json, formula_expr, now, now],
  );
  return getVariable(db, input.id)!;
}

export function updateVariable(
  db: Database,
  id: string,
  patch: Partial<VariableInput>,
): Variable {
  const current = getVariable(db, id);
  if (!current) throw new Error(`variable ${id} not found`);
  const merged = {
    name: patch.name ?? current.name,
    type: patch.type ?? current.type,
    value: patch.value ?? current.value,
  };
  const now = Date.now();
  const literal_json = merged.value.kind === 'literal' ? JSON.stringify(merged.value.value) : null;
  const formula_expr = merged.value.kind === 'formula' ? merged.value.expression : null;
  db.exec(
    'UPDATE "variable" SET name = ?, type = ?, value_kind = ?, literal_json = ?, formula_expr = ?, updatedAt = ? WHERE id = ?',
    [merged.name, merged.type, merged.value.kind, literal_json, formula_expr, now, id],
  );
  return getVariable(db, id)!;
}

export function deleteVariable(db: Database, id: string): boolean {
  db.exec('DELETE FROM "variable" WHERE id = ?', [id]);
  return true;
}

// ── Type coercion ─────────────────────────────────────────────────────────────

function coerce(value: FormulaValue, type: VariableRow['type']): FormulaValue {
  if (value === null) return null;
  switch (type) {
    case 'number':  return typeof value === 'number' ? value : Number(value as unknown);
    case 'string':  return typeof value === 'string' ? value : String(value as unknown);
    case 'boolean': return typeof value === 'boolean' ? value : Boolean(value);
    case 'date':    return value instanceof Date ? value : new Date(value as string);
  }
}

// ── Cycle-safe variable resolver ──────────────────────────────────────────────

/**
 * Build a `FormulaContext.resolveVariable` function that:
 *  - reads variables from the SQLite DB at call time
 *  - evaluates formula variables using a nested context (same resolver, new stack)
 *  - throws on circular references via the immutable `evalStack`
 */
export function makeVariableResolver(
  db: Database,
  baseContext: Omit<FormulaContext, 'resolveVariable'>,
  evalStack: ReadonlySet<string> = new Set(),
): FormulaContext['resolveVariable'] {
  return (name: string): FormulaValue => {
    if (evalStack.has(name)) {
      throw new Error(`circular variable reference: $${name}`);
    }
    const [r] = execRows<VariableRow>(
      db,
      'SELECT * FROM "variable" WHERE name = ?',
      [name],
    );
    if (!r) return null;

    if (r.value_kind === 'literal') {
      return coerce(JSON.parse(r.literal_json!) as FormulaValue, r.type);
    }

    // Formula variable — recurse with an extended stack
    const nested = new Set(evalStack);
    nested.add(name);
    const parsed = parseFormula(r.formula_expr!);
    if (!parsed.ok) {
      throw new Error(
        `variable ${name} formula parse error: ${String(parsed.error.message ?? 'parse error')}`,
      );
    }
    const childCtx: FormulaContext = {
      ...baseContext,
      resolveVariable: makeVariableResolver(db, baseContext, nested),
    };
    const result = evaluate(parsed.value, childCtx, {});
    if (!result.ok) {
      throw new Error(
        `variable ${name}: ${String(result.error.message ?? 'eval error')}`,
      );
    }
    return coerce(result.value, r.type);
  };
}

/**
 * Standalone resolver for tests / simple call sites.
 * Uses a no-op base context (no entity resolution).
 */
export function resolveVariable(db: Database, name: string): FormulaValue {
  const noopCtx: Omit<FormulaContext, 'resolveVariable'> = {
    resolveEntity: () => null,
    queryEntities: () => [],
    getRelations: () => [],
    now: () => new Date(),
  };
  return makeVariableResolver(db, noopCtx)(name);
}
