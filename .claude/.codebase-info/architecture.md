# Architecture

*Last Updated: 2026-09-21*

Supernote est un **système de connaissance et CRM personnel local-first**. Il n'y a pas de serveur applicatif : la base de données tourne dans un Web Worker, dans le navigateur de l'utilisateur.

## La forme générale

```
┌─────────────────────────────────────────────────────────┐
│  Thread principal (React 19)                            │
│                                                         │
│  main.tsx → App → RouterProvider → RootLayout           │
│                                      │                  │
│                    14 providers imbriqués               │
│                                      │                  │
│                                  <Outlet/>              │
│                                      │                  │
│                     AppShell ──┬── ShellLayout (≥768px) │
│                                └── MobileShell (<768px) │
│                                      │                  │
│                                   Pages                 │
└──────────────────────────┬──────────────────────────────┘
                           │  tRPC sur postMessage
                           │  timeout 15 s par requête
┌──────────────────────────▼──────────────────────────────┐
│  Web Worker                                             │
│    worker-router.ts   ~4700 lignes, vault/entities/…    │
│    sqlite-adapter     @sqlite.org/sqlite-wasm 3.53      │
│    VFS OPFS SAH pool  + FTS5                            │
│    moteur d'automatisations                             │
└──────────────────────────┬──────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   Dossier local      OPFS cloud        localStorage
   (File System       + journal de       (mode dégradé)
    Access)            synchronisation
```

## Les trois sources de coffre

C'est la décision structurante de l'application. Chacune se comporte différemment, et beaucoup de bugs viennent d'une confusion entre elles.

| Source | Activation | Marqueur | Ce qui manque |
|---|---|---|---|
| **Dossier local** | `showDirectoryPicker()`, Chromium desktop seulement | handle en IndexedDB | rien, c'est le mode complet |
| **Coffre cloud** | répertoire OPFS + salon distant | `localStorage["supernote.cloud"]` | les fichiers `.excalidraw` ne transitent pas |
| **Mode dégradé** | repli, ou choix explicite | `localStorage["supernote.degraded"]` | worker, recherche, vues, relations, automatisations |

⚠️ Le mode dégradé n'est **pas** le worker. C'est un magasin plat clé-valeur dans `apps/web/src/lib/local-store/`. Tout ce qui présuppose le worker est absent. `hasWorkerBackend()` est le test à faire avant d'appeler une fonctionnalité riche.

La permission du dossier local **n'est pas persistée** entre sessions. Elle est revérifiée à chaque chargement.

## Ce que le worker possède

Le worker n'est pas qu'une base de données. Il porte :

- le routeur de procédures, `worker-router.ts`, pour `vault.*`, `entities.*`, `schemas.*`, `tags.*`, `search.*` ;
- le moteur SQLite et son adaptateur ;
- le mirroring vers `.supernote/index.db`, ce qui rend le coffre synchronisable par Git ;
- le moteur d'automatisations ;
- l'indexation plein texte, câblée à la main.

Il diffuse aussi des événements que le thread principal relaie en `CustomEvent` de fenêtre : `supernote:vault-ready`, `vault-error`, `index-progress`, `automation-notification`. C'est ce canal, et non une référence directe au worker, qui pilote l'overlay de choix de coffre. Il survit donc à un redémarrage du worker.

## Le modèle de données en une phrase

Tout est une **entité** typée. Un type d'entité porte ses définitions de champs en JSON, une entité porte ses valeurs en JSON, et les relations sont des arêtes dans une table séparée. Notes, contacts, comptes, actifs, todos : ce sont tous des entités de types différents.

Voir [database.md](database.md) pour les tables et les conséquences de ce choix.

## Frontières et traductions

| Frontière | Qui la franchit | Ce qui traduit |
|---|---|---|
| Thread principal ↔ worker | tRPC sur postMessage | `lib/trpc/browser-link.ts` |
| Forme core ↔ forme IPC | lectures et écritures de schémas | `components/schemas/adapters.ts` |
| Local ↔ distant | journal d'opérations | `lib/online-sync/client.ts` |

La deuxième ligne est celle qui coûte le plus cher quand on l'ignore. Voir [patterns.md](patterns.md).

## Héritages visibles

Trois migrations ont laissé des traces qu'il faut savoir lire.

**Next.js vers Vite.** Les pages vivent en `app/<route>/page.tsx`, portent `"use client"`, et importent `next/navigation` ou `next/link`. Ça fonctionne grâce aux alias de `vite.config.ts` vers `src/lib/next-shims/`. Ce n'est pas du Next.js.

**Electron vers PWA.** `apps/desktop` n'existe plus. Tout `docs/dev/` le décrit encore, et la page `/capture` visait cette fenêtre Electron. La suite e2e a été reciblée sur le navigateur en septembre 2026.

**Journal retiré.** Des coffres anciens contiennent des entités `daily` sous `Daily/`. `purgeJournalEntries()`, dans `vault-worker/worker.ts`, les supprime au démarrage par `entities.delete`, puis retire le type. Les entrées montées restent à leur coffre source, et la clé étrangère garde le type tant qu'il en reste.

## Ce que le worker ne fait pas

- `search.semantic` est un stub qui renvoie une liste vide, malgré une colonne `entity.embedding` dans le schéma.
- Il n'existe pas de migrations SQLite versionnées, seulement des `ALTER TABLE` idempotents au démarrage.

Voir aussi : [entry-points.md](entry-points.md), [communication.md](communication.md), [modules.md](modules.md), [patterns.md](patterns.md).
