# Agenda Google intégré

*2026-09-22 — statut : implémenté (lots 1 à 4), vérifié en e2e avec Google simulé ; contrôle sur un vrai compte à faire*

## Besoin

Un agenda de travail dans Supernote : voir, créer, déplacer et modifier les événements Google Agenda, et ouvrir en un clic une note de réunion liée à un événement. L'agenda réunit les événements et ce que Supernote sait déjà de tes dates : todos datés, reports et relances mail, dates des bases.

## Décisions de cadrage

| Question | Décision |
|---|---|
| Rôle | agenda de travail : lecture, création, déplacement, modification, suppression, réponse aux invitations, note de réunion liée |
| Placement | page `/agenda` (jour, semaine, mois, liste) et panneau « Aujourd'hui » à côté de la boîte mail |
| Sources ajoutées | todos avec échéance, reports et relances mail, dates des bases |
| Agendas Google | ceux cochés dans Google Agenda (`calendarList.selected`), avec leurs couleurs |
| Données | **miroir local dans le worker**, comme le mail : tables dans le coffre, synchro incrémentale, file d'envoi pour les écritures |
| Grille | maison, sur dnd-kit (déjà installé) et le design system, sans bibliothèque de calendrier |

## Architecture

Même découpage que le miroir mail, déjà éprouvé :

```
Google Calendar API v3  ⇄  lib/gcal.ts (REST, jeton, 401)
                              │
                     lib/calendar-sync.ts (moteur : fenêtre, delta, vidange outbox)
                              │  tRPC calendar.*
                     worker : lib/vault-worker/calendar-routes.ts
                              │
                     SQLite du coffre : cal_calendar, cal_event, cal_sync_state, cal_outbox
                              │
        lib/calendar-mirror.ts (lecture/écriture côté client)
                              │
   /agenda · panneau « Aujourd'hui » (/mail) · CalendarRunner (shell)
```

**Frontières.** Google reste la source de vérité. Le miroir est **local à chaque appareil**, hors op-log de synchro en ligne, exactement comme les tables mail : chaque appareil se synchronise avec Google. Le seul lien qui voyage entre appareils est porté par la **note de réunion** (champ `gcalEventId`), donc par la synchro des entités, sans rien de nouveau.

### Jeton et scopes

- Scopes : `https://www.googleapis.com/auth/calendar.events` (lire et écrire les événements) et `https://www.googleapis.com/auth/calendar.calendarlist.readonly` (liste des agendas et couleurs). Tous deux « sensibles », pas « restreints » : l'app en mode test les obtient comme Gmail.
- Jeton via `requestAccessToken(clientId, { scope })` de `lib/google-drive.ts`, qui met déjà en cache par couverture de scopes et passe le `login_hint` du compte connecté.
- **Refacto ciblée** : le cœur de `gmailRequest` (`lib/gmail.ts` : jeton, 401 → oubli du jeton et un seul rejeu, puis état « reconnexion requise ») devient `googleRequest(scope, …)` partagé. Gmail et l'agenda l'utilisent, chacun avec son propre état de reconnexion. Pas de deuxième copie de cette logique.
- Compte : l'adresse Google déjà connectée (`settings.gmail.connectedEmail`) sert d'`accountId`, comme pour le mail.

### Tables du worker (`db-schema.ts`)

| Table | Rôle | Clé |
|---|---|---|
| `cal_calendar` | agendas du compte : nom, couleurs, `selected`, `primary`, `accessRole` | `(accountId, id)` |
| `cal_event` | événements dépliés (`singleEvents=true`) : titre, lieu, description, `startAt`/`endAt` en ms, `allDay` + dates `YYYY-MM-DD`, fuseau, statut, `recurringEventId`, lien Meet, participants (JSON), réponse de l'utilisateur, `etag`, `htmlLink` | `(accountId, calendarId, id)` + index `(accountId, startAt)` |
| `cal_sync_state` | par agenda : bornes de la fenêtre, curseur `updatedMin`, dernière synchro complète | `(accountId, calendarId)` |
| `cal_outbox` | écritures optimistes en attente : `create`, `patch`, `delete`, `rsvp`, avec tentatives, statut, prochain essai | `opId` |

Créées par `CREATE TABLE IF NOT EXISTS` au démarrage du worker, comme les tables mail. Aucune colonne ajoutée à une table existante.

### Routes `calendar.*`

Contrats dans `packages/ipc` (`router/calendar.router.ts`, `schemas/calendar.ts`), implémentation dans un **nouveau module** `lib/vault-worker/calendar-routes.ts` branché dans `worker-router.ts` : le routeur fait déjà 5 000 lignes, on n'y ajoute pas un domaine entier.

