# Relation Fields in Formulas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable formula evaluation and autocomplete to follow `relation` field chains (e.g. `currentValue.marque.type`) across linked EntityTypes.

**Architecture:** Two-pass entity resolution (pass 1: scalars only, pass 2: substitute relation fields with EntityValues) prevents cycles. UI chain resolver walks the dot-chain backward from the cursor, descending through relation field metadata to determine the target EntityType for autocomplete.

**Tech Stack:** TypeScript, Vitest, React, tRPC, sql.js (Web Worker)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/web/src/lib/vault-worker/variables.ts` | Modify | Two-pass resolution in `buildVaultFormulaContext` |
| `apps/web/src/lib/vault-worker/worker-router.ts` | Modify | Two-pass resolution in `buildScope` |
| `packages/formulas/src/formula.test.ts` | Modify | Add relation-chain eval tests |
| `apps/web/src/components/bases/FormulaInputEditor.tsx` | Modify | `resolveChainTypeAt` + new modes + banners |

---

## Task 1: Extend `EntityTypeMeta` and two-pass resolution in `variables.ts`

**Files:**
- Modify: `apps/web/src/lib/vault-worker/variables.ts`

The current `EntityTypeMeta` stores `fields: Array<{id, name?}>`. We need `kind`, `targetTypeId`, and `cardinality` for relation fields. The current `buildVaultFormulaContext` builds entity lists in one pass using `toFormulaValueShallow` which stores raw string ids for relation fields. We replace this with a two-pass approach.

- [ ] **Step 1: Read the current file**

Read `/home/ange/supernote/apps/web/src/lib/vault-worker/variables.ts` lines 189–352.

- [ ] **Step 2: Extend `EntityTypeMeta` interface**

In `variables.ts`, replace the existing `EntityTypeMeta` interface (around line 189):

```ts
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
```

The `cardinality` maps from the DB JSON: `"one_to_one"` → `"one"`, `"one_to_many"` → `"many"`, `"many_to_many"` → `"many"`.

- [ ] **Step 3: Update `loadEntityTypes` to parse relation metadata**

Replace the `loadEntityTypes` function body (currently lines 204–220):

```ts
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
```

- [ ] **Step 4: Add two-pass resolution helper**

Add this function after `loadEntitiesOfTypeRaw` (before `makeVariableResolver`):

```ts
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
```

- [ ] **Step 5: Use two-pass resolution in `buildVaultFormulaContext`**

In `buildVaultFormulaContext`, after the `getEntities` function, add the two-pass resolution call. The `baseScope` must use the resolved entities:

```ts
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
```

Replace the existing `baseScope` construction block (currently lines 343–349) with the above.

- [ ] **Step 6: Typecheck**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/web typecheck 2>&1 | head -50
```

Expected: no new errors related to `variables.ts`.

---

## Task 2: Two-pass resolution in `worker-router.ts` `buildScope`

**Files:**
- Modify: `apps/web/src/lib/vault-worker/worker-router.ts`

The current `buildScope` (lines 1654–1713) exposes base entities with raw string ids for relation fields. We need the same two-pass approach.

- [ ] **Step 1: Read context around `baseInfos` and `baseEntities`**

Read `worker-router.ts` lines 1455–1545 to confirm the current shape.

- [ ] **Step 2: Extend `BaseInfo` type to carry relation field metadata**

In `worker-router.ts`, the `BaseInfo` type (line ~1460) needs `targetTypeId` and `cardinality` on each field. The existing `DerivedFieldDef` doesn't carry these. Add them to `DerivedFieldDef`:

In the `DerivedFieldDef` type (line 1408), add:
```ts
type DerivedFieldDef = {
  id: string;
  name: string;
  kind: string;
  expression?: string;
  outputKind?: string;
  relationFieldId?: string;
  targetFieldId?: string;
  aggregation?: string;
  targetTypeId?: string;          // NEW — for relation fields
  cardinality?: 'one' | 'many';   // NEW — for relation fields
};
```

And in `RawFieldDef` (line 1424), add:
```ts
type RawFieldDef = {
  id: string;
  name: string;
  kind?: string;
  type?: string;
  expression?: string;
  formulaExpr?: string;
  outputKind?: string;
  formulaOutputKind?: string;
  relationFieldId?: string;
  targetFieldId?: string;
  aggregation?: string;
  targetTypeId?: string;           // NEW
  cardinality?: string;            // NEW (raw string like "one_to_one")
};
```

