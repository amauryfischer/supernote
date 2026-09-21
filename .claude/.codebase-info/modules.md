# Paquets

*Last Updated: 2026-09-22*

Quinze paquets dans `packages/`, plus l'application `apps/web`. **Deux dorment** (`db`, `crypto`) : vérifie cette page avant d'aller lire du code.

Tous les paquets sont consommés par leur `dist/`. Voir le cycle de build dans [patterns.md](patterns.md).

## Vivants, au cœur

| Paquet | Rôle | Note |
|---|---|---|
| `@supernote/core` | types du domaine, schémas zod, type `Result`, chemins, ulid | zod **v3** |
| `@supernote/ipc` | contrats tRPC partagés worker ↔ client | zod **v4**, c'est lui qui strippe |
| `@supernote/editor` | BlockNote 0.50 sur ProseMirror, 13 blocs personnalisés | importé par 13 fichiers |
| `@supernote/formulas` | parseur, évaluateur, bibliothèque, dialecte Coda | |
| `@supernote/ui` | composants partagés, une quinzaine enveloppent HeroUI v3 | largement contourné |
| `@supernote/canvas` | canvas Excalidraw et pont de sérialisation | importé par 3 fichiers |
| `@supernote/search` | aide à la recherche | |
| `@supernote/ai` | client Ollama local, extraction | |
| `@supernote/automations` | moteur d'automatisations, tourne dans le worker | |
| `@supernote/notifications` | notifications et leur rendu | |
| `@supernote/templates` | modèles de notes | |
| `@supernote/sync` | primitives de synchronisation | |
| `@supernote/tsconfig` | configuration TypeScript partagée | build seulement |

## Dormants : aucun import depuis l'application

| Paquet | Ce qu'il contient | Pourquoi il dort |
|---|---|---|
| `@supernote/db` | schéma Prisma, source du DDL recopié dans le worker | 2 références seulement, client généré en CI |
| `@supernote/crypto` | chiffrement | 1 référence seulement |

⚠️ **Finance et synchro git n'ont pas de paquet.** La finance vit entièrement dans `apps/web/src/components/finance/`, `apps/web/src/app/finance/` et `apps/web/src/lib/finance/`. La synchro git du shell (`apps/web/src/lib/git/`) importe `isomorphic-git` directement.

## `packages/views` n'existe pas

Le répertoire existe sur le disque mais ne contient qu'un `node_modules/`. Aucun fichier source, rien de suivi par Git, aucune dépendance déclarée. Il n'est mentionné que dans `docs/dev/`, qui est périmé.

Les vues de bases réelles vivent dans `apps/web/src/components/bases/`.

## Détail des quatre paquets qui portent le plus

**`@supernote/editor`** est bâti sur BlockNote 0.50, lui-même sur Tiptap et ProseMirror 3.22. Le schéma combiné est assemblé dans `src/schema.ts`, qui remplace la case à cocher par défaut et ajoute treize blocs : `callout`, `codeHighlight`, `embed`, `doodle`, `databaseView`, `formula`, `googleSheet`, `htmlArtifact`, `gmailMessage`, plus les contenus en ligne `wikilink`, `mention`, `tag`, `formulaInline`. Export principal `SupernoteEditor`, plus les utilitaires markdown et le keymap.

**`@supernote/ipc`** porte les contrats partagés. C'est là que vit `FieldDefinitionSchema`, dont l'omission d'une clé fait disparaître silencieusement une propriété de champ. Son docstring décrit encore une architecture Electron disparue.

**`@supernote/canvas`** est désormais Excalidraw uniquement. Les anciens types de nœuds et d'arêtes ne sont gardés que pour relire des documents anciens. Il expose `SupernoteCanvas`, un `DrawLayer` qui encode les références d'entités en éléments Excalidraw natifs, un sérialiseur, et un export secondaire pour lire ou écrire un fichier `.excalidraw` autonome.

**`@supernote/ai`** parle à **Ollama en local**, sur `http://127.0.0.1:11434`. Aucune variable d'environnement, aucune clé. Si Ollama ne tourne pas, les fonctions IA sont indisponibles.

## Intégrations externes

| Service | Appelé depuis | Configuration |
|---|---|---|
| Ollama | `@supernote/ai` | aucune, adresse locale en dur |
| Yahoo Finance, Stooq | `apps/web/src/lib/finance/price-fetch.ts` | aucune clé requise |
| Unsplash | `apps/web` | `VITE_UNSPLASH_ACCESS_KEY` |
| Google Drive, Gmail | `apps/web` | identifiant client saisi dans les réglages |

Ne recopie jamais une valeur de secret dans cette carte. Les valeurs vivent dans `apps/web/.env.local`, non versionné.

Voir aussi : [architecture.md](architecture.md), [patterns.md](patterns.md), [tech-landscape.md](tech-landscape.md).