| Route | Rôle |
|---|---|
| `calendar.syncUpsert` | écrit agendas, événements et suppressions reçus de Google, puis le curseur, en une transaction |
| `calendar.listEvents({ from, to })` | événements des agendas cochés dans la plage, avec `noteId` de la note de réunion liée s'il y en a une |
| `calendar.listCalendars` | agendas et couleurs |
| `calendar.getState` | curseurs et date de dernière synchro |
| `calendar.applyLocalMutation` | applique une écriture au miroir **et** l'ajoute à l'outbox, en une transaction |
| `calendar.listOutbox` / `calendar.resolveOutbox` | vidange : acquitte, échoue, ou remplace l'id provisoire d'un événement créé par son id Google |
| `calendar.overlay({ from, to })` | todos datés et entités de bases dont un champ date tombe dans la plage |

⚠️ Le zod de sortie IPC strippe toute clé non déclarée : chaque champ renvoyé doit figurer dans `schemas/calendar.ts`.

### Moteur de synchro (`lib/calendar-sync.ts`)

- **Fenêtre glissante** : de J−60 à J+180. `singleEvents=true` déplie les récurrences, ce qu'une vue agenda exige.
- **Synchro complète** d'un agenda : `events.list` sur la fenêtre, paginé. Les événements du miroir absents de la réponse sont supprimés.
- **Delta** : `events.list` sur la même fenêtre avec `updatedMin` = dernière synchro et `showDeleted=true` ; les `cancelled` sont retirés. On n'utilise pas `syncToken` : Google l'interdit avec `timeMin`/`timeMax`, et sans fenêtre une synchro initiale déplierait des années de récurrences.
- **Cadence** : delta toutes les 5 min onglet visible, au retour sur l'onglet, au retour du réseau, après chaque vidange de l'outbox ; synchro complète une fois par jour ou quand la fenêtre a glissé d'une semaine.
- **Vidange de l'outbox** avant chaque tirage, sur le modèle mail : échecs réseau, 401, 429 et 5xx ne comptent pas comme tentatives ; refus 4xx avec backoff ; un `create` acquitté remplace l'id provisoire (`local-<ulid>`) par l'id Google dans le miroir.
- **Conflits** : dernier écrit gagne côté Google. Un `patch` envoie `If-Match: <etag>` ; sur 412, l'événement est relu et la modification locale abandonnée avec un toast « Modifié ailleurs entre-temps ».

`CalendarRunner`, monté une fois dans le shell comme `MailFollowupRunner`, porte la cadence et la vidange, donc l'agenda reste à jour hors de `/agenda`.

### Sources superposées

Calculées à la lecture, jamais copiées dans `cal_event` :

- **Todos** : entités `todo` avec `dueDate`/`startDate` dans la plage, et lignes de checklist datées des notes. Le matérialiseur de checklists de `app/todos/page.tsx` est extrait dans un hook partagé plutôt que dupliqué.
- **Reports mail** : `loadSnoozed()` (`lib/mail-triage.ts`), placés à l'heure du réveil. **Relances** : `pendingFollowups()` (`lib/mail-followup.ts`), à leur échéance. Clic : ouvre le fil dans `/mail`.
- **Dates des bases** : `calendar.overlay` parcourt les types d'entités qui ont un champ `date` (hors `todo`) et renvoie les entités dont ce champ tombe dans la plage. Clic : side-peek de l'entité.

Chaque source a sa puce de filtre dans la barre d'outils de `/agenda`, mémorisée en `localStorage`. Les sources superposées sont en lecture : on les modifie à leur place d'origine.

## Interface

### Page `/agenda`

