# Sous-pages façon Notion

*2026-10-26. Statut : approuvée par Amaury le 2026-10-26.*

## Intention

Amaury veut monter un **wiki** dans Supernote, comme il le fait dans Notion. Une page « Wiki » sert de sommaire. Chaque domaine est une sous-page sur laquelle on clique pour entrer, qui contient elle-même ses sous-pages, sur autant de niveaux que voulu. Aujourd'hui, `[[lien]]` ouvre une note en colonne et `![[note]]` en intègre le contenu, mais rien ne crée de hiérarchie entre notes.

## Objectifs

1. Dans une note, `/page` crée une sous-page vide, insère sa **carte** à la position du curseur dans la note parente, et ouvre la sous-page pour écrire.
2. Profondeur illimitée : une sous-page peut avoir ses propres sous-pages.
3. Cliquer ou toucher une carte **remplace** la page courante par la sous-page, comme Notion (pas d'ouverture en colonne).
4. Un **fil d'Ariane** cliquable situe la page : `Dossier › Wiki › Domaine › Sous-domaine`.
5. L'**arbre de gauche** range chaque sous-page sous sa page parente, avec un chevron pour déplier, comme la barre latérale de Notion.
6. Les sous-pages apparaissent **aussi** dans la liste des notes de leur dossier (colonne du milieu).
7. Desktop et mobile dans le même mouvement (règle du projet).
8. **Partager un wiki par lien** : la personne qui ouvre le lien de la page « Wiki » peut entrer dans ses sous-pages, comme dans Notion (phase 2, voir plus bas).

## Non-objectifs (v1)

- Transformer une note existante en sous-page par glisser-déposer d'une note sur une autre.
- Dupliquer une page avec toute sa descendance : « Dupliquer » ne copie que la page.
- Vue « galerie » ou « tableau » des sous-pages. La carte est une ligne.
- Icône ou couverture choisie par page, au-delà de ce qui existe déjà pour les notes.

## Anti-objectifs (échec même si « ça marche »)

- **Perdre une page.** Retirer une carte, supprimer ou archiver un parent ne doit jamais faire disparaître une sous-page sans geste explicite de l'utilisateur sur cette sous-page.
- Une carte qui affiche un titre périmé après un renommage.
- Un wiki de 50 pages qui rend l'arbre ou la liste inutilisable.
- Une carte créée mais perdue parce qu'on a quitté la page avant l'enregistrement.

## Modèle

**Mon choix.** La hiérarchie est portée par la sous-page, pas par les dossiers :

- chaque sous-page est une **note ordinaire**, avec `fields.parentId = <id de la note parente>`. Les champs de note sont du JSON libre (`entities.update`), donc pas de changement de schéma SQL ;
- elle est créée **dans le même dossier** que sa parente (`noteFilePath`, `apps/web/src/components/schemas/adapters.ts`, appelé par `useCreateNote` dans `hooks.ts`) ;
- la carte dans la parente est un bloc éditeur `subpage` avec la prop `noteId`, sérialisé sur une ligne `[subpage id="<noteId>"]`. C'est le même motif que `[databaseView base="…" view="…"]` (`packages/editor/src/serialization/parse.ts` et `serialize.ts`) ;
- **source de vérité de la hiérarchie : `fields.parentId`**. La carte n'est qu'une vue. Une sous-page reste enfant de sa parente même si sa carte est retirée ; elle reste visible dans l'arbre, dans la liste et via le fil d'Ariane ;
- parente introuvable (supprimée, archivée, absente du coffre) : la sous-page se comporte comme une note racine. Aucune cascade ;
- **garde anti-cycle** : un `parentId` qui mènerait à un cycle (A → B → A) est ignoré à l'affichage, la note est alors traitée comme racine ;
- **la carte est un lien**, affichable dans n'importe quelle note (mon choix). Son emplacement ne décide pas du parent : couper-coller une carte ou dupliquer une note qui en contient ne change aucun `parentId`. Le compteur de la carte compte les notes dont `parentId` vaut sa cible, pas les cartes ;
- **exhaustivité** (mon choix) : ancêtres et descendance ne se calculent pas depuis la liste client, plafonnée à 500 notes triées par date (`useNoteList`, `hooks.ts`). Ancêtres : lecture par id (`useNote` / `entities.get`), la chaîne est courte. Descendance (pour le déplacement) : une requête worker exhaustive, par exemple une route qui filtre `json_extract(fields, '$.parentId')`, avec son type IPC et le rebuild de `@supernote/ipc`. Le moyen exact reste au builder. L'arbre et la liste, eux, n'imbriquent que les notes déjà chargées.

Alternative écartée : un dossier par page parente (`Wiki/Domaine.md`). Cela demandait de renommer tout un dossier et ses descendants à chaque renommage de page, et de fusionner dans l'arbre une note avec son dossier homonyme.

## Comportements

### Création (`/page`)
- Entrée « Page » dans le menu slash (`packages/editor/src/extensions/slashMenu.tsx`), mots-clés `page sous-page wiki`.
- L'éditeur appelle un rappel hôte `createSubpage?: () => Promise<string | null>` (nouveau, dans `packages/editor/src/types.ts`, comme `createEntity`). L'hôte (`NoteEditor.tsx`) crée la note « Sans titre » avec `parentId` et le même dossier, puis renvoie son id.
- Le bloc `subpage` est inséré, puis **la parente est enregistrée avant de naviguer** vers `/notes/<id>`. Si l'enregistrement échoue, on reste sur la parente avec le bloc en place.
- Le titre de la nouvelle page reçoit le focus.

### La carte
- Ligne cliquable : icône de page, titre vivant résolu par id, compteur discret de sous-pages s'il y en a. Cible tactile d'au moins 32 px.
- Rendu délégué à l'hôte par `renderSubpage?: (props: { noteId: string }) => ReactNode`, comme `renderDatabaseView` et `renderEmbed`. Sans hôte, rendu de repli : le texte `Page` (même règle que `databaseView`).
- Note cible introuvable : carte grisée « Page introuvable », qu'on peut retirer.
- Clic : `router.push("/notes/<id>")`. Pas de colonne empilée.
- Retirer la carte (suppression du bloc) ne touche pas la sous-page.

### Fil d'Ariane
- Étend le `FolderBreadcrumb` existant (`NoteEditor.tsx`) : segments dossier, puis ancêtres de la page de la racine vers le parent direct, chaque segment cliquable. La page courante n'y figure pas, son titre est juste en dessous.
- Ancêtres lus par id (voir « exhaustivité » plus haut), chaîne de `parentId` avec la garde anti-cycle. Une parente archivée ou introuvable arrête la chaîne.
- Mobile : le fil passe à la ligne, sans débordement horizontal. Au-delà de 3 ancêtres, les intermédiaires se replient en `…`.

### Arbre (`FileTree.tsx`, `NoteRows` / `NoteRow`)
- Une note dont la parente est dans le même dossier s'affiche **sous** sa parente, avec un chevron. Elle disparaît du premier niveau du dossier.
- Une note dont la parente est ailleurs (après un déplacement) s'affiche au premier niveau de son dossier. La hiérarchie reste visible via le fil d'Ariane.
- État déplié mémorisé par note en localStorage, comme pour les dossiers.
- Le plafond `NOTES_PER_FOLDER_CAP` (50) porte sur les notes de premier niveau.

### Liste (colonne du milieu)
- Les sous-pages y apparaissent comme les autres notes. Sous le titre, une mention discrète « dans Wiki » nomme la page parente.

### Déplacement, suppression
- **Mon choix.** Déplacer une page vers un autre dossier (glisser-déposer, « Déplacer… ») déplace avec elle **sa descendance restée dans le même dossier qu'elle**, pour que le wiki reste groupé. Un enfant que l'utilisateur a rangé ailleurs exprès ne bouge pas.
- « Dupliquer » une sous-page crée une sœur (même `parentId`), sans carte dans la parente : elle apparaît sous la parente dans l'arbre.
- Supprimer ou archiver une page ne touche pas ses sous-pages : elles deviennent racines. Pas de cascade, pour l'anti-objectif « perdre une page ».

### Mobile (< 768 px)
- `/page` marche depuis le menu slash tactile, la carte se touche, le fil d'Ariane passe à la ligne.
- La flèche retour de la barre du haut garde son comportement actuel. Le fil d'Ariane sert à remonter d'un niveau précis.
- Sur mobile, l'arbre est la page `/notes` elle-même : elle suit les mêmes règles d'imbrication que l'arbre desktop.

## Phase 2 : partager un wiki par lien

Livrée après la phase 1 (sous-pages dans l'app), parce qu'elle touche l'authentification du partage (`.claude/.codebase-info/sharing.md`). **Revue de sécurité obligatoire.**

Comportement attendu :
- Partager une page partage aussi toute sa descendance, avec le même mode (lecture ou écriture), le même mot de passe et la même expiration que le lien de la page.
- Une sous-page créée plus tard sous une page partagée devient partagée à sa création, côté propriétaire.
- Côté invité (`apps/web/src/share/`, sans coffre ni worker), une carte `[subpage id]` est cliquable si sa cible fait partie du wiki partagé. Le clic ouvre la sous-page dans la page invité, avec un fil d'Ariane. Une carte qui pointe hors du wiki partagé s'affiche « Page privée », non cliquable.
- Arrêter le partage de la page racine arrête celui de toute sa descendance.

Modèle (mon choix, détail laissé au builder) :
- une ressource `note` gagne deux champs : l'id de note du coffre, et la ressource racine du wiki (vide pour la racine). Les liens restent attachés à la seule racine ;
- le jeton invité d'un lien ouvre toute ressource du même wiki, en REST comme sur `/collab` (Hocuspocus autorise un `documentName` du wiki) ;
- une route invité liste les pages du wiki (id de note, ressource, titre, parent) pour résoudre les cartes et construire le fil d'Ariane.

Anti-objectif propre à cette phase : **un lien ne doit jamais ouvrir une note hors de son wiki**, même en forgeant un id de ressource ou de note.

## Contraintes

- HeroUI v3 via `@supernote/ui`, boutons icône avec Tooltip et aria-label, pas de toast de succès.
- `@supernote/editor` est consommé par `dist/` : `pnpm build:packages` après chaque modification de l'éditeur.
- Pas de nouvelle dépendance, pas de test unitaire. Vérification par `pnpm typecheck`, `pnpm lint` et des e2e Playwright.
- Pièges ProseMirror (`.claude/.codebase-info/patterns.md`) : pas de `setAttribute` dans le sous-arbre de l'éditeur, et un widget n'entre pas dans le `textContent`.

## Laissé au builder
- Le comportement dans un coffre monté (`@mounts/`) et pendant une co-édition Yjs : `/page` y suit les règles de création de note existantes de ces modes.
- L'ordre des sous-pages dans l'arbre : le tri actuel par titre convient.

- Le découpage en tickets et l'ordre (éditeur d'abord : bloc, sérialisation, slash).
- Le détail visuel de la carte et du chevron dans l'arbre, dans le registre Linear existant.
- Le moyen de forcer l'enregistrement de la parente avant navigation (rappel existant de NoteEditor ou nouveau).

## Vérification attendue

E2e Playwright, desktop et mobile 390 px :
1. `/page` dans une note crée la sous-page, ouvre la sous-page, et la carte est dans la parente après rechargement.
2. Trois niveaux : le fil d'Ariane de la page de niveau 3 montre les deux ancêtres et les rend cliquables.
3. Renommer une sous-page met à jour le titre de sa carte dans la parente.
4. L'arbre range la sous-page sous sa parente. La liste du dossier la montre avec « dans <parent> ».
5. Supprimer la parente laisse la sous-page accessible en racine.
6. Déplacer la parente déplace sa descendance du même dossier, pas un enfant rangé ailleurs.
7. Aucun débordement horizontal sur mobile, cartes ≥ 32 px.

Phase 2, dans `07-share.spec.ts` (propriétaire et invité dans deux contextes) :
8. L'invité du lien d'un wiki entre dans une sous-page de niveau 2 et en revient par le fil d'Ariane.
9. Une carte vers une note hors du wiki s'affiche « Page privée ».
10. Un id de ressource hors du wiki, forgé par l'invité, est refusé en REST et sur `/collab`.
11. Arrêter le partage de la racine coupe l'accès aux sous-pages.
