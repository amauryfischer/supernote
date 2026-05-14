# Variables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a vault-wide "Variables" section letting users define named values (literal or formula-computed) reusable across all formulas via `$nom` syntax.

**Architecture:** Persist a new `variable` SQLite table. Extend `@supernote/formulas` with a `$` lexer token, `VariableRef` AST node, `FormulaContext.resolveVariable`, and a `"variable"` dependency kind. The worker provides the resolver with cycle detection over an evaluation stack. Expose CRUD via a tRPC `variablesRouter`. Reorganize the sidebar to add a `/variables` route in the Tools group (and remove `/graph`, plus the duplicate search entry).

**Tech Stack:** TypeScript, zod, vitest, sqlite-wasm, tRPC, React 18, Next.js, HeroUI v3, `@phosphor-icons/react`, `@supernote/formulas`.

**Spec:** [`docs/superpowers/specs/2026-05-14-variables-design.md`](../specs/2026-05-14-variables-design.md)

---

## File Structure

**Created:**
- `packages/core/src/variable/index.ts` — zod schemas (`Variable`, `VariableInput`, `VariableType`, `VariableValue`)
- `packages/core/src/variable/variable.test.ts` — schema tests
- `packages/ipc/src/schemas/variables.ts` — IPC zod schemas (CRUD inputs/outputs)
- `packages/ipc/src/router/variables.router.ts` — tRPC router stubs
- `packages/ipc/src/router/variables.router.test.ts` — router shape tests
- `apps/web/src/lib/vault-worker/variables.ts` — SQL helpers + cycle-safe resolver
- `apps/web/src/lib/vault-worker/variables.test.ts` — vitest tests for CRUD + cycle detection
- `apps/web/src/app/variables/page.tsx` — list page (HeroUI Table)
- `apps/web/src/app/variables/nouveau/page.tsx` — creation form
- `apps/web/src/app/variables/[id]/page.tsx` — edit form
- `apps/web/src/components/variables/VariableForm.tsx` — shared form component
- `apps/web/src/components/variables/VariableValuePreview.tsx` — live evaluation preview

**Modified:**
- `packages/formulas/src/lexer.ts` — add `$` → `readVariableRef`
- `packages/formulas/src/parser.ts` — primary expr branch for `$name` → `VariableRef`
- `packages/formulas/src/ast.ts` — add `VariableRef` to `FormulaAST` union
- `packages/formulas/src/value.ts` — extend `FormulaContext` with `resolveVariable`, extend `DependencyKind`
- `packages/formulas/src/evaluator.ts` — handle `VariableRef`, push `"variable"` dependency
- `packages/formulas/src/formula.test.ts` — new test suites
- `packages/core/src/index.ts` — re-export `variable/*`
- `packages/ipc/src/index.ts` — re-export variables router + schemas
- `packages/ipc/src/router/index.ts` — register `variablesRouter` in root router
- `apps/web/src/lib/vault-worker/db-schema.ts` — append `variable` table
- `apps/web/src/lib/vault-worker/worker-router.ts` — wire `variables.*` handlers + thread `resolveVariable` into the existing `formulaContext`
- `apps/web/src/router.tsx` — add 3 variables routes, remove `graph` route
- `apps/web/src/components/shell/Sidebar.tsx` — reorganize `NAV_GROUPS`
- `apps/web/src/components/shell/mobile/MoreDrawer.tsx` — remove Recherche + Graph, add Variables, reorder Tags
- `apps/web/src/components/shell/mobile/MobileBottomNav.tsx` — update `more` href list
- `apps/web/src/components/shell/TopBar.tsx` — remove `graph`/`recherche` titles, add `variables`
- `apps/web/messages/fr.json` and `apps/web/messages/en.json` — add `nav.variables`, remove `nav.graph`
- `apps/web/src/lib/commands/seed.ts` — remove command pointing to `/graph` if any, add for `/variables`

**Deleted:**
- `apps/web/src/app/graph/page.tsx` (entire `graph` directory)

---

## Task 1: Variable zod schemas in @supernote/core

**Files:**
- Create: `packages/core/src/variable/index.ts`
- Create: `packages/core/src/variable/variable.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing test**

`packages/core/src/variable/variable.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { Variable, VariableInput, VariableType, VariableValue } from './index.js';

describe('Variable schemas', () => {
  it('accepts a literal number variable', () => {
    const parsed = Variable.parse({
      id: '01H0000000000000000000',
      name: 'tauxTVA',
      type: 'number',
      value: { kind: 'literal', value: 0.2 },
      createdAt: 1,
      updatedAt: 1,
    });
    expect(parsed.value).toEqual({ kind: 'literal', value: 0.2 });
  });

  it('accepts a formula variable', () => {
    const parsed = Variable.parse({
      id: '01H0000000000000000001',
      name: 'totalTTC',
      type: 'number',
      value: { kind: 'formula', expression: '100 * (1 + $tauxTVA)' },
      createdAt: 1,
      updatedAt: 1,
    });
    expect(parsed.value).toEqual({ kind: 'formula', expression: '100 * (1 + $tauxTVA)' });
  });

  it('rejects names with spaces or starting digits', () => {
    expect(() => VariableInput.parse({
      name: '1abc',
      type: 'number',
      value: { kind: 'literal', value: 1 },
    })).toThrow();
    expect(() => VariableInput.parse({
      name: 'taux TVA',
      type: 'number',
      value: { kind: 'literal', value: 1 },
    })).toThrow();
  });

  it('rejects formula without expression', () => {
    expect(() => VariableValue.parse({ kind: 'formula', expression: '' })).toThrow();
  });

  it('enumerates types', () => {
    expect(VariableType.options).toEqual(['number', 'string', 'boolean', 'date']);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm --filter @supernote/core test -- variable`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement schemas**

`packages/core/src/variable/index.ts`:
```ts
import { z } from 'zod';

export const VariableType = z.enum(['number', 'string', 'boolean', 'date']);
export type VariableType = z.infer<typeof VariableType>;

export const VariableValue = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('literal'),
    /** Numbers, strings, booleans stored as JSON. Dates stored as ISO string. */
    value: z.union([z.number(), z.string(), z.boolean()]),
  }),
  z.object({
    kind: z.literal('formula'),
    expression: z.string().min(1, 'expression must be non-empty'),
  }),
]);
export type VariableValue = z.infer<typeof VariableValue>;

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const VariableInput = z.object({
  name: z.string().regex(NAME_RE, 'name must be a valid identifier (letters, digits, underscore; no leading digit)'),
  type: VariableType,
  value: VariableValue,
});
export type VariableInput = z.infer<typeof VariableInput>;

