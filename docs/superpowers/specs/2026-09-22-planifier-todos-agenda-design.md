# Planifier ses todos dans l'agenda — design

*2026-09-22*

## Besoin

Réserver du temps pour une tâche : glisser un todo sur un créneau de `/agenda`, ou le planifier depuis le téléphone en choisissant parmi les prochains créneaux libres. Le bloc est un **vrai événement Google Agenda**, donc visible sur le téléphone et dans Google Agenda, et tes collègues te voient occupé.

## Décisions de cadrage (validées)

| Question | Décision |
|---|---|
| Ce que devient un todo planifié | un **événement Google lié** au todo, créé par l'outbox existante |
| Todos planifiables | todos (entités), emails todo (labels Gmail `Todo/n …`), tâches des notes (lignes `- [ ]`) |
| Téléphone | feuille « Planifier » : les 3 prochains créneaux libres, plus un choix manuel de date et d'heure |

## Le lien vit sur l'événement

Le lien entre la tâche et son bloc est porté par l'**événement Google**, dans `extendedProperties.private.supernoteRef`. Rien n'est écrit dans le todo, dans le fil mail ni dans la ligne markdown.

| Source | `supernoteRef` | Ouvrir la source |
|---|---|---|
| Todo (entité) | `todo:<entityId>` | `/todos` avec le todo en édition |
| Email todo | `mail:<threadId>` | `/mail?thread=<threadId>` |
| Tâche de note | `checklist:<noteId>:<hash>` | `/notes/<noteId>` |

`<hash>` est le `djb2` du texte nettoyé en minuscules, déjà calculé par `extractChecklists` (suffixe du `blockId`, `lib/todos/extractChecklists.ts:118`). Le préfixe d'index de ligne du `blockId` est **exclu** : déplacer la ligne dans la note ne casse pas le lien. Modifier son texte, si : le bloc devient orphelin (voir plus bas).

Pourquoi sur l'événement :

- **Un seul format pour les trois sources.** Écrire dans une ligne markdown ou dans un label Gmail aurait exigé trois mécanismes.
- **L'id provisoire ne pose pas de problème.** Un événement créé hors ligne porte `local-<ulid>` jusqu'à l'acquittement de l'outbox. Le lien ne référence pas cet id, donc rien à réécrire au remplacement.
- **Il voyage entre appareils sans rien de nouveau.** Chaque appareil synchronise l'agenda avec Google, et les propriétés étendues reviennent avec l'événement (`events.list` ne restreint pas `fields`).
- **« Planifié » est dérivé, pas stocké.** Un todo est planifié s'il existe un bloc à venir qui le référence. Supprimer l'événement dans Google le déplanifie, sans synchronisation à écrire.

## Données

### Miroir (`cal_event`)

- Nouvelle colonne `sourceRef TEXT NOT NULL DEFAULT ''` : dans le `CREATE TABLE` de `db-schema.ts` pour les coffres neufs, et migration `ALTER TABLE` idempotente dans `worker.ts` pour les coffres existants, sur le modèle des colonnes IA de `mail_thread` (`worker.ts:200`).
- Les événements existants gardent `''` jusqu'à la synchro complète suivante, ce qui suffit : seuls les blocs créés par cette fonctionnalité portent une référence.

### Contrats

- `CalEventInputSchema.sourceRef: z.string()` dans `packages/ipc/src/schemas/calendar.ts`, puis rebuild du dist. ⚠️ Sans ça, le zod de sortie strippe la clé et le lien disparaît à la lecture.
- `calendar-routes.ts` : `sourceRef` dans les colonnes d'`upsert` et le `SELECT` de `listEvents`.
- `lib/gcal.ts` : `extendedProperties?: { private?: Record<string, string> }` sur `GcalEventResource` et `GcalEventBody`. `toEventInput` lit `extendedProperties.private.supernoteRef`.

### Écritures (`useEventWrites.ts`)

