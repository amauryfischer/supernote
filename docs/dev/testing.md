# Tests

Supernote suit le **London School TDD** : tests en isolation avec mocks sur les collaborateurs externes, focus sur les comportements observables.

---

## Stack de tests

| Niveau | Outil | Où |
|---|---|---|
| Unit | Vitest | Tous les packages |
| Integration | Vitest | `packages/db`, `packages/core`, `packages/automations` |
| E2E | Playwright Electron | `apps/desktop` (slow, CI only) |

---

## Lancer les tests

```bash
# Tous les tests (tous les packages)
pnpm test

# Un package spécifique
pnpm --filter @supernote/core test

# En mode watch
pnpm --filter @supernote/formulas test:watch

# Avec UI Vitest
pnpm --filter @supernote/core vitest --ui

# Coverage
pnpm --filter @supernote/core test -- --coverage
```

---

## Tests unitaires (Vitest)

Les fichiers de test sont co-localisés avec le code source : `feature.ts` → `feature.test.ts`.

### Exemple — Formula evaluator

```typescript
// packages/formulas/src/evaluator.test.ts
import { describe, it, expect } from 'vitest';
import { evaluate } from './evaluator.js';

describe('evaluate', () => {
  it('computes SUM of a list', () => {
    expect(evaluate('SUM([1, 2, 3])')).toBe(6);
  });

  it('returns 0 for empty list', () => {
    expect(evaluate('SUM([])')).toBe(0);
  });

  it('throws on type mismatch', () => {
    expect(() => evaluate('SUM("not a list")')).toThrow('Expected list');
  });
});
```

### Exemple — Schema Engine avec mock

```typescript
// packages/core/src/schema-engine.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SchemaEngine } from './schema-engine.js';
import { type EntityType } from './types.js';

const mockEntityType: EntityType = {
  id: 'test-type',
  name: 'personne',
  fields: [
    { id: 'f1', name: 'name', type: 'text', required: true },
    { id: 'f2', name: 'email', type: 'email', required: false },
  ],
};

describe('SchemaEngine.validate', () => {
  it('passes valid fields', () => {
    const engine = new SchemaEngine([mockEntityType]);
    const result = engine.validate('personne', { name: 'Jean', email: 'jean@example.com' });
    expect(result.ok).toBe(true);
  });

  it('rejects missing required field', () => {
    const engine = new SchemaEngine([mockEntityType]);
    const result = engine.validate('personne', { email: 'jean@example.com' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ field: 'name' }));
  });

  it('proposes auto-fix for castable value', () => {
    const engine = new SchemaEngine([mockEntityType]);
    const result = engine.validate('personne', { name: 42 }); // number au lieu de string
    expect(result.ok).toBe(false);
    expect(result.autoFix).toEqual({ name: '42' });
  });
});
```

---

## Tests d'intégration (Vitest)

Pour les modules avec dépendances sur SQLite ou le filesystem, utiliser un vault temporaire :

```typescript
// packages/db/src/entity-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestVault } from '../test-helpers.js';

describe('EntityService integration', () => {
  let vaultPath: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'supernote-test-'));
    const { path, destroy } = await createTestVault(tmpDir);
    vaultPath = path;
    cleanup = destroy;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('creates an entity and persists to disk', async () => {
    const { entityService, fileIO } = await createTestServices(vaultPath);

    const entity = await entityService.save({
      typeId: 'personne',
      fields: { name: 'Jean Dupont', email: 'jean@example.com' },
      body: '# Jean\n\nNotes sur Jean.',
    });

    expect(entity.id).toBeTruthy();
    expect(entity.fields.name).toBe('Jean Dupont');

    // Vérifie que le fichier est sur disque
    const fileContent = await fileIO.read(entity.filePath);
    expect(fileContent).toContain('name: Jean Dupont');
    expect(fileContent).toContain('# Jean');
  });
});
```

### Fixture vault de test

