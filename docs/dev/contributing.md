# Contribuer à Supernote

## Setup du repo

```bash
git clone https://github.com/votre-org/supernote.git
cd supernote

# Installer les dépendances
pnpm install

# Générer le client Prisma
pnpm --filter @supernote/db generate

# Lancer en dev
pnpm dev
```

Pour un package spécifique :

```bash
pnpm --filter @supernote/core dev
pnpm --filter @supernote/editor test:watch
```

---

## Conventions de code

### TypeScript

- `"strict": true` obligatoire dans tous les packages
- Pas de `any` implicite. Si tu dois contourner, commente pourquoi.
- Types d'interface pour toutes les APIs publiques (exported functions)
- Préférer `type` à `interface` sauf pour les APIs destinées à être étendues
- `Result<T, E>` pour toutes les fonctions qui peuvent échouer (pas de throw implicite aux frontières)

### Nommage

- **Fichiers :** `kebab-case.ts` sauf composants React (`PascalCase.tsx`)
- **Fonctions/variables :** `camelCase`
- **Classes/Types :** `PascalCase`
- **Constantes :** `UPPER_SNAKE_CASE`
- **Code et commentaires internes :** anglais uniquement
- **Strings UI visibles :** français (i18n séparée à venir)

### Fonctions

- Maximum 20 lignes par fonction (Single Responsibility)
- Valider les inputs à toutes les frontières système avec Zod
- Fonctions pures préférées — effets de bord explicites

### Imports

```typescript
// 1. Modules Node.js/externe
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

// 2. Packages internes workspace
import { type Entity } from '@supernote/core';
import { db } from '@supernote/db';

// 3. Imports relatifs
import { parseMarkdown } from './markdown.js';
```

### Zod partout aux frontières

```typescript
// Bon : validation à l'entrée d'une procédure IPC
const SaveInput = z.object({
  entityId: z.string().ulid(),
  fields: z.record(z.unknown()),
  body: z.string().max(1_000_000),
});

export const save = procedure
  .input(SaveInput)
  .mutation(({ input }) => { /* input est typé */ });
```

---

## Structure d'un nouveau package

```
packages/mon-package/
├── src/
│   ├── index.ts          # barrel export (pas de star-export)
│   └── feature/
│       ├── feature.ts    # logique
│       └── feature.test.ts # tests co-localisés
├── package.json
├── tsconfig.json
└── tsconfig.build.json
```

`package.json` minimal :

```json
{
  "name": "@supernote/mon-package",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc --project tsconfig.build.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@supernote/tsconfig": "workspace:*",
    "typescript": "^5.7.2",
    "vitest": "^3.0.0"
  }
}
```

---

## Tests

Voir [testing.md](testing.md) pour le guide complet.

Règle : **toute nouvelle feature commence par ses tests** (London School TDD).

Couverture minimale attendue :
- Logic pure (`@supernote/core`, `@supernote/formulas`) : 90%+
- Handlers IPC : 80%+
- Composants React : smoke tests + comportements critiques

---

## Workflow de contribution

### Branches

- `main` — stable, toujours buildable
- `dev` — intégration des features en cours
- `feat/<nom>` — feature branch
- `fix/<nom>` — bug fix
- `docs/<nom>` — documentation only

### Commits

Format [Conventional Commits](https://www.conventionalcommits.org/) :

```
feat(editor): add synced block support
fix(db): handle concurrent write race condition
docs(user): update sync documentation
chore(deps): upgrade BlockNote to 0.20
test(formulas): add edge cases for date arithmetic
refactor(search): extract FTS builder to separate module
```

Scope = nom du package concerné (`editor`, `db`, `core`, `canvas`, `finance`, etc.)

### Pull Requests

1. Crée une branche depuis `dev`
2. Fais tes changements avec des commits atomiques
3. Lance les tests localement : `pnpm test` + `pnpm typecheck`
4. Ouvre la PR vers `dev` (pas `main`)
5. La PR doit :
   - Passer tous les CI checks (build, lint, typecheck, tests)
   - Avoir une description expliquant le "pourquoi"
   - Être reviewée par au moins 1 personne

### Pas de PR directement sur `main`

Sauf hotfixes critiques en production, avec double review.

---

## CI / Checks automatiques

À chaque push et PR :

1. `pnpm typecheck` — tsc sur tous les packages
2. `pnpm lint` — ESLint
3. `pnpm test` — Vitest sur tous les packages
4. `pnpm build` — compilation complète (vérifie pas de circular deps)
5. E2E sur les PRs vers `main` uniquement (plus lent)

---

## Ajouter une dépendance

```bash
# Dépendance runtime dans un package
pnpm --filter @supernote/editor add some-lib

# Dépendance dev
pnpm --filter @supernote/editor add -D some-tool

# Dépendance entre packages internes
pnpm --filter @supernote/editor add @supernote/core
# → ajoute "workspace:*" dans package.json
```

Évite d'ajouter des dépendances à la racine sauf pour les outils de build (Turborepo, TypeScript, etc.).

---

## Debugging

### Main process (Electron)

```bash
# Avec DevTools
ELECTRON_ENABLE_LOGGING=1 pnpm dev

# Avec inspector Node
NODE_OPTIONS='--inspect' pnpm dev
# Connecte Chrome DevTools sur chrome://inspect
```

### Renderer (Next.js)

Ouvre DevTools dans la fenêtre Electron : `Cmd+Option+I` / `F12`.

### Tests Vitest

```bash
pnpm --filter @supernote/core test:watch
# En mode UI :
pnpm --filter @supernote/core vitest --ui
```

### Logs

Supernote utilise `pino`. Les logs du main process sont dans :
- macOS : `~/Library/Logs/Supernote/`
- Linux : `~/.local/share/Supernote/logs/`
- Windows : `%APPDATA%\Supernote\logs\`

Niveau de log configurable : `LOG_LEVEL=debug pnpm dev`