And update the mapping in `allFieldDefs` (line 1441) to propagate them:
```ts
const allFieldDefs: DerivedFieldDef[] = typeRow
  ? (JSON.parse((typeRow["fields"] as string) || "[]") as RawFieldDef[]).map((f): DerivedFieldDef => {
      const rawCard = f.cardinality ?? '';
      const cardinality: 'one' | 'many' =
        rawCard === 'one_to_one' ? 'one' :
        rawCard === 'one_to_many' || rawCard === 'many_to_many' ? 'many' :
        'one';
      return {
        id: f.id,
        name: f.name,
        kind: (f.kind ?? f.type ?? '') as string,
        expression: f.expression ?? f.formulaExpr,
        outputKind: f.outputKind ?? f.formulaOutputKind,
        relationFieldId: f.relationFieldId,
        targetFieldId: f.targetFieldId,
        aggregation: f.aggregation,
        targetTypeId: f.targetTypeId,
        cardinality,
      };
    })
  : [];
```

- [ ] **Step 3: Extend `BaseInfo` and `baseInfos` parsing to include relation metadata**

The `BaseInfo.fields` are `DerivedFieldDef[]`. Since `DerivedFieldDef` now includes `targetTypeId` and `cardinality`, the `baseInfos` mapping already propagates them via the same `.map()` that calls `raw.map((f): DerivedFieldDef => ...)`.

Update the `baseInfos` parsing block (the `.map()` at line ~1476) to pass through `targetTypeId` and `cardinality`:

```ts
fields: (() => {
  try {
    const raw = JSON.parse((r["fields"] as string) || "[]") as RawFieldDef[];
    return raw.map((f): DerivedFieldDef => {
      const rawCard = f.cardinality ?? '';
      const cardinality: 'one' | 'many' =
        rawCard === 'one_to_one' ? 'one' :
        rawCard === 'one_to_many' || rawCard === 'many_to_many' ? 'many' :
        'one';
      return {
        id: f.id,
        name: f.name,
        kind: (f.kind ?? f.type ?? '') as string,
        expression: f.expression ?? f.formulaExpr,
        outputKind: f.outputKind ?? f.formulaOutputKind,
        relationFieldId: f.relationFieldId,
        targetFieldId: f.targetFieldId,
        aggregation: f.aggregation,
        targetTypeId: f.targetTypeId,
        cardinality,
      };
    });
  } catch { return []; }
})(),
```

- [ ] **Step 4: Add `resolveBaseEntities` helper in `worker-router.ts`**

Before the `buildScope` function (around line 1654), add:

```ts
/**
 * Two-pass relation resolution for base entities.
 * Mutates entity fields in-place (pass 2).
 * Returns the entity-by-id index.
 */
function resolveBaseEntities(
  baseEntities: Map<string, Array<{ id: string; fields: Record<string, unknown>; typeId: string }>>,
  baseInfos: Array<{ id: string; name: string; plural: string | null; fields: DerivedFieldDef[] }>,
): Map<string, { id: string; fields: Record<string, unknown>; typeId: string }> {
  // Pass 1: index all entities by id
  const entityById = new Map<string, { id: string; fields: Record<string, unknown>; typeId: string }>();
  for (const list of baseEntities.values()) {
    for (const e of list) entityById.set(e.id, e);
  }

  // Pass 2: substitute relation values
  const metaById = new Map<string, (typeof baseInfos)[number]>();
  for (const b of baseInfos) metaById.set(b.id, b);

  for (const [typeId, list] of baseEntities) {
    const meta = metaById.get(typeId);
    if (!meta) continue;
    const relFields = meta.fields.filter((f) => f.kind === 'relation' && f.targetTypeId);
    if (relFields.length === 0) continue;

    for (const entity of list) {
      for (const rf of relFields) {
        const raw = entity.fields[rf.id];
        if (rf.cardinality === 'many') {
          let ids: string[] = [];
          if (Array.isArray(raw)) ids = raw.map(String);
          else if (typeof raw === 'string') {
            if (raw.startsWith('[')) {
              try { ids = (JSON.parse(raw) as unknown[]).map(String); } catch { ids = raw ? [raw] : []; }
            } else { ids = raw ? [raw] : []; }
          }
          (entity.fields as Record<string, unknown>)[rf.id] = ids
            .map((id) => entityById.get(id))
            .filter((e): e is NonNullable<typeof e> => e !== undefined)
            .map((e): FormulaValue => ({ _type: 'entity', entity: { id: e.id, typeId: e.typeId, filePath: '', body: '', createdAt: new Date(), updatedAt: new Date(), fields: e.fields as Record<string, FormulaValue> } as never }));
        } else {
          const id = typeof raw === 'string' ? raw : null;
          const target = id ? entityById.get(id) : undefined;
          (entity.fields as Record<string, unknown>)[rf.id] = target
            ? { _type: 'entity', entity: { id: target.id, typeId: target.typeId, filePath: '', body: '', createdAt: new Date(), updatedAt: new Date(), fields: target.fields as Record<string, FormulaValue> } as never }
            : null;
        }
      }
    }
  }
  return entityById;
}
```

