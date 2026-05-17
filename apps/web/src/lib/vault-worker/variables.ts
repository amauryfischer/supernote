import type { Database } from './sqlite-adapter.js';
import type { Variable, VariableInput } from '@supernote/core';
import {
  parseFormula,
  evaluate,
  type FormulaContext,
  type Value as FormulaValue,
  type Scope,
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
  /** Scope exposé lors de l'éval de la formule d'une variable (bases globales, etc.). */
  baseScope: Scope = {},
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
      resolveVariable: makeVariableResolver(db, baseContext, nested, baseScope),
    };
    const result = evaluate(parsed.value, childCtx, baseScope);
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

// ── Vault-scoped context + base scope (pour évaluer les variables avec accès aux bases) ──

interface EntityTypeMeta {
  id: string;
  name: string;
  plural: string;
  fields: Array<{
    id: string;
    name?: string;
    kind?: string;
    targetTypeId?: string;
    cardinality?: "one" | "many";
  }>;
}

function toFormulaValueShallow(v: unknown): FormulaValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return v.map(toFormulaValueShallow);
  return String(v);
}

function loadEntityTypes(db: Database, vaultId: string): EntityTypeMeta[] {
  const rows = execRows<{ id: string; name: string; plural: string; fields: string }>(
    db,
    'SELECT id, name, plural, fields FROM entity_type WHERE vaultId = ?',
    [vaultId],
  );
  return rows.map((r) => {
    let parsed: EntityTypeMeta['fields'] = [];
    try {
      const raw = JSON.parse(r.fields || '[]') as Array<{
        id: string;
        name?: string;
        kind?: string;
        type?: string;
        targetTypeId?: string;
        cardinality?: string;
      }>;
      if (Array.isArray(raw)) {
        parsed = raw.map((f) => {
          const rawCard = f.cardinality ?? '';
          const cardinality: 'one' | 'many' =
            rawCard === 'one_to_one' ? 'one' :
            rawCard === 'one_to_many' || rawCard === 'many_to_many' ? 'many' :
            'one';
          return {
            id: f.id,
            name: f.name,
            kind: f.kind ?? f.type,
            targetTypeId: f.targetTypeId,
            cardinality,
          };
        });
      }
    } catch {
      parsed = [];
    }
    return { id: r.id, name: r.name, plural: r.plural, fields: parsed };
  });
}

function loadEntitiesOfTypeRaw(
  db: Database,
  vaultId: string,
  typeId: string,
): Array<{
  id: string;
  typeId: string;
  filePath: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  fields: Record<string, FormulaValue>;
}> {
  const rows = execRows<{
    id: string;
    typeId: string;
    filePath: string;
    createdAt: string;
    updatedAt: string;
    fields: string;
  }>(
    db,
    'SELECT id, typeId, filePath, createdAt, updatedAt, fields FROM entity WHERE vaultId = ? AND typeId = ?',
    [vaultId, typeId],
  );
  return rows.map((r) => {
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(r.fields || '{}') as Record<string, unknown>;
    } catch {
      raw = {};
    }
    const fv: Record<string, FormulaValue> = {};
    for (const [k, v] of Object.entries(raw)) fv[k] = toFormulaValueShallow(v);
    return {
      id: r.id,
      typeId: r.typeId,
      filePath: r.filePath ?? '',
      body: '',
      createdAt: new Date(r.createdAt ?? Date.now()),
      updatedAt: new Date(r.updatedAt ?? Date.now()),
      fields: fv,
    };
  });
}

type RawEntity = ReturnType<typeof loadEntitiesOfTypeRaw>[number];

/**
 * Two-pass relation resolution.
 *
 * Pass 1: build entityById map with scalar fields only (relation fields
 *   keep their raw string / string[] values).
 * Pass 2: for each entity, for each relation field, substitute the raw
 *   id(s) with EntityValue wrappers pointing into entityById.
 *
 * This avoids infinite recursion on cycles (A.x→B, B.y→A).
 */