export const Variable = VariableInput.extend({
  id: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Variable = z.infer<typeof Variable>;
```

- [ ] **Step 4: Re-export**

In `packages/core/src/index.ts`, append:
```ts
// Variable schemas
export * from './variable/index.js';
```

- [ ] **Step 5: Run, expect pass**

Run: `pnpm --filter @supernote/core test -- variable`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/variable packages/core/src/index.ts
git commit -m "feat(core): schemas zod Variable (literal + formule)"
```

---

## Task 2: `$` lexer token in @supernote/formulas

**Files:**
- Modify: `packages/formulas/src/lexer.ts`
- Modify: `packages/formulas/src/formula.test.ts`

- [ ] **Step 1: Write failing test**

Append at the bottom of `packages/formulas/src/formula.test.ts`:
```ts
import { tokenize } from './lexer.js';

describe('lexer $variable', () => {
  it('emits Identifier "$name" for $tauxTVA', () => {
    const res = tokenize('$tauxTVA + 1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const tokens = res.value;
    expect(tokens[0]).toMatchObject({ kind: 'Identifier', raw: '$tauxTVA' });
  });

  it('rejects bare $ with no name', () => {
    const res = tokenize('$ + 1');
    expect(res.ok).toBe(false);
  });

  it('does not consume $ inside string literal', () => {
    const res = tokenize('"$nope"');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value[0]?.kind).toBe('String');
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm --filter @supernote/formulas test -- "lexer \\$variable"`
Expected: FAIL.

- [ ] **Step 3: Inspect existing `readEntityRef` for the pattern**

Read `packages/formulas/src/lexer.ts` lines 195-220. Mirror its structure.

- [ ] **Step 4: Implement**

In `packages/formulas/src/lexer.ts`, in the dispatch block where `ch === "@"` triggers `readEntityRef`, add a sibling branch:
```ts
if (ch === '$') return this.readVariableRef(start);
```

Add the method (right after `readEntityRef`):
```ts
/** Read $varName → Identifier with raw `$<name>` */
private readVariableRef(start: Position): Result<Token, ParseError> {
  this.advance(); // consume $
  const nameStart = this.pos;
  while (this.pos < this.src.length && /[A-Za-z0-9_]/.test(this.src[this.pos]!)) {
    this.advance();
  }
  if (this.pos === nameStart) {
    return err({ kind: 'UnexpectedChar', pos: start, message: '$ must be followed by an identifier' });
  }
  const name = this.src.slice(nameStart, this.pos);
  return ok({ kind: 'Identifier', raw: `$${name}`, pos: start });
}
```

- [ ] **Step 5: Run, expect pass**

Run: `pnpm --filter @supernote/formulas test -- "lexer \\$variable"`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/formulas/src/lexer.ts packages/formulas/src/formula.test.ts
git commit -m "feat(formulas): lexer reconnaît \$name comme Identifier"
```

---

## Task 3: VariableRef AST + parser

**Files:**
- Modify: `packages/formulas/src/ast.ts`
- Modify: `packages/formulas/src/parser.ts`
- Modify: `packages/formulas/src/formula.test.ts`

- [ ] **Step 1: Write failing test**

Append in `formula.test.ts`:
```ts
import { parseFormula } from './parser.js';

describe('parser $variable', () => {
  it('parses $tauxTVA as VariableRef', () => {
    const res = parseFormula('$tauxTVA');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toMatchObject({ kind: 'VariableRef', name: 'tauxTVA' });
  });

  it('uses $variable in arithmetic', () => {
    const res = parseFormula('$a + $b * 2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ast = res.value as any;
    expect(ast.kind).toBe('BinaryOp');
    expect(ast.left).toMatchObject({ kind: 'VariableRef', name: 'a' });
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm --filter @supernote/formulas test -- "parser \\$variable"`
Expected: FAIL.

- [ ] **Step 3: Add AST node**

In `packages/formulas/src/ast.ts`, after the `EntityRef` interface, add:
```ts
/** $varName reference resolved via context */
export interface VariableRef {
  readonly kind: 'VariableRef';
  readonly name: string;       // sans le $
  readonly span: Span;
}
```

Add `VariableRef` to the `FormulaAST` union (the `|`-separated list).

- [ ] **Step 4: Wire parser**

In `packages/formulas/src/parser.ts`, in the primary expression method, **before** the `EntityRef` branch (the one checking `tok.raw.startsWith("@")`), add:
```ts
if (this.check('Identifier') && tok.raw.startsWith('$')) {
  this.advance();
  return ok({ kind: 'VariableRef', name: tok.raw.slice(1), span: span(start, start) });
}
```

- [ ] **Step 5: Run, expect pass**

Run: `pnpm --filter @supernote/formulas test -- "parser \\$variable"`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/formulas/src/ast.ts packages/formulas/src/parser.ts packages/formulas/src/formula.test.ts
git commit -m "feat(formulas): AST VariableRef + parser \$name"
```

---

## Task 4: Evaluator + FormulaContext.resolveVariable

**Files:**
- Modify: `packages/formulas/src/value.ts`
- Modify: `packages/formulas/src/evaluator.ts`
- Modify: `packages/formulas/src/formula.test.ts`

- [ ] **Step 1: Write failing test**

Append in `formula.test.ts`:
```ts
import { evaluate } from './evaluator.js';
import type { FormulaContext } from './value.js';

function mkCtx(vars: Record<string, unknown>): FormulaContext {
  return {
    resolveEntity: () => null,
    queryEntities: () => [],
    getRelations: () => [],
    now: () => new Date('2026-01-01T00:00:00Z'),
    resolveVariable: (name) => (name in vars ? (vars[name] as any) : null),
  };
}

describe('evaluator $variable', () => {
  it('resolves $name via context', () => {
    const ast = (parseFormula('$x + 1') as any).value;
    const res = evaluate(ast, mkCtx({ x: 41 }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toBe(42);
  });

  it('errors on unknown variable', () => {
    const ast = (parseFormula('$missing') as any).value;
    const res = evaluate(ast, mkCtx({}));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toMatch(/unknown variable.*missing/i);
  });

  it('tracks variable dependency', () => {
    const ast = (parseFormula('$x') as any).value;
    const deps: any[] = [];
    const ctx = { ...mkCtx({ x: 1 }) };
    const res = evaluate(ast, ctx, { onDependency: (d: any) => deps.push(d) });
    expect(res.ok).toBe(true);
    expect(deps).toContainEqual({ kind: 'variable', id: 'x' });
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm --filter @supernote/formulas test -- "evaluator \\$variable"`
Expected: FAIL (type error: `resolveVariable` not on `FormulaContext`).

- [ ] **Step 3: Extend FormulaContext + DependencyKind**

In `packages/formulas/src/value.ts`:
```ts
export interface FormulaContext {
  resolveEntity(ref: string): Entity | null;
  queryEntities(typeId: string, predicate?: FormulaAST): Entity[];
  getRelations(entityId: string, relationTypeId?: string): RelationEdge[];
  now(): Date;
  /** Resolve a $variable reference by name. Returns null if undefined. */
  resolveVariable(name: string): Value | null;
}

export type DependencyKind = 'entity' | 'entityType' | 'relation' | 'time' | 'variable';
```

- [ ] **Step 4: Wire evaluator**

In `packages/formulas/src/evaluator.ts`, in the `eval` switch, add a case for `VariableRef`:
```ts
case 'VariableRef': return this.evalVariableRef(node);
```

Add the method:
```ts
private evalVariableRef(node: { name: string }): Result<Value, EvalError> {
  this.recordDependency?.({ kind: 'variable', id: node.name });
  const v = this.context.resolveVariable(node.name);
  if (v === null) return err({ kind: 'UnknownVariable', message: `unknown variable $${node.name}` });
  return ok(v);
}
```

If `EvalError` is a discriminated union, add `'UnknownVariable'` to the error-kind union in `errors.ts`. Otherwise the existing generic `EvalError` shape suffices.

- [ ] **Step 5: Run, expect pass**

Run: `pnpm --filter @supernote/formulas test -- "evaluator \\$variable"`
Expected: PASS, 3 tests.

- [ ] **Step 6: Fix any pre-existing FormulaContext implementations to include resolveVariable**

The compiler will flag every place implementing `FormulaContext`. For each:
- `apps/web/src/lib/vault-worker/worker-router.ts` line 1621 (the `formulaContext: FormulaContext = { ... }` literal): add `resolveVariable: () => null,` as a temporary stub. Real impl in Task 6.
- Any other implementers: add `resolveVariable: () => null,`.

Run: `pnpm typecheck` → should pass.

- [ ] **Step 7: Commit**

```bash
git add packages/formulas/src apps/web/src/lib/vault-worker/worker-router.ts
git commit -m "feat(formulas): FormulaContext.resolveVariable + evaluator VariableRef"
```

---

## Task 5: IPC schemas + router stubs

**Files:**
- Create: `packages/ipc/src/schemas/variables.ts`
- Create: `packages/ipc/src/router/variables.router.ts`
- Create: `packages/ipc/src/router/variables.router.test.ts`
- Modify: `packages/ipc/src/router/index.ts`
- Modify: `packages/ipc/src/index.ts`

- [ ] **Step 1: Write failing test**

`packages/ipc/src/router/variables.router.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { variablesRouter } from './variables.router.js';

describe('variablesRouter', () => {
  it('exposes the expected procedures', () => {
    const procs = Object.keys((variablesRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(['create', 'delete', 'evaluate', 'get', 'list', 'update']);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `pnpm --filter @supernote/ipc test -- variables.router`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement schemas**

`packages/ipc/src/schemas/variables.ts`:
```ts
import { z } from 'zod';
import { Variable, VariableInput } from '@supernote/core';

export const ListVariablesOutput = z.array(Variable);

export const GetVariableInput = z.object({ id: z.string() });

export const CreateVariableInput = VariableInput;

export const UpdateVariableInput = z.object({
  id: z.string(),
  patch: VariableInput.partial(),
});

export const DeleteVariableInput = z.object({ id: z.string() });

export const EvaluatedValue = z.object({
  /** Stringified JSON of the resulting value, or null. */
  value: z.string().nullable(),
  /** Human-readable error message when evaluation fails. */
  error: z.string().nullable(),
});

export const EvaluateVariableInput = z.object({ id: z.string() });
export const EvaluateVariableOutput = EvaluatedValue;

export { Variable as VariableSchema };
```

- [ ] **Step 4: Implement router**

`packages/ipc/src/router/variables.router.ts`:
```ts
import { router, publicProcedure } from './trpc.js';
import { notImplemented } from '../errors/index.js';
import { z } from 'zod';
import { Variable } from '@supernote/core';
import {
  ListVariablesOutput,
  GetVariableInput,
  CreateVariableInput,
  UpdateVariableInput,
  DeleteVariableInput,
  EvaluateVariableInput,
  EvaluateVariableOutput,
} from '../schemas/variables.js';

export const variablesRouter = router({
  list: publicProcedure
    .output(ListVariablesOutput)
    .query(() => { throw notImplemented('variables.list'); }),

  get: publicProcedure
    .input(GetVariableInput)
    .output(Variable)
    .query(() => { throw notImplemented('variables.get'); }),

  create: publicProcedure
    .input(CreateVariableInput)
    .output(Variable)
    .mutation(() => { throw notImplemented('variables.create'); }),

  update: publicProcedure
    .input(UpdateVariableInput)
    .output(Variable)
    .mutation(() => { throw notImplemented('variables.update'); }),

  delete: publicProcedure
    .input(DeleteVariableInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(() => { throw notImplemented('variables.delete'); }),

  evaluate: publicProcedure
    .input(EvaluateVariableInput)
    .output(EvaluateVariableOutput)
    .query(() => { throw notImplemented('variables.evaluate'); }),
});

export type VariablesRouter = typeof variablesRouter;
```

- [ ] **Step 5: Register in root router + barrel**

In `packages/ipc/src/router/index.ts`, after the `templatesRouter` import/export:
```ts
import { variablesRouter } from './variables.router.js';
// add to the root router's `router({ ... })` block under key `variables: variablesRouter,`
export { variablesRouter, type VariablesRouter } from './variables.router.js';
```

In `packages/ipc/src/index.ts`, after the existing `* from './router/...'` lines:
```ts
export * from './schemas/variables.js';
```

- [ ] **Step 6: Run, expect pass**

Run: `pnpm --filter @supernote/ipc test -- variables.router`
Expected: PASS, 1 test.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ipc/src/schemas/variables.ts packages/ipc/src/router/variables.router.ts packages/ipc/src/router/variables.router.test.ts packages/ipc/src/router/index.ts packages/ipc/src/index.ts
git commit -m "feat(ipc): variables.router (CRUD + evaluate) avec schemas zod"
```

---

## Task 6: SQL table + worker handlers + cycle-safe resolver

**Files:**
- Modify: `apps/web/src/lib/vault-worker/db-schema.ts`
- Create: `apps/web/src/lib/vault-worker/variables.ts`
- Create: `apps/web/src/lib/vault-worker/variables.test.ts`
- Modify: `apps/web/src/lib/vault-worker/worker-router.ts`

- [ ] **Step 1: Append SQL table**

In `apps/web/src/lib/vault-worker/db-schema.ts`, at the end of `SCHEMA_SQL_BASE` (before the closing `` ` ``):
```sql
CREATE TABLE IF NOT EXISTS "variable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL UNIQUE,
    "type" TEXT NOT NULL CHECK ("type" IN ('number','string','boolean','date')),
    "value_kind" TEXT NOT NULL CHECK ("value_kind" IN ('literal','formula')),
    "literal_json" TEXT,
    "formula_expr" TEXT,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL,
    CHECK ((value_kind = 'literal' AND literal_json IS NOT NULL AND formula_expr IS NULL)
         OR (value_kind = 'formula' AND formula_expr IS NOT NULL AND literal_json IS NULL))
);
CREATE INDEX IF NOT EXISTS "idx_variable_name" ON "variable" ("name");
```

- [ ] **Step 2: Write failing test**

`apps/web/src/lib/vault-worker/variables.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import { SCHEMA_SQL_BASE } from './db-schema.js';
import {
  insertVariable,
  listVariables,
  updateVariable,
  deleteVariable,
  resolveVariable,
} from './variables.js';

let db: Database;

beforeEach(async () => {
  const SQL = await initSqlJs({});
  db = new SQL.Database();
  db.exec(SCHEMA_SQL_BASE);
});

describe('variables worker helpers', () => {
  it('inserts and lists', () => {
    insertVariable(db, {
      id: '01',
      name: 'tauxTVA',
      type: 'number',
      value: { kind: 'literal', value: 0.2 },
    });
    const list = listVariables(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'tauxTVA', type: 'number' });
  });

  it('resolves a literal variable', () => {
    insertVariable(db, {
      id: '01',
      name: 'pi',
      type: 'number',
      value: { kind: 'literal', value: 3.14 },
    });
    expect(resolveVariable(db, 'pi')).toBe(3.14);
  });

  it('resolves a formula variable referencing another', () => {
    insertVariable(db, { id: '01', name: 'a', type: 'number', value: { kind: 'literal', value: 10 } });
    insertVariable(db, { id: '02', name: 'b', type: 'number', value: { kind: 'formula', expression: '$a * 2' } });
    expect(resolveVariable(db, 'b')).toBe(20);
  });

  it('throws on cycle', () => {
    insertVariable(db, { id: '01', name: 'a', type: 'number', value: { kind: 'formula', expression: '$b' } });
    insertVariable(db, { id: '02', name: 'b', type: 'number', value: { kind: 'formula', expression: '$a' } });
    expect(() => resolveVariable(db, 'a')).toThrow(/circular variable reference/i);
  });

  it('coerces literal date string', () => {
    insertVariable(db, {
      id: '01',
      name: 'd',
      type: 'date',
      value: { kind: 'literal', value: '2026-05-14T00:00:00.000Z' },
    });
    const r = resolveVariable(db, 'd');
    expect(r).toBeInstanceOf(Date);
  });

  it('update + delete', () => {
    insertVariable(db, { id: '01', name: 'x', type: 'number', value: { kind: 'literal', value: 1 } });
    updateVariable(db, '01', { value: { kind: 'literal', value: 2 } });
    expect(resolveVariable(db, 'x')).toBe(2);
    deleteVariable(db, '01');
    expect(listVariables(db)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run, expect fail**

Run: `pnpm --filter web test -- variables`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement helpers**

`apps/web/src/lib/vault-worker/variables.ts`:
```ts
import type { Database } from './sqlite-adapter';
import type { Variable, VariableInput } from '@supernote/core';
import { parseFormula, evaluate, type FormulaContext, type Value as FormulaValue } from '@supernote/formulas';

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

function rowToVariable(r: VariableRow): Variable {
  const value: Variable['value'] = r.value_kind === 'literal'
    ? { kind: 'literal', value: JSON.parse(r.literal_json!) }
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

function execRows<T>(db: Database, sql: string, params: unknown[] = []): T[] {
  const res = db.exec(sql, params as never);
  if (!res.length || !res[0]) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i] ?? null])) as T);
}

export function listVariables(db: Database): Variable[] {
  return execRows<VariableRow>(db, 'SELECT * FROM "variable" ORDER BY "name"').map(rowToVariable);
}

export function getVariable(db: Database, id: string): Variable | null {
  const r = execRows<VariableRow>(db, 'SELECT * FROM "variable" WHERE id = ?', [id])[0];
  return r ? rowToVariable(r) : null;
}

export function insertVariable(db: Database, input: VariableInput & { id: string }): Variable {
  const now = Date.now();
  const literal_json = input.value.kind === 'literal' ? JSON.stringify(input.value.value) : null;
  const formula_expr = input.value.kind === 'formula' ? input.value.expression : null;
  db.exec(
    'INSERT INTO "variable" (id, name, type, value_kind, literal_json, formula_expr, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [input.id, input.name, input.type, input.value.kind, literal_json, formula_expr, now, now] as never,
  );
  return getVariable(db, input.id)!;
}

export function updateVariable(db: Database, id: string, patch: Partial<VariableInput>): Variable {
  const current = getVariable(db, id);
  if (!current) throw new Error(`variable ${id} not found`);
  const next = { ...current, ...patch, value: patch.value ?? current.value };
  const now = Date.now();
  const literal_json = next.value.kind === 'literal' ? JSON.stringify(next.value.value) : null;
  const formula_expr = next.value.kind === 'formula' ? next.value.expression : null;
  db.exec(
    'UPDATE "variable" SET name = ?, type = ?, value_kind = ?, literal_json = ?, formula_expr = ?, updatedAt = ? WHERE id = ?',
    [next.name, next.type, next.value.kind, literal_json, formula_expr, now, id] as never,
  );
  return getVariable(db, id)!;
}

export function deleteVariable(db: Database, id: string): boolean {
  db.exec('DELETE FROM "variable" WHERE id = ?', [id] as never);
  return true;
}

function coerce(value: FormulaValue, type: VariableRow['type']): FormulaValue {
  if (value === null) return null;
  switch (type) {
    case 'number': return typeof value === 'number' ? value : Number(value as never);
    case 'string': return typeof value === 'string' ? value : String(value as never);
    case 'boolean': return typeof value === 'boolean' ? value : Boolean(value);
    case 'date':   return value instanceof Date ? value : new Date(value as never);
  }
}

export function makeVariableResolver(
  db: Database,
  baseContext: Omit<FormulaContext, 'resolveVariable'>,
  evalStack: Set<string> = new Set(),
): FormulaContext['resolveVariable'] {
  return (name) => {
    if (evalStack.has(name)) {
      throw new Error(`circular variable reference: $${name}`);
    }
    const r = execRows<VariableRow>(db, 'SELECT * FROM "variable" WHERE name = ?', [name])[0];
    if (!r) return null;
    if (r.value_kind === 'literal') {
      return coerce(JSON.parse(r.literal_json!), r.type);
    }
    const nested = new Set(evalStack);
    nested.add(name);
    const parsed = parseFormula(r.formula_expr!);
    if (!parsed.ok) throw new Error(`variable ${name} formula parse error: ${parsed.error.message ?? 'parse error'}`);
    const childCtx: FormulaContext = {
      ...baseContext,
      resolveVariable: makeVariableResolver(db, baseContext, nested),
    };
    const result = evaluate(parsed.value, childCtx);
    if (!result.ok) throw new Error(`variable ${name}: ${result.error.message ?? 'eval error'}`);
    return coerce(result.value, r.type);
  };
}

/** Convenience for tests + simple call sites. */
export function resolveVariable(db: Database, name: string): FormulaValue {
  const noopCtx: Omit<FormulaContext, 'resolveVariable'> = {
    resolveEntity: () => null,
    queryEntities: () => [],
    getRelations: () => [],
    now: () => new Date(),
  };
  return makeVariableResolver(db, noopCtx)(name);
}
```

- [ ] **Step 5: Run, expect pass**

Run: `pnpm --filter web test -- variables`
Expected: PASS, 6 tests.

- [ ] **Step 6: Wire worker-router handlers**

In `apps/web/src/lib/vault-worker/worker-router.ts`:

a) Add import at the top of the file (after existing imports):
```ts
import {
  listVariables,
  getVariable,
  insertVariable,
  updateVariable,
  deleteVariable,
  makeVariableResolver,
} from './variables';
import { ulid } from '@supernote/core';
```

b) Replace the placeholder `resolveVariable: () => null,` from Task 4 with a real resolver. Find the literal at ~line 1621 and change to:
```ts
const baseContext = {
  resolveEntity: (ref: string) => loadEntityByRef(ref) as never,
  queryEntities: (typeId: string) => loadEntitiesOfType(typeId) as never,
  getRelations: () => [],
  now: () => new Date(),
};
const formulaContext: FormulaContext = {
  ...baseContext,
  resolveVariable: makeVariableResolver(db, baseContext),
};
```

c) Add new case branches in the route dispatch (find the existing switch-on-`procedure` or the `if (path === 'entities.list')`-style chain — match the existing convention):

```ts
case 'variables.list':
  return listVariables(db);
case 'variables.get':
  return getVariable(db, (input as { id: string }).id);
case 'variables.create': {
  const id = ulid();
  return insertVariable(db, { id, ...(input as VariableInput) });
}
case 'variables.update': {
  const { id, patch } = input as { id: string; patch: Partial<VariableInput> };
  return updateVariable(db, id, patch);
}
case 'variables.delete': {
  const { id } = input as { id: string };
  deleteVariable(db, id);
  return { id, deleted: true };
}
case 'variables.evaluate': {
  const { id } = input as { id: string };
  const v = getVariable(db, id);
  if (!v) return { value: null, error: `variable ${id} not found` };
  try {
    const val = makeVariableResolver(db, baseContext)(v.name);
    return { value: JSON.stringify(val), error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : String(e) };
  }
}
```

(The exact dispatch shape varies — match what's already in the file. If `worker-router.ts` uses a dictionary mapping rather than a switch, add entries to that dictionary.)

- [ ] **Step 7: Run typecheck + tests**

Run: `pnpm typecheck && pnpm --filter web test -- variables`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/vault-worker
git commit -m "feat(worker): table variable + resolver cycle-safe + handlers tRPC"
```

---

## Task 7: Sidebar reorganization + remove graph + i18n

**Files:**
- Modify: `apps/web/src/components/shell/Sidebar.tsx`
- Modify: `apps/web/src/components/shell/mobile/MoreDrawer.tsx`
- Modify: `apps/web/src/components/shell/mobile/MobileBottomNav.tsx`
- Modify: `apps/web/src/components/shell/TopBar.tsx`
- Modify: `apps/web/messages/fr.json`
- Modify: `apps/web/messages/en.json`
- Delete: `apps/web/src/app/graph/page.tsx` (entire dir)
- Modify: `apps/web/src/router.tsx`

- [ ] **Step 1: Update Sidebar NAV_GROUPS**

In `apps/web/src/components/shell/Sidebar.tsx`:

a) Update imports: remove `Graph, MagnifyingGlass` from the `@phosphor-icons/react` destructured imports if they are only used by NAV_GROUPS. Add `Function`. The remaining imports stay alphabetical:
```ts
import {
  Archive,
  Bell,
  CaretDown,
  Calendar,
  Check,
  CheckSquare,
  FileText,
  FolderOpen,
  Function,
  GitBranch,
  Gear,
  House,
  Lightning,
  Tag,
  Trash,
  Users,
  Wallet,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
```

(If `MagnifyingGlass` is referenced elsewhere in this file e.g. for the search shortcut UI, keep it.)

b) Replace `NAV_GROUPS` (lines 60-87) with:
```ts
const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "nav.groups.navigation",
    items: [
      { labelKey: "nav.home", icon: House, href: "/" },
    ],
  },
  {
    labelKey: "nav.groups.knowledge",
    items: [
      { labelKey: "nav.notes", icon: FileText, href: "/notes" },
      { labelKey: "nav.archive", icon: Archive, href: "/archive" },
      { labelKey: "nav.todos", icon: CheckSquare, href: "/todos" },
      { labelKey: "nav.journal", icon: Calendar, href: "/journal" },
      { labelKey: "nav.contacts", icon: Users, href: "/contacts" },
      { labelKey: "nav.finance", icon: Wallet, href: "/finance" },
    ],
  },
  {
    labelKey: "nav.groups.tools",
    items: [
      { labelKey: "nav.tags", icon: Tag, href: "/tags" },
      { labelKey: "nav.variables", icon: Function, href: "/variables" },
      { labelKey: "nav.routines", icon: Lightning, href: "/routines" },
    ],
  },
];
```

- [ ] **Step 2: Update MoreDrawer**

In `apps/web/src/components/shell/mobile/MoreDrawer.tsx`:
- Remove the entry at line 45 (`Recherche`).
- Remove the entry at line 56 (`Graph`).
- Add a new entry for Variables near the other tools section. Use `Function` icon. Match the existing oklch tint style of neighbors.
- Reorder so `Tags` comes after Finance in the same group as Variables/Routines (mirror Sidebar grouping). The exact array structure matches the file's existing shape — preserve it.

After edit, run: `pnpm typecheck` to catch missing imports.

- [ ] **Step 3: Update MobileBottomNav**

In `apps/web/src/components/shell/mobile/MobileBottomNav.tsx` line 77-78, change the `more` href list:
```ts
["/contacts", "/finance", "/tags",
"/variables", "/routines", "/templates", "/parametres",
```
(Removed `/graph` and `/recherche`. Added `/variables`.)

- [ ] **Step 4: Update TopBar titles**

In `apps/web/src/components/shell/TopBar.tsx` lines 21-23:
```ts
// remove:  graph: "Graph",
// remove:  recherche: "Recherche",
// keep other entries; add:
variables: "Variables",
```

- [ ] **Step 5: Update i18n**

In `apps/web/messages/fr.json` `nav` block:
- Remove `"graph": "Graph",`
- Add `"variables": "Variables",`

In `apps/web/messages/en.json` `nav` block:
- Remove `"graph": "Graph",`
- Add `"variables": "Variables",`

(Keep `nav.search` in both files — TopBar still uses it.)

- [ ] **Step 6: Remove graph route + dir**

In `apps/web/src/router.tsx` line 130, delete the line:
```ts
{ path: "graph", lazy: lazyPage(() => import("./app/graph/page")) },
```

Delete the directory:
```bash
git rm -r apps/web/src/app/graph
```

- [ ] **Step 7: Remove dangling `/graph` references**

Run: `grep -rn "/graph\|nav.graph\|app/graph" apps/web/src/ apps/web/messages/`
Expected: no matches. Remove any leftover hits (e.g. in `apps/web/src/lib/commands/seed.ts` if it has a `Graph` command).

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm typecheck`
Expected: PASS.

```bash
git add apps/web/src apps/web/messages
git commit -m "feat(nav): réorg sidebar (Variables dans Tools, retire Graph + Recherche sidebar)"
```

---

## Task 8: Variables list page

**Files:**
- Create: `apps/web/src/app/variables/page.tsx`
- Modify: `apps/web/src/router.tsx`

- [ ] **Step 1: Add route**

In `apps/web/src/router.tsx`, after the `routines` route, add:
```ts
{ path: "variables", lazy: lazyPage(() => import("./app/variables/page")) },
{ path: "variables/nouveau", lazy: lazyPage(() => import("./app/variables/nouveau/page")) },
{ path: "variables/:id", lazy: lazyPage(() => import("./app/variables/[id]/page")) },
```

- [ ] **Step 2: Implement list page**

`apps/web/src/app/variables/page.tsx`:
```tsx
"use client";

import { Button, Card, CardBody, Chip, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, Spinner } from "@heroui/react";
import { Plus, PencilSimple, Trash } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { useState } from "react";
import { DeleteVariableModal } from "@/components/variables/DeleteVariableModal";

export default function VariablesPage() {
  const router = useRouter();
  const { data, isLoading, refetch } = trpc.variables.list.useQuery();
  const [toDelete, setToDelete] = useState<string | null>(null);

  if (isLoading) {
    return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Variables</h1>
        <Button color="primary" startContent={<Plus size={16} />} as={Link} href="/variables/nouveau">
          Nouvelle variable
        </Button>
      </div>

      <Card>
        <CardBody className="p-0">
          <Table aria-label="Variables" removeWrapper>
            <TableHeader>
              <TableColumn>Nom</TableColumn>
              <TableColumn>Type</TableColumn>
              <TableColumn>Source</TableColumn>
              <TableColumn>Aperçu</TableColumn>
              <TableColumn align="end">Actions</TableColumn>
            </TableHeader>
            <TableBody emptyContent="Aucune variable. Créez-en une pour la réutiliser dans vos formules.">
              {(data ?? []).map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <span className="font-mono text-sm">${v.name}</span>
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" variant="flat">{v.type}</Chip>
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" variant="flat" color={v.value.kind === "formula" ? "secondary" : "default"}>
                      {v.value.kind}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <VariablePreview id={v.id} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button isIconOnly size="sm" variant="light" as={Link} href={`/variables/${v.id}`} aria-label="Éditer">
                        <PencilSimple size={16} />
                      </Button>
                      <Button isIconOnly size="sm" variant="light" color="danger" onPress={() => setToDelete(v.id)} aria-label="Supprimer">
                        <Trash size={16} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      <DeleteVariableModal
        isOpen={toDelete !== null}
        variableId={toDelete}
        onClose={() => setToDelete(null)}
        onDeleted={() => { setToDelete(null); refetch(); }}
      />
    </div>
  );
}

function VariablePreview({ id }: { id: string }) {
  const { data } = trpc.variables.evaluate.useQuery({ id });
  if (!data) return <span className="text-default-400">…</span>;
  if (data.error) return <span className="text-danger text-sm">{data.error}</span>;
  return <span className="font-mono text-sm">{data.value ?? "null"}</span>;
}
```

- [ ] **Step 3: Create DeleteVariableModal**

`apps/web/src/components/variables/DeleteVariableModal.tsx`:
```tsx
"use client";

import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";
import { trpc } from "@/lib/trpc/client";

export function DeleteVariableModal({
  isOpen,
  variableId,
  onClose,
  onDeleted,
}: {
  isOpen: boolean;
  variableId: string | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const del = trpc.variables.delete.useMutation();

  async function handleDelete() {
    if (!variableId) return;
    await del.mutateAsync({ id: variableId });
    onDeleted();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalContent>
        <ModalHeader>Supprimer la variable</ModalHeader>
        <ModalBody>
          Les formules qui référencent cette variable afficheront une erreur après suppression.
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>Annuler</Button>
          <Button color="danger" isLoading={del.isPending} onPress={handleDelete}>Supprimer</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 4: Verify route renders**

Run: `pnpm --filter web dev` in a separate terminal, navigate to `http://localhost:3000/variables`.
Expected: empty list with "Nouvelle variable" button. No console errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/variables/page.tsx apps/web/src/components/variables/DeleteVariableModal.tsx apps/web/src/router.tsx
git commit -m "feat(variables): page liste + suppression"
```

---

## Task 9: Variables create/edit form

**Files:**
- Create: `apps/web/src/app/variables/nouveau/page.tsx`
- Create: `apps/web/src/app/variables/[id]/page.tsx`
- Create: `apps/web/src/components/variables/VariableForm.tsx`

- [ ] **Step 1: Implement shared form**

`apps/web/src/components/variables/VariableForm.tsx`:
```tsx
"use client";

import {
  Button,
  Card,
  CardBody,
  Input,
  Radio,
  RadioGroup,
  Select,
  SelectItem,
  Switch,
  Textarea,
} from "@heroui/react";
import { useState, useEffect } from "react";
import type { Variable, VariableInput, VariableType, VariableValue } from "@supernote/core";

export interface VariableFormProps {
  initial?: Variable;
  submitLabel: string;
  onSubmit: (input: VariableInput) => Promise<void>;
  evaluatedPreview?: { value: string | null; error: string | null } | null;
}

const TYPES: VariableType[] = ["number", "string", "boolean", "date"];

export function VariableForm({ initial, submitLabel, onSubmit, evaluatedPreview }: VariableFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<VariableType>(initial?.type ?? "number");
  const [valueKind, setValueKind] = useState<"literal" | "formula">(initial?.value.kind ?? "literal");
  const [literalValue, setLiteralValue] = useState<string>(
    initial?.value.kind === "literal" ? String(initial.value.value) : "",
  );
  const [boolValue, setBoolValue] = useState<boolean>(
    initial?.value.kind === "literal" && typeof initial.value.value === "boolean" ? initial.value.value : false,
  );
  const [expression, setExpression] = useState<string>(
    initial?.value.kind === "formula" ? initial.value.expression : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initial) return;
    setName(initial.name);
    setType(initial.type);
    setValueKind(initial.value.kind);
    if (initial.value.kind === "literal") {
      if (typeof initial.value.value === "boolean") setBoolValue(initial.value.value);
      else setLiteralValue(String(initial.value.value));
    } else {
      setExpression(initial.value.expression);
    }
  }, [initial]);

  function buildValue(): VariableValue {
    if (valueKind === "formula") return { kind: "formula", expression: expression.trim() };
    if (type === "boolean") return { kind: "literal", value: boolValue };
    if (type === "number") return { kind: "literal", value: Number(literalValue) };
    return { kind: "literal", value: literalValue };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), type, value: buildValue() });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">{initial ? `Variable $${initial.name}` : "Nouvelle variable"}</h1>

      <Card><CardBody className="space-y-4">
        <Input
          label="Nom"
          placeholder="tauxTVA"
          value={name}
          onValueChange={setName}
          startContent={<span className="text-default-400">$</span>}
          description="Lettres, chiffres et underscore. Référencée en formule via $nom."
          isRequired
        />

        <Select label="Type" selectedKeys={[type]} onChange={(e) => setType(e.target.value as VariableType)}>
          {TYPES.map((t) => <SelectItem key={t}>{t}</SelectItem>)}
        </Select>

        <RadioGroup label="Source de la valeur" orientation="horizontal" value={valueKind} onValueChange={(v) => setValueKind(v as "literal" | "formula")}>
          <Radio value="literal">Littérale</Radio>
          <Radio value="formula">Formule</Radio>
        </RadioGroup>

        {valueKind === "literal" && type === "boolean" && (
          <Switch isSelected={boolValue} onValueChange={setBoolValue}>{boolValue ? "true" : "false"}</Switch>
        )}
        {valueKind === "literal" && type !== "boolean" && (
          <Input
            label="Valeur"
            type={type === "number" ? "number" : type === "date" ? "datetime-local" : "text"}
            value={literalValue}
            onValueChange={setLiteralValue}
            isRequired
          />
        )}
        {valueKind === "formula" && (
          <Textarea
            label="Expression"
            placeholder="100 * (1 + $tauxTVA)"
            value={expression}
            onValueChange={setExpression}
            minRows={3}
            classNames={{ input: "font-mono" }}
            isRequired
          />
        )}
      </CardBody></Card>

      {evaluatedPreview && (
        <Card><CardBody>
          <div className="text-sm text-default-500 mb-1">Aperçu</div>
          {evaluatedPreview.error
            ? <div className="text-danger font-mono text-sm">{evaluatedPreview.error}</div>
            : <div className="font-mono">{evaluatedPreview.value ?? "null"}</div>}
        </CardBody></Card>
      )}

      {error && <div className="text-danger text-sm">{error}</div>}

      <div className="flex justify-end gap-2">
        <Button type="submit" color="primary" isLoading={submitting}>{submitLabel}</Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Create page**

`apps/web/src/app/variables/nouveau/page.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { VariableForm } from "@/components/variables/VariableForm";
import { trpc } from "@/lib/trpc/client";

export default function NewVariablePage() {
  const router = useRouter();
  const create = trpc.variables.create.useMutation();

  return (
    <VariableForm
      submitLabel="Créer"
      onSubmit={async (input) => {
        const v = await create.mutateAsync(input);
        router.push(`/variables/${v.id}`);
      }}
    />
  );
}
```

- [ ] **Step 3: Edit page**

`apps/web/src/app/variables/[id]/page.tsx`:
```tsx
"use client";

import { useParams } from "next/navigation";
import { VariableForm } from "@/components/variables/VariableForm";
import { trpc } from "@/lib/trpc/client";
import { Spinner } from "@heroui/react";

export default function EditVariablePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = trpc.variables.get.useQuery({ id });
  const { data: evaluated } = trpc.variables.evaluate.useQuery({ id });
  const update = trpc.variables.update.useMutation();

  if (isLoading || !data) {
    return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  }

  return (
    <VariableForm
      initial={data}
      submitLabel="Enregistrer"
      evaluatedPreview={evaluated ?? null}
      onSubmit={async (input) => {
        await update.mutateAsync({ id, patch: input });
      }}
    />
  );
}
```

- [ ] **Step 4: Manual smoke**

Run dev server (`pnpm --filter web dev`). Navigate `/variables/nouveau` → create `$tauxTVA = 0.2` (number literal). Then create `$totalTTC = 100 * (1 + $tauxTVA)` (number formula). Edit page should show preview `120`.

Cycle test : edit `$a` to `$b + 1`, `$b` to `$a * 2`, observe error "circular variable reference: $a".

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/variables apps/web/src/components/variables/VariableForm.tsx
git commit -m "feat(variables): form création/édition avec preview live"
```

---

## Task 10: End-to-end verification

- [ ] **Step 1: Full typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 2: Full test suite**

Run: `pnpm -r test`
Expected: PASS.

- [ ] **Step 3: Manual usage in a formula bloc**

Open an entity in `/notes` containing a formula block. Edit a formula to use `$tauxTVA`. Confirm it evaluates. Delete `$tauxTVA` via `/variables`. Return to the note — formula block displays `unknown variable $tauxTVA`.

- [ ] **Step 4: Sidebar smoke**

Confirm sidebar shows: Home / Notes-Archive-Todos-Journal-Contacts-Finance / Tags-Variables-Routines. `/graph` returns 404. `/recherche` accessible via TopBar search.

- [ ] **Step 5: Final commit if any leftover**

```bash
git status
# if any leftover docs/changelog, commit:
git commit -am "chore(variables): finalisation"
```

---

## Notes pour l'implémenteur

- **DRY** : `makeVariableResolver` est réutilisé pour la résolution dans les formules d'entités et pour l'endpoint `variables.evaluate`. Ne pas dupliquer.
- **YAGNI** : pas de cascade de renommage, pas de scope par base, pas d'historique. Tout cela est hors-scope (spec).
- **TDD** : chaque task écrit le test en premier, vérifie qu'il échoue, implémente, vérifie qu'il passe, commit. Respecter cet ordre.
- **HeroUI v3 only** : aucun `<button>`/`<input>` HTML nu. Utiliser les composants de `@heroui/react`.
- **Conventional commits FR** : `feat(scope): description en français`.
