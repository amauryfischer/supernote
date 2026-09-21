# Todo mail par labels Gmail — design

*2026-09-21*

## But

Le split « Todo » du mail (matrice d'Eisenhower) se lit dans **4 labels Gmail**, un par quadrant. Un email porte un de ces labels, il apparaît dans la case correspondante. La vue est la même que l'on range depuis Supernote, Gmail ou Shortwave.

## Décisions

| Sujet | Décision |
|---|---|
| Source de vérité | Les `labelIds` du thread. Plus d'entité `todo` dans le coffre, plus de store localStorage de liaisons. |
| Labels | Créés automatiquement s'ils manquent : `Todo/1 Faire`, `Todo/2 Planifier`, `Todo/3 Déléguer`, `Todo/4 Éliminer`. Résolus **par nom** depuis `labelNames`, déjà chargé. |
| Portée du split | Les threads de l'inbox qui portent un label todo. Même sémantique que les groupes et les splits Shortwave. |
| Inbox | Un thread todo reste dans l'inbox, mais sort des tranches de temps : il vit dans une section « Todo », en tête de liste au-dessus d'« Étoilés », repliée par défaut. |
| Ranger / déplacer | Un seul `modifyLabels` : on ajoute le label du quadrant et on retire les 3 autres. |
| Fait | On retire le label todo et `INBOX`, ce qui archive le thread. Ça vaut pour le board comme pour le triage « Fait » (clavier, liste, fil ouvert). Annulable avec le toast d'undo, mais depuis le triage l'undo ne remet que `INBOX`. |
| Archiver ailleurs | Un thread labellisé puis archivé dans Gmail ou Shortwave sort du board. Archiver, c'est finir. |

## Composants touchés

**Modèle — `lib/mail-eisenhower.ts`**
- `TODO_LABEL_NAMES: Record<EisenhowerQuadrant, string>`
- `resolveTodoLabelIds(labelNames)` renvoie quadrant → id, ou null si absent
- `quadrantOfLabels(labelIds, ids)` renvoie le quadrant d'un thread, ou null
- `ensureTodoLabels(clientId, labelNames)` crée ceux qui manquent avec `createLabel` (gmail.ts), à la première action de rangement. Si un label manque, la fonction relit d'abord la liste Gmail, pour éviter un 409 sur un label créé depuis Shortwave.
- `todoLabelChange(labels, q)` et `applyLabelChange` calculent le diff `modifyLabels`.
- On supprime `quadrantToTodoFields` et `quadrantOf`. `TodoMatrix` a sa propre logique.

**Page mail — `app/mail/page.tsx`**
- Le filtre d'inbox `!getBinding(it.id)` disparaît. `buildMailSections` (`lib/mail-sections.ts`) reçoit les ids des labels todo et range ces fils dans la section « Todo ». Un groupe mixte est coupé en deux, comme pour « Étoilés ». Le repli par défaut passe par `DEFAULT_COLLAPSED`, et le stockage garde les écarts à ce défaut, ce qui préserve les réglages existants.
- On supprime la réconciliation au montage : un `entities.list` de tous les todos à chaque changement d'onglet, suspect n°1 du freeze relevé à l'audit.
- Le menu contextuel et le bouton « Quadrant » du board passent par `assignQuadrant(threadId, q)` : mise à jour optimiste de `cumItems`, puis `commitMutation` (miroir + outbox).
- Fait passe par `commitMutation` (retire le label todo et INBOX), puis un toast « Annuler » qui remet le label et INBOX.

**Board — `components/mail/MailEisenhowerBoard.tsx`**
- Il reçoit les items de l'inbox qui portent un label todo, classés par quadrant, au lieu des `bindings`.
- La carte affiche sujet, expéditeur et snippet de l'item, ou le mini-résumé IA de la liste (`useMailSummaries`) quand il existe.

**Fil ouvert — `EmailThreadView.tsx` + `MailEisenhowerPicker.tsx`**
- Le picker « Todo » sort du menu « Plus » : c'est un bouton icône de la barre directe, à côté de Fait/Archiver/Reporter. L'icône est pleine et colorée quand le fil est déjà rangé. Il garde ses 4 quadrants et la suggestion IA. Le fil pose le label lui-même (comme ses autres labels), prévient la page par `onLabelsChanged`, puis `onConvertedToTodo(labels)` ferme le fil et enregistre les labels créés. Marche aussi dans les fils intégrés (contacts, notes).

**Suppressions**
- `lib/mail-todo-binding.ts`, `components/mail/useConvertToTodo.ts`
- Dans `app/todos/page.tsx`, le store de liaisons. L'encart « tâche issue d'un email » des anciennes tâches lit maintenant les champs `mail*` de l'entité, qui y sont déjà.

**Inchangé**
- Raccourci `g t` (onglet todo), shell mobile. Le board s'affiche déjà sous le `tabStrip` mobile, et le picker du fil couvre le rangement au toucher.

## Migration

Un passage unique au premier chargement de l'onglet todo : pour chaque liaison localStorage restante, on applique le label de son quadrant au thread (et `INBOX`, puisque la conversion l'avait retiré), puis on efface la clé `supernote.mail.todo-bindings`. Les entités `todo` déjà créées dans le coffre restent intactes : ce sont désormais des tâches ordinaires dans /todos.

## Gratuit

Les règles mail (`then.addLabelId`) et l'auto-label peuvent viser ces 4 labels. Le tri automatique vers le board fonctionne sans code en plus.

## Vérification

- `pnpm typecheck`
- Réelle : ranger un email depuis Supernote, le voir labellisé dans Shortwave. Labelliser dans Shortwave, rafraîchir Supernote, le voir dans la bonne case. Fait : l'email disparaît du board et de l'inbox.
- Mobile 390px : onglet todo lisible, rangement depuis le fil ouvert.
- Aucun e2e ne couvre l'onglet todo aujourd'hui, et on n'en ajoute pas.