function resolveRelations(
  entitiesByTypeId: Map<string, RawEntity[]>,
  types: EntityTypeMeta[],
): Map<string, RawEntity> {
  // Pass 1: index all entities by id (fields = scalar copies as-is)
  const entityById = new Map<string, RawEntity>();
  for (const list of entitiesByTypeId.values()) {
    for (const e of list) entityById.set(e.id, e);
  }

  // Pass 2: substitute relation field values
  const typeById = new Map<string, EntityTypeMeta>();
  for (const t of types) typeById.set(t.id, t);

  for (const [typeId, list] of entitiesByTypeId) {
    const typeMeta = typeById.get(typeId);
    if (!typeMeta) continue;
    const relFields = typeMeta.fields.filter((f) => f.kind === 'relation' && f.targetTypeId);
    if (relFields.length === 0) continue;

    for (const entity of list) {
      for (const rf of relFields) {
        const raw = entity.fields[rf.id];
        if (rf.cardinality === 'many') {
          const ids = Array.isArray(raw)
            ? (raw as unknown[]).map(String)
            : typeof raw === 'string' ? (raw.startsWith('[')
                ? (() => { try { return (JSON.parse(raw) as unknown[]).map(String); } catch { return [raw]; } })()
                : raw ? [raw] : [])
              : [];
          const resolved = ids
            .map((id) => entityById.get(id))
            .filter((e): e is RawEntity => e !== undefined)
            .map((e): FormulaValue => ({ _type: 'entity', entity: e as never }));
          (entity.fields as Record<string, FormulaValue>)[rf.id] = resolved;
        } else {
          const id = typeof raw === 'string' ? raw : null;
          const target = id ? entityById.get(id) : undefined;
          (entity.fields as Record<string, FormulaValue>)[rf.id] = target
            ? { _type: 'entity', entity: target as never }
            : null;
        }
      }
    }
  }

  return entityById;
}

/**
 * Construit un FormulaContext (sans resolveVariable) qui permet à une formule
 * de variable d'accéder aux bases via `queryEntities` / `resolveEntity`, et un
 * Scope qui expose chaque base par son nom et son pluriel.
 */
export function buildVaultFormulaContext(
  db: Database,
  vaultId: string,
): { context: Omit<FormulaContext, 'resolveVariable'>; baseScope: Scope } {
  const types = loadEntityTypes(db, vaultId);
  const typeByKey = new Map<string, EntityTypeMeta>();
  for (const t of types) {
    typeByKey.set(t.id, t);
    if (t.name) typeByKey.set(t.name.toLowerCase(), t);
    if (t.plural) typeByKey.set(t.plural.toLowerCase(), t);
  }
  const entitiesByTypeId = new Map<string, ReturnType<typeof loadEntitiesOfTypeRaw>>();
  function getEntities(typeId: string): ReturnType<typeof loadEntitiesOfTypeRaw> {
    let cached = entitiesByTypeId.get(typeId);
    if (!cached) {
      cached = loadEntitiesOfTypeRaw(db, vaultId, typeId);
      entitiesByTypeId.set(typeId, cached);
    }
    return cached;
  }

  const context: Omit<FormulaContext, 'resolveVariable'> = {
    resolveEntity: (ref: string) => {
      // direct id match
      for (const list of entitiesByTypeId.values()) {
        const hit = list.find((e) => e.id === ref);
        if (hit) return hit as never;
      }
      const r = execRows<{
        id: string;
        typeId: string;
        filePath: string;
        createdAt: string;
        updatedAt: string;
        fields: string;
      }>(
        db,
        `SELECT id, typeId, filePath, createdAt, updatedAt, fields FROM entity
         WHERE vaultId = ? AND (id = ? OR fields LIKE ? OR filePath LIKE ?) LIMIT 1`,
        [vaultId, ref, `%"name":${JSON.stringify(ref)}%`, `%/${ref}.md`],
      )[0];
      if (!r) return null;
      let raw: Record<string, unknown> = {};
      try {
        raw = JSON.parse(r.fields || '{}') as Record<string, unknown>;
      } catch {
        raw = {};
      }
      const fv: Record<string, FormulaValue> = {};
      for (const [k, v] of Object.entries(raw)) fv[k] = toFormulaValueShallow(v);
      return {
        id: r.id,
        typeId: r.typeId,
        filePath: r.filePath ?? '',
        body: '',
        createdAt: new Date(r.createdAt ?? Date.now()),
        updatedAt: new Date(r.updatedAt ?? Date.now()),
        fields: fv,
      } as never;
    },
    queryEntities: (typeIdOrName: string) => {
      const t =
        typeByKey.get(typeIdOrName) ?? typeByKey.get(typeIdOrName.toLowerCase());
      if (!t) return [];
      return getEntities(t.id) as never;
    },
    getRelations: () => [],
    now: () => new Date(),
  };

  // Pre-load all entity types' entities to enable cross-type resolution
  for (const t of types) {
    getEntities(t.id); // populate entitiesByTypeId
  }

  // Two-pass resolution: substitute relation field values with EntityValues
  resolveRelations(entitiesByTypeId, types);

  // baseScope uses the now-resolved entities (mutated in-place by pass 2)
  const baseScope: Scope = {};
  for (const t of types) {
    const ents = getEntities(t.id);
    const values: FormulaValue[] = ents.map((e) => ({ _type: 'entity', entity: e as never }));
    if (t.name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t.name)) baseScope[t.name] = values;
    if (t.plural && /^[A-Za-z_][A-Za-z0-9_]*$/.test(t.plural)) baseScope[t.plural] = values;
  }

  return { context, baseScope };
}
