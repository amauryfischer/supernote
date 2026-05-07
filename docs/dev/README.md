# Documentation développeur Supernote

Supernote est un monorepo TypeScript strict (pnpm + Turborepo). Cette section couvre tout ce qu'il faut pour contribuer, comprendre l'architecture, ou étendre l'application.

---

## Index

| Document | Contenu |
|---|---|
| [Architecture](architecture.md) | Couches applicatives, data flows, filesystem |
| [Packages](packages.md) | Les 22 packages — rôle, deps, scripts |
| [Data model](data-model.md) | Prisma schema, EntityType, Field, RelationType |
| [IPC](ipc.md) | Contrats tRPC renderer ↔ main, ajouter une procédure |
| [Extending](extending.md) | Ajouter un type d'entité, un bloc, une routine, un plugin |
| [Build](build.md) | `pnpm dev`, `pnpm build`, packaging electron-builder |
| [Testing](testing.md) | Vitest unit/integration, Playwright E2E |
| [Contributing](contributing.md) | Setup repo, conventions, tests, PRs |
| [Release](release.md) | Versioning, changelog, electron-builder release |

---

## Prérequis

- Node.js 20+ (LTS)
- pnpm 9+
- Git

Pour les tests E2E :
- Playwright installé (`pnpm playwright install`)

Pour les packages avec bindings natifs (better-sqlite3, whisper.cpp) :
- macOS : Xcode Command Line Tools
- Linux : `build-essential`, `python3`
- Windows : Visual Studio Build Tools

---

## Démarrage rapide dev

```bash
git clone https://github.com/votre-org/supernote.git
cd supernote
pnpm install
pnpm dev        # démarre Electron + Next.js en watch mode
```

`pnpm dev` utilise Turborepo pour démarrer en parallèle :
- `apps/web` (Next.js renderer, port 3000)
- `apps/desktop` (Electron main, se connecte au renderer)
- Tous les packages en `watch` mode

Hot-reload : le renderer se rafraîchit automatiquement. Pour le main process, redémarre avec `Ctrl+R` dans la fenêtre Electron.

---

## Structure rapide

```
supernote/
├── apps/
│   ├── desktop/          # Electron main + preload
│   └── web/              # Next.js 15 App Router (client components)
├── packages/             # 22 packages (voir packages.md)
├── docs/
│   ├── specs/            # Spec de design (ne pas modifier)
│   ├── research/         # Recherche open-source (ne pas modifier)
│   ├── user/             # Documentation utilisateur
│   └── dev/              # Documentation développeur (ici)
├── turbo.json            # Pipeline Turborepo
├── pnpm-workspace.yaml
└── package.json          # scripts root
```

---

## Principes non-négociables

1. **TypeScript strict** — `"strict": true` partout. Pas de `any` implicite.
2. **Zod à tous les I/O** — validation runtime à toutes les frontières (IPC, fichiers, API).
3. **Result<T, E> sur l'IPC** — jamais d'exceptions à travers le pont Electron.
4. **Filesystem = source de vérité** — la DB SQLite est un index, pas la data.
5. **Worker thread pour les ops lourdes** — indexation, embeddings, formules : jamais sur le thread principal.
6. **Tests first** — toute nouvelle feature commence par les tests unitaires.