- **Vues** : Jour, Semaine (défaut sur ordinateur), Mois, Liste (défaut sur téléphone). Raccourcis `j`/`s`/`m`/`l`, `t` pour aujourd'hui, flèches pour avancer ou reculer.
- **Grille horaire** (jour et semaine) : bande « toute la journée » en haut (événements sur la journée entière, todos, dates de bases), colonnes horaires dessous, ligne de l'heure courante. Événements superposés côte à côte.
- **Glisser** (ordinateur, agendas où l'on peut écrire) : déplacer, redimensionner par le bas, glisser sur un créneau vide pour créer. dnd-kit, comme `TodoCalendarView`.
- **Détail** (popover sur ordinateur, feuille sur téléphone) : titre, horaire, lieu, lien Meet (« Rejoindre »), participants avec leur fiche contact quand l'e-mail correspond à un contact, réponse Oui / Peut-être / Non, bouton « Note de réunion », « Ouvrir dans Google Agenda ».
- **Éditeur** (modale) : titre, date, heures ou journée entière, agenda (parmi ceux où l'on peut écrire), lieu, description, invités, case « Ajouter une visio Meet » (`conferenceData.createRequest`). Une occurrence de série se modifie seule ; modifier toute la série renvoie vers Google Agenda.
- **Non connecté** : état vide avec « Connecter Google Agenda » (geste utilisateur, les popups GIS sont bloquées sinon). **Reconnexion requise** : même bandeau que le mail.
- **Hors ligne** : le miroir s'affiche ; les écritures partent dans l'outbox, avec le badge « en attente » du mail.
- Navigation : entrée « Agenda » dans `lib/navigation/catalog.ts` (barre latérale et MoreDrawer), commande de palette « Aller à l'agenda » et « Nouvel événement ».

### Panneau « Aujourd'hui » dans `/mail`

- Colonne repliable à droite de la boîte (ordinateur), ouverte ou fermée d'un bouton icône, état mémorisé. Chronologie du jour, prochain événement en tête avec « Rejoindre » et « Note de réunion », puis todos du jour.
- Téléphone : bouton d'en-tête de `/mail` (`useMobileHeaderActions`) qui ouvre la même chronologie en feuille.

### Note de réunion

- « Note de réunion » sur un événement : ouvre la note liée si elle existe (`listEvents` renvoie `noteId`), sinon la crée dans le dossier `Réunions/`.
- Titre `« <titre de l'événement> — <date> »`. Champs : `gcalEventId`, `gcalCalendarId`, `eventStart`. Corps : participants (mention `@` quand l'e-mail correspond à un contact, sinon le nom), lieu ou lien Meet, puis des sections vides « Ordre du jour », « Notes », « Actions ».
- Le lien voyage avec la note (synchro des entités) ; l'événement Google n'est pas modifié.

### Mail → événement

`EmailToEventButton` ouvre l'éditeur d'événement pré-rempli (sujet, date détectée par `lib/email-to-event.ts`, lien vers le fil) quand l'agenda est connecté. Sinon, comportement actuel (URL Google pré-remplie, `.ics`).

### Mobile

Liste par défaut, feuille de détail, bouton flottant « Nouvel événement » (`useMobileFab`), balayage horizontal pour changer de jour en vue Jour, cibles d'au moins 32 px, pas de débordement horizontal. Le glisser-déposer reste réservé à l'ordinateur ; au doigt, on modifie par l'éditeur.

## Erreurs

- Google injoignable : le miroir s'affiche avec « Dernière synchro il y a N min ».
- 401 : un rejeu, puis bandeau de reconnexion ; plus de tentative automatique tant qu'il est affiché.
- 403 sur un agenda en lecture seule : l'éditeur ne propose que les agendas `owner`/`writer` ; le glisser est désactivé sur les autres.
- 412 (etag) : relecture et toast.
- Mode dégradé sans worker : pas de miroir, l'agenda affiche « Ouvre un coffre pour utiliser l'agenda ».

## Hors périmètre

- Modifier toute une série récurrente (renvoi vers Google Agenda).
- Plusieurs comptes Google.
- Notifications push Google (`watch`) : elles exigent un webhook serveur.
- Recherche plein texte dans les événements.
- Glisser les todos ou les dates de bases dans l'agenda (on les modifie à leur place).
- Agendas iCloud, Outlook ou CalDAV.

## Découpage en lots

1. **Socle** : `googleRequest` partagé, `lib/gcal.ts`, tables et routes `calendar.*`, contrats IPC, moteur de synchro, `CalendarRunner`.
2. **Page `/agenda`** : vues, détail, éditeur, écritures via l'outbox, glisser, mobile.
3. **Sources superposées** : todos, reports et relances, dates des bases, puces de filtre.
4. **Liens** : note de réunion, panneau « Aujourd'hui » dans `/mail`, mail → événement.

## Vérification

- `pnpm typecheck` à chaque lot.
- e2e : `/agenda` ajouté à la liste des pages rendues de `tests/e2e/03-navigate.spec.ts`.
- Banc navigateur avec Google simulé (`initScript` : faux GIS et `fetch` intercepté, sur le modèle du banc mail) : synchro initiale, création hors ligne puis vidange, déplacement, 401 → reconnexion, desktop et 360 px.
- Contrôle réel sur le compte Google connecté avant mise en prod.
- Pas de test unitaire (politique du projet).