`packages/db/src/test-helpers.ts` expose `createTestVault()` qui crée un mini-vault de ~50 entités hétérogènes (personnes, orgs, projets, interactions, notes) pour les tests d'intégration.

---

## Tests E2E (Playwright Electron)

Les tests E2E sont dans `apps/desktop/tests/e2e/` et utilisent `@playwright/test` avec le driver Electron.

```typescript
// apps/desktop/tests/e2e/editor.spec.ts
import { test, expect } from '@playwright/test';
import { launchSupernote } from '../helpers.js';

test.describe('Editor', () => {
  test('creates a note and searches for it', async () => {
    const { app, page } = await launchSupernote({ vault: 'test-fixtures/small-vault' });

    // Crée une note
    await page.keyboard.press('Meta+N');
    await page.getByRole('textbox').first().type('Ma note de test');
    await page.keyboard.press('Enter');
    await page.getByRole('textbox').last().type('Contenu unique XYZ987');

    // Sauvegarde auto (attendre debounce)
    await page.waitForTimeout(600);

    // Recherche
    await page.keyboard.press('Meta+Shift+F');
    await page.getByPlaceholder('Rechercher...').fill('XYZ987');
    await expect(page.getByText('Ma note de test')).toBeVisible();

    await app.close();
  });

  test('creates a wikilink and navigates to it', async () => {
    const { app, page } = await launchSupernote({ vault: 'test-fixtures/small-vault' });

    // Ouvre une note existante
    await page.keyboard.press('Meta+K');
    await page.getByPlaceholder('Chercher...').fill('Jean Dupont');
    await page.getByText('Jean Dupont').first().click();

    // Tape un wikilink
    await page.getByRole('textbox').last().fill('[[Acme Corp]]');
    await page.getByText('Acme Corp').first().click();  // autocomplete

    // Naviguer vers Acme Corp
    await page.keyboard.press('Meta+Enter');
    await expect(page.getByText('Acme Corp')).toBeVisible();

    await app.close();
  });
});
```

### Lancer les E2E

```bash
# Build d'abord
pnpm build

# Lancer les E2E
pnpm --filter @desktop/app test:e2e

# En mode headed (voir la fenêtre)
pnpm --filter @desktop/app test:e2e -- --headed
```

Les E2E sont lancés seulement en CI sur les PRs vers `main` (ils prennent 3-5 minutes).

---

## Coverage

La couverture est mesurée avec `@vitest/coverage-v8` :

```bash
pnpm --filter @supernote/core test -- --coverage
# → génère coverage/index.html
```

Objectifs :
- `@supernote/core` : 90%+
- `@supernote/formulas` : 90%+
- `@supernote/db` handlers : 80%+
- `@supernote/automations` : 80%+
- Packages UI (renderer) : smoke tests

---

## Mocking

Supernote utilise `vi.mock()` de Vitest. Pour les modules avec I/O :

```typescript
// Mock du FileIO
vi.mock('./file-io.js', () => ({
  FileIO: vi.fn().mockImplementation(() => ({
    read: vi.fn().mockResolvedValue('# Note\n\nContenu'),
    write: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
  })),
}));
```

Pour les procédures tRPC dans les tests de composants renderer :

```typescript
import { createTRPCMsw } from 'msw-trpc';
import { type AppRouter } from '@supernote/ipc';

const trpcMsw = createTRPCMsw<AppRouter>();

const handlers = [
  trpcMsw.entities.query.query((req, res, ctx) =>
    res(ctx.data({ ok: true, data: mockEntities }))
  ),
];
```

---

## CI

La configuration CI (GitHub Actions) exécute en parallèle :

```yaml
jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - pnpm install
      - pnpm typecheck
      - pnpm lint
      - pnpm test

  e2e-tests:
    runs-on: ubuntu-latest
    if: github.base_ref == 'main'
    steps:
      - pnpm install
      - pnpm build
      - pnpm playwright install --with-deps chromium
      - pnpm test:e2e
```
