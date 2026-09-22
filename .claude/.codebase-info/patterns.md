# Motifs et pièges

*Last Updated: 2026-09-22*

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

⚠️ Le type `personne` a lui aussi deux vocabulaires : la fiche `/contacts` lit `emails`, `phones`, `organisationId`, `social` (listes JSON), la base « Personnes » lit `email`, `phone`, `company`, `role`, `linkedin`. Écrire ou chercher un contact depuis ailleurs doit toucher les deux, comme `apps/web/src/lib/contact-from-email.ts`.

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

Mentions dans le markdown : l'éditeur écrit `@[Nom complet](entity:ID)` (`serialization/serialize.ts`), relit aussi l'ancien `@nom` sur un seul mot (`parse.ts`), et le scanner de backlinks du worker (`MENTION_REF_RE`) résout l'id avant le nom. Un `@Nom Prénom` nu était coupé au rechargement et perdait sa cible.

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

⚠️ Le `Button` de `@supernote/ui` rend toujours un `HeroButton variant="ghost"`, dont `.button--ghost` (hors `@layer`) écrase les fonds Tailwind. Seules primary, secondary, tertiary et danger portent `!` ; ghost (défaut) et outline n'en ont pas, pour que les couleurs passées en `style` inline gagnent.

⚠️ La règle globale `:focus-visible` de `globals.css` est hors `@layer` : elle bat `focus-visible:outline-none`. Un champ « nu » qui signale son focus autrement (soulignement de la ligne, cf. `ComposeModal.tsx`) doit écrire `focus-visible:outline-none!`.

## Retour d'action : le bouton, pas le toast

L'utilisateur refuse les toasts de confirmation. `apps/web/src/lib/action-feedback.tsx` porte le retour sur le bouton : `useActionFeedback()` rend `run(fn, onError?)`, qui ne lève jamais, et `<FeedbackIcon>` montre spinner, coche ou avertissement à la place de l'icône. Succès déjà visible dans l'UI : rien. Erreur d'un bouton : message dans son `Tooltip`, ou bandeau `role="alert"` dans un composeur ou une modale. Un `toast` ne reste que pour un échec sans contrôle d'origine ni rollback visible, ou pour « Annuler » une action destructrice (corbeille, fenêtre d'annulation d'envoi de `useDeferredSend`). Le module mail est migré ; le reste de l'app ne l'est pas encore.

## ⚠️ Deux versions de zod coexistent

| Paquet | zod |
|---|---|
| `@supernote/core` | ^3.24.0 |
| `@supernote/ipc` | ^4.4.3 |

Les API de zod 3 et 4 diffèrent. Un schéma copié d'un paquet à l'autre ne se comporte pas forcément pareil, en particulier sur le stripping et les messages d'erreur.

## ⚠️ Changer un défaut de réglage n'atteint pas les navigateurs existants

`SettingsProvider` (`apps/web/src/components/settings/SettingsContext.tsx`) écrit l'objet de réglages **entier** dans `supernote.settings` dès le montage. Chaque défaut en vigueur au premier lancement se fige donc dans le stockage local, et modifier `defaults.ts` ne change rien pour un navigateur déjà passé par l'app. C'est ainsi que `llama3.2` a survécu à deux changements du modèle par défaut.

Pour retirer un ancien défaut, ajoute-le à une migration du type `migrateIa` (`defaults.ts`, `RETIRED_DEFAULT_MODELS`), appliquée par **les deux** lecteurs de la clé : `loadInitialSettings` dans `SettingsContext.tsx` et `readPersistedIa` dans `lib/ai/settings.ts`. Le second lit le stockage sans attendre le Provider, et les effets des composants enfants passent avant l'écriture de celui-ci.

Côté Ollama, tout `createOllamaClient` doit recevoir `defaultModel` (`settings.ia.ollamaModel` ou `getAiSettings().model`). Sans lui, le client choisit seul dans `PREFERRED_MODELS` de `@supernote/ai`, `llama3.2:3b` en tête, et ignore les réglages.

## Vérification

Pas de test unitaire, c'est une décision. `pnpm typecheck` plus `pnpm test:e2e`, dix-huit tests Playwright chromium.

Deux amorces dans `tests/e2e/helpers.ts`. `bootDegraded` pose `supernote.degraded` : pas de worker, rendu seulement. `bootCloud(page, { googleAccount? })` ouvre un coffre cloud neuf sur un **vrai worker OPFS** (seul mode où miroirs, modèles et routes worker tournent) et remplace GIS par un faux ; `mockGoogleApis(page, handler)` intercepte `www.googleapis.com` et rend le journal des appels. Tout nouveau scénario worker ou Google va là (`04-agenda.spec.ts`, `05-templates.spec.ts`, `06-mail.spec.ts`), pas dans un banc jetable. Gmail n'est pas sur `www.googleapis.com` : `06-mail.spec.ts` route lui-même `gmail.googleapis.com` pour servir une boîte d'un fil. Le serveur de test tourne sur le port 3277 en `--strictPort`, parce que le 3100 est tenu par un service Windows invisible depuis WSL.

⚠️ Les fichiers de `tests/` n'appartiennent à aucun workspace, donc `pnpm typecheck` **ne les couvre pas**, et Playwright transpile sans vérifier les types.

Voir aussi : [database.md](database.md), [modules.md](modules.md), [coding-style.md](coding-style.md).
