# Points d'entrée

*Last Updated: 2026-09-13*

## Démarrage du navigateur

La chaîne, dans l'ordre exact, de `apps/web/index.html` au premier rendu.

1. **Script pré-peinture**, `index.html`. Lit `localStorage["supernote-theme"]` et pose la classe de thème avant tout JavaScript React. Sans lui, flash de thème.
2. **`src/main.tsx`**. Appelle `installFreezeWatchdog()` **avant** React, pour dater le début de session côté diagnostic. En développement seulement, neutralise `performance.measure`, contournement d'un bug DevTools React 19 qui gèle l'onglet.
3. `StrictMode` est **désactivé** (`ENABLE_STRICT_MODE = false`). Les doubles effets de développement ne se manifestent donc pas, et un effet non idempotent peut passer inaperçu en local.
4. **`src/App.tsx`**. Un `AppErrorBoundary` de classe enveloppe le `RouterProvider`. C'est le filet pour tout ce qui est **hors** de l'arbre de routes.
5. **`src/router.tsx`**. Route racine `/` montée sur `RootLayout`, avec un second filet `RouteErrorBoundary` qui couvre le layout et toutes les pages.
6. **`src/RootLayout.tsx`**. Monte la pile de providers, puis l'`Outlet`.

## Pile de providers

L'ordre est significatif, du plus externe au plus interne.

```
ThemeProvider → ToastProvider → ConfirmProvider → NotificationsProvider
  → TrpcProvider → LocaleProvider → ShortcutProvider → SettingsProvider
    → PromptProvider → PwaVaultSetup → GitSyncProvider → OnlineSyncProvider
      → MountSyncProvider → ShellChromeProvider → <Outlet />
```

⚠️ **Un seul provider bloque réellement l'affichage** : `MessagesProvider`, dans `src/i18n/messages.tsx`, rend `null` tant que le fichier de traduction n'est pas chargé. Tout ce qui est sous lui attend.

`PwaVaultSetup` ne bloque **pas**, et c'est délibéré. Il rend toujours la même forme d'arbre, `{children}` plus un overlay conditionnel, pour que les enfants ne se démontent jamais. Un démontage relancerait l'initialisation du worker et pourrait perdre des mutations non vidées.

## Routage

`createBrowserRouter` de react-router-dom 6. Toutes les pages sont des enfants chargés paresseusement, un chunk Vite par page.

`lazyPage()` est un adaptateur : il convertit l'`export default` de chaque `app/<route>/page.tsx`, héritage du routeur par fichiers de Next, vers la forme `{ Component }` qu'attend react-router 6. Il absorbe aussi l'échec de chunk périmé en forçant **un** rechargement, limité à un toutes les 10 secondes via `sessionStorage`, pour ne pas boucler sur un build réellement cassé.

⚠️ Ce rechargement automatique peut surprendre pendant un débogage d'import.

Le repli `*` rend la page d'accueil. Il n'y a pas de composant 404 dédié.

## Les portes de navigation ne protègent rien

`src/lib/navigation/catalog.ts` définit `NavGate`, avec trois valeurs : `journal`, `routines`, `mail`. Trois entrées du catalogue les portent.

⚠️ Une porte fermée **masque seulement l'entrée dans la navigation**. La route reste accessible par URL directe, et ni le routeur ni les pages ne relisent le drapeau. N'appuie jamais une logique de permission dessus.

La résolution des portes est **dupliquée à l'identique** dans `components/shell/Sidebar.tsx` et `components/shell/mobile/MoreDrawer.tsx`. Ajouter une porte au catalogue oblige à toucher les deux fichiers.

## Bascule desktop et mobile

`components/shell/AppShell.tsx` est le dispatcheur. Sous 768 pixels il rend `MobileShell`, sinon `ShellLayout`.

Le seuil est `MOBILE_MAX_WIDTH = 767` dans `hooks/useIsMobile.ts`, aligné sur le préfixe `md:` de Tailwind. Un override de développement existe via `?mobile=1|0|auto`, persistant en `sessionStorage`.

## Serveur de production

`apps/web/server.mjs`, lancé par le `Procfile`. Sert le `dist/` prébuild avec repli history-API et les types MIME corrects pour le wasm, les modules et les polices. Monte `/api/sync/*` uniquement si `DATABASE_URL` est défini.

## Build et scripts

| Commande | Effet |
|---|---|
| `pnpm dev` | serveur Vite sur le port 3100 |
| `pnpm build:packages` | compile les paquets vers leur `dist/` |
| `pnpm typecheck` | `tsc --noEmit` par workspace, via Turborepo |
| `pnpm test:e2e` | Playwright chromium, serveur de dev sur 3277 |
| `pnpm scalingo-postbuild` | build de production, `@supernote/web` seul |

Voir aussi : [architecture.md](architecture.md), [communication.md](communication.md), [onboarding.md](onboarding.md).
