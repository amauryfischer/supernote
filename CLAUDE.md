# Supernote — règles projet

## Règles absolues

### UI : HeroUI v3 obligatoire

Tous les composants UI **DOIVENT** utiliser `@heroui/react` v3.

- `Button`, `Input`, `Textarea`, `Select`, `Modal`, `Popover`, `Dropdown`, `Card`, `Chip`, `Listbox`, `Tooltip`, `Checkbox`, `Switch`, `Radio`, `Tabs`, `Accordion`, `Badge`, `Avatar`, `Spinner`, `Progress`, `Divider`, `Link`, `Breadcrumbs`, `Pagination`, `Navbar`, `Table`.
- Pas de `<button>`, `<input>`, `<select>`, `<textarea>` HTML nus dans les composants — sauf cas justifiés (Cell editor, FormulaInputEditor textarea avec overlay coloré, etc.) qui doivent rester explicites.
- Pas d'autre lib UI (Mantine, MUI, AntD, Radix nu, etc.).

**Avant chaque nouveau composant** : vérifier la disponibilité dans `@heroui/react`. Si absent → demander avant de fallback HTML.

**Migration** : tout fichier existant qui utilise HTML nu doit être migré progressivement quand on y touche. Les nouveaux fichiers : v3 d'emblée.

### Mobile en même temps que desktop

Toute amélioration UI **DOIT** traiter le mobile dans le même mouvement — pas
de feature desktop-only qu'on « rattrapera plus tard ».

- Le shell mobile dédié vit dans `apps/web/src/components/shell/mobile/` et
  s'active sous 768px (`useIsMobile`, breakpoint = `md:` Tailwind).
- Quand on ajoute/modifie une surface (toolbar, panneau latéral, table, FAB,
  action de header…), vérifier qu'elle est **accessible et utilisable** sur
  téléphone : pas de débordement horizontal, hit-targets tactiles (~32px+),
  padding réduit (`px-4 md:px-10`), panneaux desktop (sidebars 320px) exposés
  en drawer/overlay côté mobile.
- Les pages publient leur chrome mobile via `useMobileTitle`, `useMobileFab`,
  `useMobileHeaderActions` (cf. `shell-chrome-context.tsx`). Une nouvelle page
  avec une action « créer » → publier un FAB.
- Un affordance global ajouté au `TopBar` desktop doit avoir son équivalent
  mobile (top bar, `MoreDrawer`, ou bottom nav).

### TypeScript strict

- `pnpm typecheck` doit toujours passer avant commit.
- Pas de `any`. `unknown` + narrowing acceptable.
- Pas de cast `as ... as never` non justifié.

### Tests

- Nouveaux packages → tests vitest.
- `pnpm --filter <pkg> test` doit passer.

## Architecture

- Monorepo pnpm workspaces. Packages dans `packages/`. App web dans `apps/web`.
- `@supernote/core` : types + logique pure (zod schemas, markdown, ulid, paths).
- `@supernote/ipc` : contrats tRPC partagés worker ↔ client.
- `@supernote/formulas` : parser + evaluator + stdlib formules (Coda-flavor).
- `@supernote/editor` : wrapper BlockNote + blocs custom (callout, databaseView, formula).
- `@supernote/canvas` : canvas Excalidraw + bridges.
- `@supernote/ui` : composants UI partagés (HeroUI v3 préférés).
- `apps/web` : SPA Vite, vault dans Web Worker (sql.js), tRPC browser-link.

## Patterns

- **Result type** : `@supernote/core/result` — `ok(v)` / `err(e)` au lieu de throw.
- **FormulaContext** dans worker : `resolveEntity`, `queryEntities`, `getRelations`, `now`.
- **Custom blocks BlockNote** : `createReactBlockSpec` ou `createBlockSpec`. Renderer délégué via `<Provider>` context pour les blocs qui dépendent de données runtime.
- **Worker stocke shape IPC** : `type` au lieu de `kind`, `formulaExpr` au lieu de `expression`. Adapters dans `apps/web/src/components/schemas/adapters.ts` traduisent core ↔ IPC.

## Commits

- Conventional commits français : `feat(scope):`, `fix(scope):`, `refactor(scope):`, `chore:`.
- Ne jamais commit sans demande explicite utilisateur.
- Jamais `--no-verify` sans demande explicite.

## Caveman mode

Mode terse activé en session. Garder substance technique complète, drop articles/filler/pleasantries. Code et commits : style normal.