- `EventDraft.sourceRef?: string`. `bodyOf` n'envoie `extendedProperties` **qu'à la création**. PATCH fusionne les objets côté Google, donc un déplacement ou un redimensionnement ne l'efface pas. `rowOf` prend `d.sourceRef ?? base.sourceRef` : la référence du brouillon à la création, celle de l'événement existant lors d'un patch local, pour que le miroir ne la perde pas.
- Nouvel appel `scheduleTask({ ref, title, sourceUrl, startAt, endAt })` : crée l'événement dans l'agenda **principal**, sans invités ni Meet, durée par défaut **30 min**. La description contient le lien vers la source (URL Supernote, ou `webLink` Gmail pour un email).
- `unscheduleTask(event)` : suppression via l'outbox existante.

## Recenser les tâches planifiables

`components/agenda/useSchedulableTasks.ts` fusionne les trois sources en une liste `{ ref, title, quadrant, done, openSource }` :

- **Todos** : entités `todo` non terminées. Les anciennes tâches projetées depuis une note (`sourceNoteId`) sont exclues, comme dans `calendar.overlay`.
- **Emails todo** : `useMailTodos` (labels `Todo/1…4`). Le quadrant est le numéro du label.
- **Tâches de note** : `useNoteChecklistTodos`, déjà partagé entre `/todos` et l'agenda.
- Quadrant d'Eisenhower : `quadrantOf` de `TodoMatrix.tsx:83`, exporté plutôt que dupliqué.

Carte des blocs : `calListEvents(accountId, début du jour, +60 j)` indexé par `sourceRef`. Une tâche est **à planifier** si aucun bloc qui la référence ne finit après maintenant.

## Interface

### `/agenda` sur ordinateur

