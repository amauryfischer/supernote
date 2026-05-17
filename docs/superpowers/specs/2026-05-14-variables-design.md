# Variables — Design

**Date** : 2026-05-14
**Status** : Draft

## Objectif

Ajouter une section "Variables" dans le vault permettant de définir des valeurs nommées réutilisables dans toutes les formules du projet. Une variable a un nom, un type, et une valeur — soit littérale, soit calculée par formule. Les formules d'entités/bases référencent une variable via `$nom`.

## Décisions clés

| Sujet | Choix |
|-------|-------|
| Syntaxe de référence | `$nom` (préfixe `$`) |
| Types supportés | `number`, `string`, `boolean`, `date` |
| Portée | globale au vault (pas de scope par base/dossier) |
| Source de valeur | `literal` (valeur saisie) OU `formula` (expression `@supernote/formulas`) |
| Évaluation | eager-on-read, détection de cycle via stack par invocation |
| Invalidation | dépendance déclarée via `Dependency { kind: "variable", id: name }` |
| Renommage | pas de cascade automatique (MVP) — formules cassées affichent `unknown variable $name` |

## Architecture

### 1. Persistence (vault-worker)

Nouvelle table SQLite dans `apps/web/src/lib/vault-worker/db-schema.ts` :

```sql
CREATE TABLE IF NOT EXISTS "variable" (
  id TEXT PRIMARY KEY,                  -- ulid
  name TEXT NOT NULL UNIQUE,            -- identifiant unique sans le préfixe $
  type TEXT NOT NULL CHECK (type IN ('number','string','boolean','date')),
  value_kind TEXT NOT NULL CHECK (value_kind IN ('literal','formula')),
  literal_json TEXT,                    -- JSON.stringify de la valeur si literal
  formula_expr TEXT,                    -- expression Coda-flavor si formula
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_variable_name ON "variable" (name);
```

Validation : exactement un de `literal_json` / `formula_expr` est non-null.

Bump `SCHEMA_VERSION` + migration.

### 2. Schemas partagés (`@supernote/core`)

Nouveau fichier `packages/core/src/variable.ts` :

```ts
export const VariableType = z.enum(['number','string','boolean','date']);
export const VariableValue = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('literal'), value: z.union([z.number(), z.string(), z.boolean()]) }),
  z.object({ kind: z.literal('formula'), expression: z.string().min(1) }),
]);
export const Variable = z.object({
  id: z.string(),
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'name must be a valid identifier'),
  type: VariableType,
  value: VariableValue,
  createdAt: z.number(),
  updatedAt: z.number(),
});
```

