# Arborescence

*Last Updated: 2026-09-22*

Monorepo pnpm workspaces, orchestré par Turborepo. Le principe d'organisation est **par domaine**, pas par couche : chaque paquet possède un sujet, pas un étage technique.

```
supernote/
├── apps/
│   └── web/                    la seule application, SPA Vite + PWA
│       ├── src/
│       │   ├── main.tsx        amorçage, watchdog avant React
│       │   ├── App.tsx         filet d'erreur externe + RouterProvider
│       │   ├── RootLayout.tsx  pile de providers, 14 niveaux
│       │   ├── router.tsx      routes, toutes chargées paresseusement
│       │   ├── globals.css     tokens de design et de mouvement (68 Ko)
│       │   ├── app/            une page par route, convention héritée de Next
│       │   ├── components/     composants, groupés par domaine
│       │   │   ├── shell/      coquille desktop + mobile/
│       │   │   ├── home/       widgets de l'ancien accueil (banc /dev/writing-surface)
│       │   │   ├── notes/      arbre de fichiers, listes, éditeur de note
│       │   │   ├── schemas/    édition des types d'entité, adapters core↔IPC
│       │   │   └── ...
│       │   ├── hooks/          hooks partagés (useIsMobile, usePluginEnabled…)
│       │   ├── lib/
│       │   │   ├── vault-worker/   le coffre : worker, routeur, SQLite
│       │   │   ├── trpc/           pont navigateur↔worker
│       │   │   ├── online-sync/    synchronisation, journal, montages
│       │   │   ├── pwa/            choix du coffre, modes dégradés
│       │   │   ├── diagnostics/    watchdog anti-gel
│       │   │   ├── motion/         moteur d'animation continue
│       │   │   ├── navigation/     catalogue de navigation, source unique
│       │   │   └── next-shims/     compat pour les imports next/* résiduels
│       │   └── i18n/           chargement des messages, bloquant
│       ├── server.mjs          serveur statique de production, sans dépendance
│       └── vite.config.ts      React, Tailwind, PWA, shims, worker ES
├── packages/                   15 paquets, voir modules.md
├── tests/e2e/                  suite Playwright chromium
├── docs/
│   ├── dev/                    ⚠️ périmé, décrit l'ère Electron
│   ├── user/                   documentation utilisateur
│   ├── specs/ plans/ research/ notes de conception datées
│   └── ROADMAP.md
├── .claude/
│   ├── .codebase-info/         cette carte
│   ├── live-rules/             règles injectées selon le contexte
│   └── settings.json           plugins activés pour le projet
├── CLAUDE.md                   règles absolues du projet
├── turbo.json  pnpm-workspace.yaml  playwright.config.ts  Procfile
```

## Ce qu'il faut savoir avant de naviguer

**`apps/web/src/app/` n'est pas du Next.js.** La convention `page.tsx` et `[param]` est un héritage du portage. Les fichiers portent encore `"use client"` et importent `next/navigation`, `next/link`, `next/dynamic`. Ça ne marche que grâce aux alias de `vite.config.ts` vers `src/lib/next-shims/`. N'ajoute pas un import `next/*` sans vérifier qu'un shim existe.

**`packages/` contient beaucoup de paquets dormants.** Voir [modules.md](modules.md) pour savoir lesquels sont réellement consommés par l'application avant d'aller y lire du code.

**`docs/dev/` est de l'archive.** Les onze fichiers décrivent `apps/desktop`, qui n'existe plus. Ne les traite pas comme des consignes.

**Ce que la carte ne documente pas** : `node_modules/`, les `dist/` des paquets, `.turbo/`, `.worktrees/`, et `apps/web/.env.local` qui contient des secrets.

Voir aussi : [architecture.md](architecture.md), [modules.md](modules.md), [entry-points.md](entry-points.md).