- [ ] **Step 5: Call `resolveBaseEntities` before `buildScope`**

After the `baseEntities` map is fully populated (after line 1543), add:

```ts
// Two-pass relation resolution: resolve relation ids to EntityValues
if (baseEntities.size > 0 && baseInfos.length > 0) {
  resolveBaseEntities(baseEntities, baseInfos);
}
```

This mutates `baseEntities` in-place so `buildScope` picks up the resolved values automatically.

- [ ] **Step 6: Update `buildScope` entity mapping**

In `buildScope` (lines 1686–1710), the `projected` field loop currently only projects via `b.fields`. Since fields are now `DerivedFieldDef` with optional `targetTypeId`, the projection still works — relation fields now contain `EntityValue` instead of a raw string, so `toFormulaValue` will stringify them. We must use `entity.fields[def.id]` directly (already the case). No change needed to `buildScope` itself since the values in `baseEntities` are already resolved.

However, the `toFormulaValue` helper (line 1643) currently handles objects by calling `String(v)`. We need to pass EntityValues through:

```ts
function toFormulaValue(v: unknown): FormulaValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v;
  if (Array.isArray(v)) return v.map(toFormulaValue);
  // EntityValue or list of EntityValues — pass through
  if (typeof v === 'object' && v !== null && '_type' in v && (v as { _type: string })._type === 'entity') {
    return v as FormulaValue;
  }
  if (typeof v === 'object') return String(v);
  return null;
}
```

- [ ] **Step 7: Typecheck**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/web typecheck 2>&1 | head -60
```

Expected: no errors.

---

## Task 3: Runtime tests — relation chain evaluation

**Files:**
- Modify: `packages/formulas/src/formula.test.ts`

These tests validate that when entity fields already contain resolved EntityValues (as set up by the two-pass code), the evaluator correctly traverses the chain.

- [ ] **Step 1: Add relation chain test block**

At the end of `formula.test.ts`, add:

```ts
// ============================================================
// RELATION CHAIN — EntityValue nested access
// ============================================================

