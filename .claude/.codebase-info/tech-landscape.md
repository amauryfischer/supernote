# Paysage technique

*Last Updated: 2026-09-22*

Supernote est un **système de connaissance et CRM personnel local-first**, livré comme une PWA. Il n'y a pas de serveur applicatif : le coffre de données tourne dans un Web Worker, dans le navigateur.

## Runtime et gestionnaire de paquets

| Élément | Version | Source de vérité |
|---|---|---|
| Node | 22.x | `package.json` `engines`, `.nvmrc` |
| pnpm | 11.x | `package.json` `packageManager` |
| TypeScript | 5.7 | `package.json` devDependencies |
| Orchestrateur | Turborepo 2.3 | `turbo.json` |

⚠️ Le `README.md` annonce Node 20+ et pnpm 9+, et décrit un packaging Electron. Ces deux affirmations sont périmées, voir « Documentation périmée » plus bas.

## Pile applicative

| Couche | Choix | Où |
|---|---|---|
| Bundler | Vite 6 | `apps/web/vite.config.ts` |
| UI | React 19 | `apps/web/package.json` |
| Composants | HeroUI v3 (`@heroui/react`) | imposé par `CLAUDE.md` |
| Styles | Tailwind v4 via plugin Vite | `apps/web/vite.config.ts` |
| Routage | react-router-dom 6 | `apps/web/src/router.tsx` |
| Icônes | `@phosphor-icons/react` | convention du dépôt |
| État serveur | TanStack Query 5 + tRPC 11 | `apps/web/src/lib/trpc/` |
| Éditeur | BlockNote sur ProseMirror | `packages/editor/` |
| Canvas | Excalidraw | `packages/canvas/` |
| Base de données | `@sqlite.org/sqlite-wasm` 3.53, VFS OPFS | worker, voir `database.md` |
| PWA | `vite-plugin-pwa`, stratégie injectManifest | `apps/web/vite.config.ts` |

Le service worker est **désactivé en développement** (`devOptions: { enabled: false }`), donc aucun cache périmé ne pollue une session de dev ou un test.

## Fichiers de configuration faisant autorité

| Fichier | Ce qu'il décide |
|---|---|
| `pnpm-workspace.yaml` | périmètre des workspaces, `allowBuilds` par paquet natif |
| `turbo.json` | graphe des tâches build, dev, lint, typecheck, clean |
| `packages/tsconfig/base.json` | TypeScript strict, `noUncheckedIndexedAccess`, cible ES2022 |
| `.prettierrc.json` | 100 colonnes, guillemets simples, plugin de tri Tailwind |
| `.npmrc` | `auto-install-peers`, liste `onlyBuiltDependencies` |
| `playwright.config.ts` | suite e2e chromium, serveur de dev sur le port 3277 |
| `Procfile` | `node apps/web/server.mjs` en production |

## Déploiement

Hébergé sur Scalingo. Le build de production est piloté par `pnpm scalingo-postbuild`, qui ne construit que `@supernote/web` avec `--max-old-space-size=4096`.

Le serveur de production est `apps/web/server.mjs`. Il sert le `dist/` prébuild avec repli history-API, et reste **sans dépendance** sur ce chemin pour survivre à l'élagage des devDependencies. Quand `DATABASE_URL` est défini, il monte en plus un backend de synchronisation temps réel sous `/api/sync/*`, qui charge `better-sqlite3` paresseusement. Avec les trois variables VAPID en plus, il monte `/api/push/*`, qui charge `web-push` paresseusement.

## Variables d'environnement

| Variable | Effet | Absente |
|---|---|---|
| `VITE_UNSPLASH_ACCESS_KEY` | recherche photo pour les couvertures de note | la recherche est indisponible, les presets marchent |
| `VITE_SOURCEMAP` | émission des sourcemaps au build | pas de sourcemaps |
| `DATABASE_URL` | active la synchronisation en ligne, en dev comme en prod | l'app reste purement locale |
| `ADMIN_TOKEN` | active le back-office `/admin` (mot de passe Basic Auth), exige `DATABASE_URL` | `/admin` sert le shell SPA |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | active les notifications push (`/api/push/*`), exige `DATABASE_URL` ; clés générées par `npx web-push generate-vapid-keys`, en changer invalide tous les abonnements | l'interrupteur « Notifications app fermée » reste indisponible |

Les valeurs vivent dans `apps/web/.env.local`, qui n'est pas versionné. Ne jamais recopier une valeur ici.

## Documentation périmée

`docs/dev/` décrit l'architecture Electron d'avant la migration vers la PWA. **Les onze fichiers mentionnent `apps/desktop`, qui n'existe plus.** `docs/dev/testing.md` prescrit du TDD London School avec vitest, ce qui contredit frontalement la politique zéro test unitaire de `CLAUDE.md`. Traiter `docs/dev/` comme de l'archive, pas comme une consigne.

Voir aussi : [architecture.md](architecture.md), [patterns.md](patterns.md), [onboarding.md](onboarding.md).