Le nom est validé identifier-style (pas d'espaces, doit matcher la regex). Date stockée en ISO string pour literal date.

### 3. Formules (`@supernote/formulas`)

**Lexer** (`lexer.ts`) :
- Ajouter cas `if (ch === "$") return this.readVariableRef(start);` à côté de `@`.
- `readVariableRef` : consomme `$` puis ident chars, emit `Identifier` avec `raw: '$' + name` (calque de `readEntityRef`).

**AST** (`ast.ts`) :
```ts
/** $varName reference resolved via context */
export interface VariableRef {
  readonly kind: 'VariableRef';
  readonly name: string;       // sans le $
  readonly span: Span;
}
```
Ajouter à l'union `FormulaAST`.

**Parser** (`parser.ts`) primary expression : avant la branche EntityRef, ajouter
```ts
if (this.check('Identifier') && tok.raw.startsWith('$')) {
  this.advance();
  return ok({ kind: 'VariableRef', name: tok.raw.slice(1), span: span(start, start) });
}
```

**Value/Context** (`value.ts`) :
```ts
export interface FormulaContext {
  resolveEntity(ref: string): Entity | null;
  queryEntities(typeId: string, predicate?: FormulaAST): Entity[];
  getRelations(entityId: string, relationTypeId?: string): RelationEdge[];
  now(): Date;
  /** Resolve a $variable reference by name */
  resolveVariable(name: string): Value | null;
}
```
Ajouter `DependencyKind = 'entity' | 'entityType' | 'relation' | 'time' | 'variable'`.

**Evaluator** (`evaluator.ts`) : nouveau case `case 'VariableRef': return this.evalVariableRef(node);`. Erreur `EvalError` "unknown variable $name" si retour `null`. Cycle géré côté worker via stack d'évaluation (l'evaluator du package n'a pas à savoir).

### 4. Contexte worker

Dans `apps/web/src/lib/vault-worker/`, nouveau module `formula-context.ts` (ou enrichir l'existant) :

```ts
function createFormulaContext(db, evalStack = new Set<string>()) {
  return {
    // ...resolveEntity, queryEntities, getRelations, now...
    resolveVariable(name) {
      if (evalStack.has(name)) throw new EvalError(`circular variable reference: $${name}`);
      const row = db.exec('SELECT type, value_kind, literal_json, formula_expr FROM variable WHERE name = ?', [name])[0];
      if (!row) return null;
      if (row.value_kind === 'literal') return parseLiteral(row.type, row.literal_json);
      // formula : eval récursive avec stack étendue
      const childCtx = createFormulaContext(db, new Set([...evalStack, name]));
      const ast = parse(row.formula_expr);
      const result = evaluate(ast, childCtx);
      return coerceToType(result, row.type);
    },
  };
}
```

Cycle detection via `evalStack` propagée. Coercion vers le type déclaré pour stabilité.

### 5. IPC tRPC (`packages/ipc/src/router/`)

Nouveau `variables.router.ts` :
```ts
export const variablesRouter = router({
  list: publicProcedure.query(...),       // -> Array<Variable & { evaluated: { value, error? } }>
  get: publicProcedure.input(z.object({ id: z.string() })).query(...),
  evaluate: publicProcedure.input(z.object({ id: z.string() })).query(...), // -> { value, error? }
  create: publicProcedure.input(VariableInput).mutation(...),
  update: publicProcedure.input(z.object({ id: z.string(), patch: VariableInput.partial() })).mutation(...),
  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(...),
});
```

Enregistrer dans `router/index.ts` + worker-router handlers.

### 6. UI

**Sidebar** (`apps/web/src/components/shell/Sidebar.tsx`) — réorganisation des groupes :

```ts
const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.groups.navigation',
    items: [
      { labelKey: 'nav.home', icon: House, href: '/' },
      // `nav.search` retiré — déjà accessible via la TopBar
    ],
  },
  {
    labelKey: 'nav.groups.knowledge',
    items: [
      { labelKey: 'nav.notes', icon: FileText, href: '/notes' },
      { labelKey: 'nav.archive', icon: Archive, href: '/archive' },
      { labelKey: 'nav.todos', icon: CheckSquare, href: '/todos' },
      { labelKey: 'nav.journal', icon: Calendar, href: '/journal' },
      { labelKey: 'nav.contacts', icon: Users, href: '/contacts' },
      { labelKey: 'nav.finance', icon: Wallet, href: '/finance' },
      // `nav.tags` déplacé dans tools
    ],
  },
  {
    labelKey: 'nav.groups.tools',
    items: [
      { labelKey: 'nav.tags', icon: Tag, href: '/tags' },
      { labelKey: 'nav.variables', icon: Function, href: '/variables' },  // @phosphor-icons/react `Function`
      { labelKey: 'nav.routines', icon: Lightning, href: '/routines' },
      // `nav.graph` retiré
    ],
  },
];
```

Imports : ajouter `Function` depuis `@phosphor-icons/react`, retirer `Graph`, `MagnifyingGlass` si plus utilisé ailleurs.

**Clones mobiles** (alignement) :
- `apps/web/src/components/shell/mobile/MoreDrawer.tsx` : retirer entrées `Recherche` (l.45) et `Graph` (l.56) ; déplacer `Tags` après `Finance` dans la section outils ; ajouter `Variables`.
- `apps/web/src/components/shell/mobile/MobileBottomNav.tsx` : retirer `/recherche` et `/graph` de la liste `more`, ajouter `/variables`.
- `apps/web/src/components/shell/TopBar.tsx` : retirer mapping `graph: "Graph"` et `recherche: "Recherche"` (l.21, l.23) ; ajouter `variables: "Variables"`.

**Routes obsolètes** : retirer `/graph` et `/recherche` du `router.tsx` si plus accessibles (sinon laisser navigables au clavier). Décision : **garder** `/recherche` (toujours navigable via TopBar) et **retirer** `/graph` du router et supprimer `apps/web/src/app/graph/`.

Traductions FR/EN : ajouter `nav.variables`, retirer `nav.graph`, garder `nav.search` (utilisée par TopBar).

**Routes** (`apps/web/src/router.tsx`) :
```ts
{ path: 'variables', lazy: lazyPage(() => import('./app/variables/page')) },
{ path: 'variables/nouveau', lazy: lazyPage(() => import('./app/variables/nouveau/page')) },
{ path: 'variables/:id', lazy: lazyPage(() => import('./app/variables/[id]/page')) },
```

**Pages** (toutes HeroUI v3) :
- `app/variables/page.tsx` : `Table` avec colonnes Nom, Type, Source (literal/formula), Aperçu valeur, Actions (edit/delete). Bouton `Button` "Nouvelle variable" en header.
- `app/variables/nouveau/page.tsx` + `app/variables/[id]/page.tsx` : `Card` avec `Input` name, `Select` type, `RadioGroup` value-kind, puis :
  - `literal` : Input typé selon le type (`Input type="number"`, `Input` texte, `Switch`, `DatePicker`).
  - `formula` : `FormulaInputEditor` existant (réutilisé depuis bases).
- Suppression : `Modal` HeroUI de confirmation.

**Aperçu valeur calculée** : appel tRPC `variables.evaluate` (ou évaluer côté worker au get) renvoyant `{ value, error? }` pour affichage live dans la page détail.

### 7. Dépendances

Quand evaluator visite `VariableRef`, ajouter `Dependency { kind: 'variable', id: name }`. Le worker, sur `update`/`delete` d'une variable, invalide les formules qui en dépendent (mécanisme existant pour entity/relation).

## Edge cases

- **Cycle** : `$a = $b + 1`, `$b = $a * 2` → `EvalError "circular variable reference"` à la première évaluation, affiché dans la page détail et dans le cell qui consomme.
- **Variable inconnue** : référence à `$inexistante` → `EvalError "unknown variable $inexistante"`.
- **Type mismatch** : variable typée `number` avec formule retournant string → coercion best-effort sinon `EvalError "type mismatch"`.
- **Renommage** : pas de cascade automatique. UI affiche un compteur "X formules utilisent cette variable" calculé à la volée (regex `\$<name>\b` sur formula_expr stockés).
- **Collisions** : `$` étant un nouveau préfixe, pas de collision avec les identifiants existants ni `@`.

## Tests

- `packages/formulas/src/formula.test.ts` : nouvelles suites
  - lexer/parser `$varName`
  - evaluator avec context mock retournant `resolveVariable`
  - dependency tracking kind `variable`
- `packages/core` : tests zod `Variable`
- `apps/web/src/lib/vault-worker/` : test cycle detection + coercion
- `packages/ipc/src/router/` : tests router CRUD

## Hors-scope (futur)

- Variables scopées par base ou dossier
- Cascade de renommage
- Historique des modifications
- Variables computed via API externe (hors `@supernote/formulas`)