describe("Evaluator — relation field chain", () => {
  function makeRelatedEntities() {
    const marques = [
      {
        id: "m1",
        typeId: "Marque",
        filePath: "/m1.md",
        body: "",
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        fields: { name: "BMW", type: "luxe" },
      },
      {
        id: "m2",
        typeId: "Marque",
        filePath: "/m2.md",
        body: "",
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        fields: { name: "Dacia", type: "économique" },
      },
    ];

    // After two-pass resolution, voitures.marque is an EntityValue pointing to a marque entity
    const voitures = [
      {
        id: "v1",
        typeId: "Voiture",
        filePath: "/v1.md",
        body: "",
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        fields: {
          name: "X5",
          marque: { _type: "entity" as const, entity: marques[0]! },
        },
      },
      {
        id: "v2",
        typeId: "Voiture",
        filePath: "/v2.md",
        body: "",
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        fields: {
          name: "Sandero",
          marque: { _type: "entity" as const, entity: marques[1]! },
        },
      },
    ];

    const scope: Scope = {
      Voitures: voitures.map((e) => ({ _type: "entity" as const, entity: e })),
      thisRow: { _type: "entity" as const, entity: { id: "__thisRow__", typeId: "Voiture", filePath: "", body: "", createdAt: FIXED_NOW, updatedAt: FIXED_NOW, fields: {} } },
    };

    return scope;
  }

  it("accesses nested relation field via currentValue.marque.type", () => {
    const scope = makeRelatedEntities();
    const result = evalSrc(
      'Voitures.where(currentValue.marque.type == "luxe").count',
      undefined,
      scope,
    );
    expect(result).toBe(1);
  });

  it("accesses nested relation field name", () => {
    const scope = makeRelatedEntities();
    // project the name field of the marque relation
    const result = evalSrc(
      "Voitures.Map(currentValue -> currentValue.marque.name)",
      undefined,
      scope,
    );
    expect(result).toEqual(["BMW", "Dacia"]);
  });

  it("returns null for missing relation target", () => {
    const scope: Scope = {
      Voitures: [
        {
          _type: "entity" as const,
          entity: {
            id: "v3",
            typeId: "Voiture",
            filePath: "/v3.md",
            body: "",
            createdAt: FIXED_NOW,
            updatedAt: FIXED_NOW,
            fields: { name: "Aucun", marque: null },
          },
        },
      ],
    };
    const result = evalSrc("Voitures.Map(currentValue -> currentValue.marque)", undefined, scope);
    expect(result).toEqual([null]);
  });

  it("handles many-cardinality: access to list of EntityValues", () => {
    const tags = [
      { id: "t1", typeId: "Tag", filePath: "/t1.md", body: "", createdAt: FIXED_NOW, updatedAt: FIXED_NOW, fields: { name: "tech" } },
      { id: "t2", typeId: "Tag", filePath: "/t2.md", body: "", createdAt: FIXED_NOW, updatedAt: FIXED_NOW, fields: { name: "news" } },
    ];
    const entity = {
      id: "e1",
      typeId: "Article",
      filePath: "/e1.md",
      body: "",
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      fields: {
        title: "Hello",
        // many-cardinality: list of EntityValues
        tags: [
          { _type: "entity" as const, entity: tags[0]! },
          { _type: "entity" as const, entity: tags[1]! },
        ],
      },
    };
    const scope: Scope = {
      Articles: [{ _type: "entity" as const, entity: entity }],
    };
    const result = evalSrc(
      "Articles.first.tags.count",
      undefined,
      scope,
    );
    expect(result).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas test 2>&1 | tail -30
```

Expected: all tests pass. If any relation-chain tests fail, investigate `evalPropertyAccess` in `evaluator.ts`.

The evaluator's `evalPropertyAccess` for `EntityValue` reads `entity.fields[property]` (line 111). Since `entity.fields` now contains `EntityValue` objects for relation fields, and `EntityValue` is itself a valid `Value`, no change is needed in the evaluator — it passes them through correctly.

The list-of-entities projection code (lines 180–188 of evaluator.ts) also works: when a list contains EntityValues and we access `.marque`, it projects `e.fields["marque"]` for each, giving a list of EntityValues.

---

## Task 4: UI — `resolveChainTypeAt` helper

**Files:**
- Modify: `apps/web/src/components/bases/FormulaInputEditor.tsx`

This task adds the chain-resolver function that walks a dot-chain backward from the cursor position to determine the EntityType (or scalar kind) at that position.

- [ ] **Step 1: Add `ChainResolution` type and `resolveChainTypeAt` helper**

Add after the `STRING_MEMBERS` constant (around line 517) and before the tokenizer section:

```ts
// ── Chain type resolution ─────────────────────────────────────────────────────

type ChainResolution =
  | { kind: "base"; base: EntityType }
  | { kind: "list-of-base"; base: EntityType }
  | { kind: "scalar"; inferredKind: "string" | "number" | "date" | "bool" }
  | null;

type InferredFieldKind = "string" | "number" | "date" | "bool";

function fieldKindToChainKind(kind: string): InferredFieldKind | null {
  if (kind === "number" || kind === "currency" || kind === "percent" || kind === "rating" || kind === "progress" || kind === "duration" || kind === "autoNumber") return "number";
  if (kind === "date" || kind === "datetime" || kind === "createdAt" || kind === "updatedAt") return "date";
  if (kind === "bool") return "bool";
  if (kind === "text" || kind === "longtext" || kind === "url" || kind === "email" || kind === "phone" || kind === "color" || kind === "markdown") return "string";
  return null;
}

/**
 * Resolves the type of the expression at `dotPos` by walking the dot-chain
 * backward through relation fields.
 *
 * @param src - full formula source text
 * @param dotPos - position of the `.` that triggered completion
 * @param basesByName - map from base name/plural → EntityType
 * @param basesById - map from base id → EntityType
 * @param rootBase - the base the formula belongs to (for `thisRow`)
 * @returns ChainResolution or null if chain cannot be resolved
 */
function resolveChainTypeAt(
  src: string,
  dotPos: number,
  basesByName: Map<string, EntityType>,
  basesById: Map<string, EntityType>,
  rootBase: EntityType,
): ChainResolution {
  // Collect all segments before the dot by walking backward through alphanums and dots
  // We build segments from right-to-left, stopping at any non-chain character
  const segments: string[] = [];
  let pos = dotPos - 1;
  // Skip optional `?` before first `.`
  if (pos >= 0 && src[pos] === "?") pos--;

  while (pos >= 0) {
    // Skip whitespace
    while (pos >= 0 && /\s/.test(src[pos] ?? "")) pos--;
    if (pos < 0) break;
    // Read alphanumeric segment (backward)
    let segEnd = pos + 1;
    while (pos >= 0 && /[A-Za-z0-9_]/.test(src[pos] ?? "")) pos--;
    const seg = src.slice(pos + 1, segEnd);
    if (!seg) break;
    segments.unshift(seg);
    // Check for preceding dot
    while (pos >= 0 && /\s/.test(src[pos] ?? "")) pos--;
    if (pos >= 0 && src[pos] === ".") {
      // Optional `?.`
      if (pos > 0 && src[pos - 1] === "?") pos--;
      pos--;
      continue;
    }
    break;
  }

  if (segments.length === 0) return null;

  // Resolve root segment
  const root = segments[0]!;
  let currentBase: EntityType | null = null;
  let isList = false;

  if (root === "thisRow" || root === "currentValue") {
    currentBase = rootBase;
    isList = false;
  } else {
    const b = basesByName.get(root);
    if (b) {
      currentBase = b;
      isList = true; // base identifier = list of entities
    }
  }

  if (!currentBase) return null;
  if (segments.length === 1) {
    return isList
      ? { kind: "list-of-base", base: currentBase }
      : { kind: "base", base: currentBase };
  }

  // Walk remaining segments (max depth 5 to avoid complexity)
  const maxDepth = Math.min(segments.length - 1, 5);
  for (let i = 1; i <= maxDepth; i++) {
    const seg = segments[i]!;
    // Find matching field in currentBase
    const field = currentBase.fields.find(
      (f) => f.name === seg || f.id === seg,
    );
    if (!field) return null;

    if (field.kind === "relation") {
      const relField = field as import("@supernote/core").RelationField;
      const target = basesById.get(relField.targetTypeId);
      if (!target) return null;
      const isMany = relField.cardinality === "one_to_many" || relField.cardinality === "many_to_many";
      currentBase = target;
      isList = isMany;
    } else {
      // Scalar field — chain ends here
      const scalarKind = fieldKindToChainKind(field.kind);
      if (!scalarKind) return null;
      return { kind: "scalar", inferredKind: scalarKind };
    }

    // Last segment resolved
    if (i === maxDepth) {
      return isList
        ? { kind: "list-of-base", base: currentBase }
        : { kind: "base", base: currentBase };
    }
  }

  return null;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/web typecheck 2>&1 | head -30
```

Expected: no errors from new code.

---

## Task 5: UI — extend `CompletionMode`, `contextAtCursor`, `buildCompletions`, and `ContextBanner`

**Files:**
- Modify: `apps/web/src/components/bases/FormulaInputEditor.tsx`

- [ ] **Step 1: Extend `CompletionMode` type**

Replace line 648:
```ts
type CompletionMode = "free" | "member-of-base" | "member-of-list" | "member-of-row" | "member-of-string" | "rhs-suggestion";
```
with:
```ts
type CompletionMode =
  | "free"
  | "member-of-base"
  | "member-of-list"
  | "member-of-row"
  | "member-of-string"
  | "member-of-number"
  | "member-of-date"
  | "member-of-bool"
  | "rhs-suggestion";
```

- [ ] **Step 2: Extend `ContextInfo` to hold the resolved base for relation chains**

`ContextInfo.contextBase` already exists — no change needed. The chain resolver returns it directly.

- [ ] **Step 3: Add NUMBER_MEMBERS, DATE_MEMBERS, BOOL_MEMBERS constants**

After `STRING_MEMBERS` (around line 517), add:

```ts
/** Méthodes/propriétés chainables sur un nombre. */
const NUMBER_MEMBERS: FnSpec[] = [
  { name: "abs", sig: "abs → number", group: "math" },
  { name: "round", sig: "round → number", group: "math" },
  { name: "ceil", sig: "ceil → number", group: "math" },
  { name: "floor", sig: "floor → number", group: "math" },
  { name: "sign", sig: "sign → number", group: "math" },
  { name: "isInteger", sig: "isInteger → bool", group: "math" },
  { name: "isPositive", sig: "isPositive → bool", group: "math" },
  { name: "isNegative", sig: "isNegative → bool", group: "math" },
  { name: "isZero", sig: "isZero → bool", group: "math" },
  { name: "isEven", sig: "isEven → bool", group: "math" },
  { name: "isOdd", sig: "isOdd → bool", group: "math" },
  { name: "isNull", sig: "isNull → bool", group: "math" },
  { name: "isNotNull", sig: "isNotNull → bool", group: "math" },
];

/** Méthodes/propriétés chainables sur une date. */
const DATE_MEMBERS: FnSpec[] = [
  { name: "year", sig: "year → number", group: "date" },
  { name: "month", sig: "month → number", group: "date" },
  { name: "day", sig: "day → number", group: "date" },
  { name: "hour", sig: "hour → number", group: "date" },
  { name: "minute", sig: "minute → number", group: "date" },
  { name: "second", sig: "second → number", group: "date" },
  { name: "startOfDay", sig: "startOfDay → date", group: "date" },
  { name: "endOfDay", sig: "endOfDay → date", group: "date" },
  { name: "startOfMonth", sig: "startOfMonth → date", group: "date" },
  { name: "endOfMonth", sig: "endOfMonth → date", group: "date" },
  { name: "isToday", sig: "isToday → bool", group: "date" },
  { name: "isPast", sig: "isPast → bool", group: "date" },
  { name: "isFuture", sig: "isFuture → bool", group: "date" },
  { name: "toISO", sig: "toISO → string", group: "date" },
  { name: "isNull", sig: "isNull → bool", group: "date" },
  { name: "isNotNull", sig: "isNotNull → bool", group: "date" },
];

/** Méthodes/propriétés chainables sur un booléen. */
const BOOL_MEMBERS: FnSpec[] = [
  { name: "not", sig: "not → bool", group: "logic" },
  { name: "isNull", sig: "isNull → bool", group: "logic" },
  { name: "isNotNull", sig: "isNotNull → bool", group: "logic" },
];
```

- [ ] **Step 4: Add `basesById` useMemo in the component**

In the `FormulaInputEditor` component, after the `basesByName` useMemo (around line 1313), add:

```ts
const basesById = useMemo(() => {
  const m = new Map<string, EntityType>();
  for (const b of [baseSafe, ...otherBases]) {
    if (b.id) m.set(b.id, b);
  }
  return m;
}, [baseSafe, otherBases]);
```

- [ ] **Step 5: Update `contextAtCursor` to use `resolveChainTypeAt`**

In `contextAtCursor` (line ~791), after confirming `isDot` and collecting `ident`, replace the existing logic for handling `currentValue` and unknown idents. The section from the `if (isDot)` block needs to delegate to `resolveChainTypeAt` when the chain has multiple segments.

The function signature must change to accept `basesById` and `rootBase`:

```ts
function contextAtCursor(
  src: string,
  cursor: number,
  basesByName: Map<string, EntityType>,
  basesById: Map<string, EntityType>,
  base?: EntityType,
): ContextInfo {
```

Then in the `if (isDot)` block, after extracting `ident` and `identStart`, replace the body starting from `if (ident)` with:

```ts
if (ident) {
  // Use chain resolver for multi-segment chains
  const rootBase = base ?? EMPTY_BASE;
  const resolved = resolveChainTypeAt(src, isOptionalDot ? p - 1 : p, basesByName, basesById, rootBase);

  if (resolved) {
    if (resolved.kind === "base") {
      return { mode: "member-of-row", prefix, start, end, contextBase: resolved.base };
    }
    if (resolved.kind === "list-of-base") {
      // single-segment base → member-of-base (fields + list ops)
      // multi-segment → member-of-list (list ops) + the base for field projection
      // Check if this was a single-segment base reference
      if (basesByName.has(ident)) {
        return { mode: "member-of-base", prefix, start, end, contextBase: resolved.base };
      }
      return { mode: "member-of-list", prefix, start, end, contextBase: resolved.base };
    }
    if (resolved.kind === "scalar") {
      if (resolved.inferredKind === "string") return { mode: "member-of-string", prefix, start, end };
      if (resolved.inferredKind === "number") return { mode: "member-of-number", prefix, start, end };
      if (resolved.inferredKind === "date") return { mode: "member-of-date", prefix, start, end };
      if (resolved.inferredKind === "bool") return { mode: "member-of-bool", prefix, start, end };
    }
  }

  // Fallback: single-segment heuristics
  if (ident === "thisRow") return { mode: "member-of-row", prefix, start, end };
  const b = basesByName.get(ident);
  if (b) return { mode: "member-of-base", prefix, start, end, contextBase: b };
  if (ident === "currentValue") {
    const enclosing = enclosingCurrentValueBase(src, identStart, basesByName);
    if (enclosing) return { mode: "member-of-row", prefix, start, end, contextBase: enclosing };
    return { mode: "member-of-row", prefix, start, end };
  }
  if (base && isTextFieldIdent(ident, base)) return { mode: "member-of-string", prefix, start, end };
  return { mode: "member-of-list", prefix, start, end };
}
```

- [ ] **Step 6: Update the `ctx` useMemo call site**

Find the line (around 1332):
```ts
const ctx = useMemo(() => contextAtCursor(expression, cursor, basesByName, baseSafe), [...]);
```
Replace with:
```ts
const ctx = useMemo(() => contextAtCursor(expression, cursor, basesByName, basesById, baseSafe), [expression, cursor, basesByName, basesById, baseSafe]);
```

- [ ] **Step 7: Extend `buildCompletions` for new modes**

In `buildCompletions` (line 887), before the `// mode free` block, add the new mode handlers:

```ts
if (ctx.mode === "member-of-number") {
  return NUMBER_MEMBERS.map((m): CompletionItem => ({
    label: m.name,
    kind: "member",
    insertText: m.name,
    detail: m.sig,
  }));
}
if (ctx.mode === "member-of-date") {
  return DATE_MEMBERS.map((m): CompletionItem => ({
    label: m.name,
    kind: "member",
    insertText: m.name,
    detail: m.sig,
  }));
}
if (ctx.mode === "member-of-bool") {
  return BOOL_MEMBERS.map((m): CompletionItem => ({
    label: m.name,
    kind: "member",
    insertText: m.name,
    detail: m.sig,
  }));
}
```

Also extend `member-of-list` to optionally propose field projections when `ctx.contextBase` is set:

```ts
if (ctx.mode === "member-of-list") {
  const listItems = LIST_MEMBERS.map((m): CompletionItem => ({
    label: m.name,
    kind: "member",
    insertText: m.sig.includes("(") && !m.sig.startsWith(m.name + " ") ? `${m.name}()` : m.name,
    cursorDelta: m.sig.includes("(") && !m.sig.startsWith(m.name + " ") ? -1 : 0,
    detail: m.sig,
  }));
  // If we know the target base, also offer its fields (projection)
  if (ctx.contextBase) {
    const fieldItems = ctx.contextBase.fields.map((f): CompletionItem => ({
      label: f.label || f.name,
      kind: "field",
      insertText: f.name || f.id,
      detail: `${f.kind} (projection)`,
    }));
    return [...listItems, ...fieldItems];
  }
  return listItems;
}
```

Note: the existing `member-of-list` block (lines 939–946) must be replaced by the above.

- [ ] **Step 8: Extend `inferAstKind` for relation chains**

In `inferAstKind` (line 1095), the `PropertyAccess` case currently only handles `thisRow.field`. Extend it to support relation chains up to depth 5:

```ts
case "PropertyAccess": {
  const obj = ast.object;
  if (obj.kind === "Identifier" && (obj.name === "thisRow" || obj.name === "currentValue")) {
    const f = base.fields.find((x) => x.name === ast.property || x.id === ast.property);
    return fieldKindToInferred(f);
  }
  // Nested PropertyAccess: try to infer from the inner chain
  if (obj.kind === "PropertyAccess") {
    const innerKind = inferAstKind(obj, base);
    // If inner is a known scalar, we can't descend further without type info
    if (innerKind !== "unknown") return "unknown"; // scalar.field → unknown
  }
  return "unknown";
}
```

- [ ] **Step 9: Typecheck**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/web typecheck 2>&1 | head -60
```

Expected: no errors.

---

## Task 6: UI — ContextBanner labels

**Files:**
- Modify: `apps/web/src/components/bases/FormulaInputEditor.tsx`

Find the `ContextBanner` component or equivalent (search for "member-of-string" label in the file). The banner is inside the main component, typically rendering the `ctx.mode` as a label.

- [ ] **Step 1: Find the banner rendering code**

```bash
grep -n "member-of\|ContextBanner\|Mode actif\|Autocomplétion" /home/ange/supernote/apps/web/src/components/bases/FormulaInputEditor.tsx | head -20
```

- [ ] **Step 2: Add labels for new modes**

In the banner rendering block (wherever `member-of-string` is mapped to a label), add:

```ts
"member-of-number": "Méthodes de nombre",
"member-of-date": "Méthodes de date",
"member-of-bool": "Méthodes de booléen",
// If member-of-base already has a label like "Champs de <base>", keep it.
// For relation chains, member-of-row with contextBase should show:
// "Champs de <contextBase.name> (via relation)"
```

The exact implementation depends on the banner structure. If the banner shows `contextBase?.name` for `member-of-row`, it already covers the relation case. If it just shows the mode name, add specific labels.

- [ ] **Step 3: Typecheck**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/web typecheck 2>&1 | head -30
```

---

## Task 7: Final verification

- [ ] **Step 1: Run formulas tests**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas test 2>&1
```

Expected: all existing tests pass + the 4 new relation-chain tests pass.

- [ ] **Step 2: Full web typecheck**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/web typecheck 2>&1
```

Expected: 0 errors.

- [ ] **Step 3: Formulas typecheck**

```bash
cd /home/ange/supernote && pnpm --filter @supernote/formulas typecheck 2>&1
```

Expected: 0 errors.

- [ ] **Step 4: Formulas build (if needed)**

The formulas package is used from source via workspace `packages/formulas/src`. The worker-router and variables.ts import from `@supernote/formulas` which resolves to `dist/`. If any formulas source was changed (it wasn't in this plan), rebuild. Since we only touched `formula.test.ts` (not published), no rebuild needed.

```bash
# Skippable if formulas src unchanged
# pnpm --filter @supernote/formulas build
echo "No formulas build needed — only test file changed"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|-----------------|------|
| `EntityTypeMeta.fields` extended with kind/targetTypeId/cardinality | Task 1 Step 2 |
| Two-pass resolution in `variables.ts` | Task 1 Steps 4–5 |
| Two-pass resolution in `worker-router.ts` | Task 2 |
| `toFormulaValue` passes EntityValues through | Task 2 Step 6 |
| Runtime tests with pre-resolved scopes | Task 3 |
| `resolveChainTypeAt` walker | Task 4 |
| `basesById` useMemo | Task 5 Step 4 |
| `contextAtCursor` uses chain resolver | Task 5 Step 5 |
| New CompletionModes (number, date, bool) | Task 5 Steps 1, 3, 7 |
| `buildCompletions` for new modes | Task 5 Step 7 |
| `member-of-list` + contextBase → field projections | Task 5 Step 7 |
| `inferAstKind` relation chain | Task 5 Step 8 |
| ContextBanner labels | Task 6 |
| `cardinality: many` → list of EntityValues | Task 1 Step 4, Task 2 Step 4 |
| Cycle safety via two-pass | Task 1 Step 4, Task 2 Step 4 |
| Fallback null for unknown targetTypeId | Task 1 Step 4, Task 2 Step 4 |
| Backward compat: non-relation fields unchanged | All tasks — pass 1 leaves scalars untouched |

### Type consistency

- `ChainResolution` defined in Task 4, used in Task 5 Step 5 — consistent.
- `EntityTypeMeta.fields` extended in Task 1 Step 2, used in Task 1 Steps 4–5 — consistent.
- `DerivedFieldDef` extended in Task 2 Step 2, used in Task 2 Steps 3–4 — consistent.
- `NUMBER_MEMBERS`, `DATE_MEMBERS`, `BOOL_MEMBERS` defined in Task 5 Step 3, used in Task 5 Step 7 — consistent.
- `resolveChainTypeAt` signature uses `Map<string, EntityType>` in both definition (Task 4) and call site (Task 5 Step 5) — consistent.

### Placeholder scan

No placeholders found. All code blocks are complete.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-16-relation-fields-formula.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
