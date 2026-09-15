# Motifs et pièges

*Last Updated: 2026-09-13*

Les motifs récurrents du dépôt, et surtout les contraintes que le code ne dit pas tout seul. Commence par la section « La chaîne zod » si tu touches aux champs, c'est le piège le plus coûteux.

## Result plutôt qu'exception

`@supernote/core/result` fournit `ok(v)` et `err(e)`. Le projet préfère un retour explicite au `throw` pour tout ce qui peut échouer de façon attendue. Les exceptions restent pour l'inattendu.

## ⚠️ La chaîne zod : pourquoi une propriété de champ disparaît au rechargement

C'est le piège numéro un. Le symptôme est cruel : la valeur est bien écrite, elle disparaît au rechargement, et **rien n'erreur**.

La cause tient en deux faits qui se contredisent.

1. Le worker est un **pass-through**. `entitiesCreate` et `schemasCreate` sérialisent `entity_type.fields` en JSON brut. Ajouter une clé ne demande donc aucune modification du worker.
2. Mais le schéma zod de sortie IPC **strippe toute clé qu'il ne déclare pas**. Si `FieldDefinitionSchema`, dans `packages/ipc/src/schemas/schemas.ts`, ignore la clé, alors `schemas.list` et `schemas.get` la perdent à la lecture.

Les quatre couches à toucher, dans l'ordre :

| Étape | Fichier | Action |
|---|---|---|
| 1 | worker | rien, il passe déjà la clé |
| 2 | `packages/ipc/src/schemas/schemas.ts` | déclarer la clé dans `FieldDefinitionSchema` |
| 3 | `apps/web/src/components/schemas/adapters.ts` | `ipcFieldToCore` **et** `coreFieldToIpc` |
| 4 | `ColumnEditorSidebar.tsx` | `FieldEditForm`, état, rendu, sauvegarde |

⚠️ `@supernote/ipc` est consommé via **dist**. Après l'étape 2, `pnpm --filter @supernote/ipc build`, sinon rien ne change.

## Deux vocabulaires, un traducteur

Le worker stocke la forme IPC, le domaine parle la forme core. `type` côté IPC contre `kind` côté core, `formulaExpr` contre `expression`.

`apps/web/src/components/schemas/adapters.ts` est le **seul** traducteur, dans les deux sens. Les seeds anciens stockent `kind` au lieu de `type`, donc l'adapter accepte les deux.

## ⚠️ Le cycle dist

Les paquets `@supernote/*` sont consommés par leur `dist/`, jamais par leur source. Aucun alias Vite ne réécrit vers `src/`, et le commentaire de `apps/web/vite.config.ts` le dit explicitement.

Conséquence : **modifier le TypeScript d'un paquet n'a aucun effet tant que `pnpm build:packages` n'a pas tourné.** Il n'y a pas de mode watch dans `turbo.json`.

Une exception utile : le CSS de l'éditeur est exporté depuis `src/`, donc un simple rechargement suffit pour une modification de style.

## ⚠️ Pièges ProseMirror

Deux bugs vécus, tous deux coûteux à retrouver.

**Le MutationObserver.** Toute mutation d'attribut DOM sur un élément du sous-arbre `.ProseMirror`, par exemple un `setAttribute` depuis un écouteur `selectionchange`, est vue par l'observer de ProseMirror. Pendant la conversion d'un bloc vers un NodeView React, il re-parse et re-résout la sélection à la frontière du groupe, et les frappes partent dans le mauvais bloc. Pour marquer un bloc visuellement, passe **toujours** par une balise `<style>` dynamique dans le `<head>`, keyée sur `data-id`.

**La sélection collapsée.** Un toggle React sur un contrôle de la barre de formatage flottante qui monte un sous-menu au clic collapse la sélection, donc la barre se démonte avant que le menu paraisse. Le motif qui marche est dans `editorChrome.tsx` : capturer les bornes à l'ouverture, geler la boîte dans une ref, restaurer la sélection juste avant d'appliquer le style.

**Dédoublonnage forcé.** `vite.config.ts` force un exemplaire unique de chaque paquet ProseMirror. Deux copies déclenchent `RangeError: Duplicate use of selection JSON ID cell`, parce que ces paquets enregistrent des classes au chargement du module.

## Blocs personnalisés BlockNote

Treize blocs dans `packages/editor/src/blocks/`, assemblés par `packages/editor/src/schema.ts` en un schéma combiné.

Deux façons de déclarer, selon le besoin :
- `createBlockSpec` et `createInlineContentSpec` pour un rendu figé, comme `callout`, `mention`, `tag`, `wikilink`.
- `createReactBlockSpec` et `createReactInlineContentSpec` pour un rendu React dynamique, comme `databaseView`, `formula`, `googleSheet`, `gmailMessage`.

Un bloc qui dépend de données d'exécution reçoit son renderer par contexte, via un provider, plutôt que par import direct.

## Mouvement

Toute animation passe par les tokens `--sn-*` de `apps/web/src/globals.css` et par le moteur de `apps/web/src/lib/motion/`. **Jamais** framer-motion, react-spring, ni cubic-bezier ad hoc.

Transition CSS pour un état discret, moteur JavaScript pour une valeur continue. Animer `transform` et `opacity`, pas `width` ni `top`.

Le mode de saisie se décide **au pointeur, jamais à la largeur** : `.sn-reveal` pour une affordance secondaire, `.sn-hit` pour le plancher tactile de 32 pixels.

⚠️ `.sn-pressable` est défini **après** `.sn-motion-colors`. Empiler les deux fait gagner la transition de la première et perdre l'ease couleur.

## ⚠️ Le design system est largement contourné

| Import depuis `apps/web/src` | Fichiers |
|---|---|
| `@heroui/react` en direct | 150 |
| `@supernote/ui` | 83 |

`CLAUDE.md` impose HeroUI v3, et c'est respecté. Mais le paquet `@supernote/ui`, qui enveloppe une quinzaine de ces composants, est contourné presque deux fois sur trois. Si tu ajoutes un composant, vérifie d'abord si `@supernote/ui` le fournit déjà.

## ⚠️ Deux versions de zod coexistent

| Paquet | zod |
|---|---|
| `@supernote/core` | ^3.24.0 |
| `@supernote/ipc` | ^4.4.3 |

Les API de zod 3 et 4 diffèrent. Un schéma copié d'un paquet à l'autre ne se comporte pas forcément pareil, en particulier sur le stripping et les messages d'erreur.

## Vérification

Pas de test unitaire, c'est une décision. `pnpm typecheck` plus `pnpm test:e2e`, neuf tests Playwright chromium.

La suite amorce l'app en **mode dégradé** en posant `supernote.degraded` et `supernote.onboarding.completed` dans le stockage local avant chargement, ce qui évite le sélecteur de dossier et la visite guidée. Le serveur de test tourne sur le port 3277 en `--strictPort`, parce que le 3100 est tenu par un service Windows invisible depuis WSL.

⚠️ Les fichiers de `tests/` n'appartiennent à aucun workspace, donc `pnpm typecheck` **ne les couvre pas**, et Playwright transpile sans vérifier les types.

Voir aussi : [database.md](database.md), [modules.md](modules.md), [coding-style.md](coding-style.md).