- **Tiroir « À planifier »**, colonne repliable à droite des vues Jour et Semaine, dont l'état ouvert/fermé est mémorisé en `localStorage`. Il liste les tâches sans bloc à venir, groupées par quadrant (urgent et important en tête, quadrants vides masqués), avec un compteur.
- **Glisser une tâche sur la grille** en glisser-déposer HTML5 natif : `draggable` sur l'élément du tiroir, `dragover`/`drop` sur les colonnes de `TimeGrid`. Aperçu de 30 min pendant le survol, magnétisme au quart d'heure comme le reste de la grille. Au lâcher, `scheduleTask`. Le bloc se déplace et se redimensionne ensuite comme n'importe quel événement, avec le glisser existant.
- **Rendu du bloc** (`EventBlock`) : quand `sourceRef` est présent, une icône de case à cocher précède le titre. Si la tâche est terminée ou introuvable (référence absente de la liste des tâches ouvertes), le titre est barré et le bloc atténué. Ce rendu n'a lieu que sur `/agenda`, où les trois sources sont chargées. Le panneau « Aujourd'hui » de `/mail`, qui ne lit pas les checklists, n'affiche pas d'état terminé.
- **Détail** (`EventDetail`) : pour un bloc, « Ouvrir la tâche » (vers la source) et « Retirer du planning » (supprime l'événement).
- **Pas de doublon** : un todo daté et planifié apparaîtrait deux fois, en puce d'échéance (bande « Journée ») et en bloc. `useAgendaData` écarte les puces dont la référence correspond au `sourceRef` d'un événement de la plage. Cela vaut aussi pour le panneau « Aujourd'hui », qui passe par le même hook.

### Feuille « Planifier » (`ScheduleTaskSheet`)

La même feuille sert partout : `MobileSheet` sur téléphone, `Modal` sur ordinateur.

- **Créneaux libres** : les 3 prochains créneaux de 30 min sans chevauchement avec un événement minuté accepté ou en attente. La recherche part de maintenant arrondi au quart d'heure suivant, entre **9 h et 18 h** ; elle continue sur les jours suivants si la journée est pleine. Les événements sur la journée entière et ceux déclinés ne bloquent pas. Fonction pure dans `lib/agenda/free-slots.ts`.
- **Autre créneau** : date, heure de début, durée (30 min, 1 h, 2 h). Mêmes champs de date que `EditTodoModal`.
- **Tâche déjà planifiée** : la feuille montre le bloc actuel, et propose « Déplacer » (même choix de créneaux, puis patch) et « Retirer du planning ».
- **Agenda non connecté** : la feuille affiche « Connecte Google Agenda pour planifier » avec un lien vers `/agenda`, dont le bouton de connexion porte le geste utilisateur exigé par GIS.

Points d'entrée :

- **`/todos`** :
  - sur ordinateur, entrée « Planifier… » dans le menu contextuel des lignes (clic droit) ;
  - sur téléphone, bouton « Planifier… » dans la modale d'édition, qu'un tap sur la ligne ouvre. L'appui long, lui, sert déjà au mode sélection et au glisser de la matrice. Le menu est ouvert **aussi aux lignes d'email todo**, aujourd'hui exclues (`page.tsx:1530`), qui n'y reçoivent que « Planifier… » et « Ouvrir le fil ». Une ligne planifiée affiche une puce `mar. 14:00` (icône horloge).
- **`/agenda` sur téléphone** : action d'en-tête « Planifier une tâche » (`useMobileHeaderActions`). La feuille commence alors par la liste des tâches à planifier, groupée par quadrant comme le tiroir. Le FAB reste « Nouvel événement ».

### Mobile

Pas de glisser au doigt : on passe par la feuille. Les cibles font au moins 32 px, sans débordement horizontal à 360 px. Le tiroir n'existe pas sous 768 px ; l'action d'en-tête le remplace.

## Cas limites

| Cas | Comportement |
|---|---|
| Hors ligne | création dans l'outbox, bloc affiché « en attente », la tâche quitte le tiroir aussitôt (miroir optimiste) |
| Tâche terminée | le bloc reste dans Google comme historique ; barré dans `/agenda` |
| Todo supprimé, ligne de note modifiée | bloc orphelin, rendu comme terminé ; « Ouvrir la tâche » ouvre la source si elle existe encore |
| Bloc supprimé dans Google | la tâche revient dans le tiroir à la synchro suivante |
| Même tâche planifiée deux fois (deux appareils hors ligne) | deux blocs, tous deux valides ; la feuille montre le prochain |
| Deux lignes de checklist au texte identique dans une note | même hash, donc même référence : planifier l'une planifie les deux. Accepté, c'est rare. |
| Agenda principal en lecture seule | impossible en pratique (`owner`) ; si `canEditCalendar` refuse, on prend le premier agenda `writer` |

## Hors périmètre

- Cocher la tâche depuis le bloc : on l'ouvre à sa place. À ajouter si l'usage le réclame.
- Planification automatique de toute la liste (façon Motion).
- Durée estimée stockée sur le todo.
- Nettoyer les blocs des todos supprimés.
- Heures de travail réglables (constante 9 h–18 h, marquée `ponytail:` dans `free-slots.ts`).

## Découpage en lots

1. **Socle** : colonne et migration, schéma IPC, `gcal.ts`, `useEventWrites` (`sourceRef`, `scheduleTask`, `unscheduleTask`), `free-slots.ts`, `useSchedulableTasks`.
2. **Agenda ordinateur** : tiroir, dépôt sur `TimeGrid`, rendu `EventBlock`, actions de `EventDetail`.
3. **Feuille et points d'entrée** : `ScheduleTaskSheet`, menu de `/todos` (y compris les emails todo), puce « planifié », action d'en-tête mobile de `/agenda`.

## Vérification

- `pnpm typecheck` à chaque lot (après `pnpm build:packages` pour `ipc`).
- e2e `tests/e2e/04-agenda.spec.ts` (`bootCloud` + `mockGoogleApis`) :
  - un todo glissé du tiroir sur la grille crée un POST dont le corps contient `extendedProperties.private.supernoteRef = todo:<id>`, puis quitte le tiroir ;
  - à 360 px, l'action « Planifier une tâche » suivie du premier créneau crée le même POST ;
  - un événement renvoyé par Google avec `supernoteRef` s'affiche avec l'icône de tâche.
- Pas de test unitaire (politique du projet).
