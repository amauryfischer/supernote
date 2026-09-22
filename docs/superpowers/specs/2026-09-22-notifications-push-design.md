# Notifications push, app fermée — design

*2026-09-22*

## Besoin

Être prévenu sur le téléphone ou l'ordinateur **même quand Supernote est fermé** :

- rappel d'un todo (`reminderAt`) ;
- début d'un événement d'agenda, et début d'un bloc de tâche (voir la spec « Planifier ses todos dans l'agenda ») ;
- relance mail arrivée à échéance, fil reporté qui revient.

## État actuel

- Les rappels de todos passent par le moteur d'automatisation du worker (`setInterval` de 60 s, `packages/automations/src/engine/index.ts:82`), puis par `AutomationNotificationBridge` (`new Notification`). Donc **uniquement onglet ouvert**.
- Relances (`supernote.mail.followups`) et reports (`supernote.mail.snooze`) vivent en `localStorage` et **ne notifient rien**. `MailFollowupRunner` remet le fil en boîte de réception, onglet visible seulement.
- `cal_event` n'existe que dans le worker de chaque appareil. Le serveur ne connaît aucun événement.
- Service worker : `public/sw.js` (injectManifest). Il a un `notificationclick` réservé à `periodic-sync`, **aucun handler `push`**. `web-push` n'est pas installé.
- Le serveur stocke déjà les ops de synchro **en clair** (`sync-store.mjs:164`). Un texte de todo n'y expose donc rien de nouveau. **En revanche, les titres d'événements Google et les objets de mails n'ont jamais quitté l'appareil.** Les envoyer au serveur ouvre un flux nouveau, qui touche des données Gmail sous scopes restreints (voir « Contenu des notifications »).

Conclusion : seul le client connaît les échéances. **Chaque appareil envoie ses échéances à venir au serveur, qui les déclenche à l'heure dite.**

## Contenu des notifications : lisible (décidé)

Les notifications disent de quoi il s'agit : « Pas de réponse · Devis mairie de X », « Dans 10 min · 14:00 · Point équipe ». L'objet du mail et le titre de l'événement sont donc stockés sur le serveur jusqu'à l'envoi, puis purgés 7 jours après.

L'alternative générique (« Une relance arrive à échéance ») n'enverrait que l'heure et un lien interne opaque. Pour y basculer, seul le calcul des colonnes `title` et `body` change dans `PushScheduleRunner`.

## Techno retenue

**Web Push standard (VAPID) + `web-push` côté serveur + planificateur dans `server.mjs`.**

| Option | Pour | Contre |
|---|---|---|
| **Web Push + `web-push`** (retenue) | standard, marche app fermée (Chrome, Edge, Firefox, Android, iOS 16.4+ en PWA installée), une seule dépendance maintenue | ajoute une dépendance et 3 variables d'env |
| Web Push chiffré à la main | zéro dépendance | JWT VAPID + chiffrement `aes128gcm` : ~200 lignes de crypto à ne pas rater |
| Periodic Background Sync (déjà câblé) | existe | Chromium installé seulement, réveil toutes les 12 h au mieux : inutilisable pour une heure précise |
| Notification Triggers | local, sans serveur | API abandonnée par Chrome |

## Identité : le salon

L'abonnement est rattaché au **salon de synchro en ligne** (`vault` = clé normalisée du salon), et authentifié par le **même contrôle que la synchro** : `vaultAuthed` (`sync-backend.mjs:207`, en-tête `x-sync-token`, mot de passe de salon, anti-bruteforce). Il est exporté par `sync-backend.mjs` et passé au backend push par `server.mjs`.

Conséquences :

- Tous les appareils d'un même salon reçoivent les mêmes notifications : un rappel posé sur l'ordinateur sonne aussi sur le téléphone.
- **Sans synchro en ligne configurée, pas de push.** Le réglage l'explique et renvoie vers la configuration du salon.
- **Salon protégé par mot de passe obligatoire.** Sur un salon libre, le nom suffit à passer `vaultAuthed` : n'importe qui le connaissant pourrait pousser des notifications sur tes appareils. Le backend refuse l'abonnement et l'envoi si `pw:<salon>` est absent du `meta` de la synchro (helper `vaultProtected`, exporté avec `vaultAuthed`). Le réglage affiche « Protège ton salon par un mot de passe pour activer les notifications ».

## Serveur

### Stockage (`push-store.mjs`)

Double moteur SQLite `file:` / Postgres, même forme que `share-store.mjs`.

**`push_subscription`**

| Colonne | Rôle |
|---|---|
| `endpoint` (clé) | URL du service push du navigateur |
| `vault` | salon |
| `deviceId` | `supernote.onlineSync.clientId` de l'appareil |
| `p256dh`, `auth` | clés de l'abonnement |
| `createdAt`, `lastOkAt` | ms |

**`push_schedule`**

| Colonne | Rôle |
|---|---|
| `id` (clé) | aléatoire |
| `vault`, `deviceId` | qui l'a envoyée |
| `category` | `reminder` \| `event` \| `followup` \| `snooze` |
| `key` | identité stable de l'échéance (`reminder:<todoId>`, `event:<calendarId>:<eventId>`, `followup:<threadId>`, `snooze:<threadId>`) |
| `fireAt` | ms |
| `title`, `body`, `url` | contenu de la notification ; `url` est un chemin interne (`/todos`, `/mail?thread=…`) |
| `joinUrl` | lien Meet, sinon vide |
| `sentAt` | null tant que non envoyée |

### Qui fait foi

- **Catégories partagées** (`reminder`, `event`) : tous les appareils les connaissent, les todos par la synchro des entités et l'agenda par Google. Un envoi **remplace toutes les lignes du salon** pour cette catégorie : le dernier appareil qui envoie fait foi. Un appareil ancien qui se réveille resynchronise avant d'envoyer, donc il n'écrase pas avec des données périmées.
- **Catégories locales** (`followup`, `snooze`) : elles n'existent que dans le `localStorage` de l'appareil qui les a posées. Un envoi remplace les lignes de **ce salon et de cet appareil** pour la catégorie.
- Un appareil n'envoie une catégorie que s'il en a la source : le worker prêt pour `reminder`, l'agenda connecté pour `event`. Sinon, un appareil sans Google viderait les événements du salon.

### Routes (`push-backend.mjs`)

Le backend est chargé par `server.mjs` comme les autres (`{ enabled, handle }`), actif si `DATABASE_URL` et les clés VAPID sont présentes.

| Route | Rôle |
|---|---|
| `GET /api/push/key` | clé publique VAPID |
| `POST /api/push/subscribe?vault=…` | `{ deviceId, subscription }` → upsert par `endpoint` |
| `POST /api/push/unsubscribe` | `{ endpoint }` → suppression (l'endpoint est lui-même le secret) |
| `PUT /api/push/schedule?vault=…` | `{ deviceId, categories: { reminder?: [...], event?: [...], followup?: [...], snooze?: [...] } }`. Seules les catégories présentes sont remplacées. Au plus 200 lignes par catégorie, `fireAt` dans les 7 jours. |

Toutes les routes sauf `key` et `unsubscribe` passent par `vaultAuthed` et `vaultProtected`.

**Validation à l'entrée de `schedule`** (frontière de confiance) :

- `url`, résolue contre l'origine du serveur, doit rester sur cette origine ; sinon la ligne est rejetée. Un simple test de préfixe laisserait passer `/\evil`.
- `joinUrl` est vide ou en `https:`.
- `title` fait au plus 120 caractères et `body` au plus 240, tronqués au-delà.
- `category` appartient à l'énumération, `fireAt` est un entier dans les 7 jours.

Le service worker revérifie `url` et `joinUrl` avant d'ouvrir quoi que ce soit.

### Planificateur

- `setInterval` de 30 s avec `unref`, comme la compaction de `sync-backend.mjs:101`.
- **Réservation atomique** : `UPDATE push_schedule SET sentAt = now WHERE sentAt IS NULL AND fireAt <= now RETURNING …`. Même avec deux conteneurs, rien ne part deux fois.
- Une échéance ratée de plus de 15 min (serveur arrêté) est marquée envoyée sans notifier.
- Envoi à **tous les abonnements du salon**, avec un TTL de 15 min.
- `topic` = les 32 premiers caractères du SHA-256 de `key`, en base64url. Web Push limite `Topic` à 32 caractères base64url, et `key` contient des `@` (id d'agenda = adresse e-mail). Une notification remplacée ne s'empile pas chez le service push.
- Réponse 404/410 : l'abonnement est supprimé. Succès : `lastOkAt`.
- Lignes envoyées purgées au bout de 7 jours, dans le même tour.

### Variables d'env

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:`). Générées une fois (`npx web-push generate-vapid-keys`) et posées sur Scalingo par l'utilisateur, jamais écrites dans le dépôt. Changer de clés invalide tous les abonnements.

## Client

### S'abonner (`lib/push/push-client.ts`)

- Dans **Réglages › Notifications**, un interrupteur « Notifications app fermée ». Au geste : `Notification.requestPermission()`, `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`, puis `POST /api/push/subscribe`. L'arrêt se fait par `unsubscribe()` des deux côtés.
- **iOS** hors PWA installée (`navigator.standalone !== true`) : l'interrupteur est désactivé, avec « Ajoute Supernote à l'écran d'accueil pour recevoir les notifications ».
- **Pas de synchro en ligne** : l'interrupteur est désactivé, avec un lien vers la configuration du salon.
- Réglage mobile : même onglet, accessible par le `MoreDrawer`.

### Calculer et envoyer (`PushScheduleRunner`)

Monté une fois dans le shell, comme `CalendarRunner`. Il n'agit que si l'appareil est abonné.

| Catégorie | Source | `fireAt` | Titre / corps | `url` |
|---|---|---|---|---|
| `reminder` | route worker `push.upcoming` : todos non terminés, `reminderAt` dans 7 j et `reminderFiredAt` vide | `reminderAt` | « Rappel » / `reminderText` ou texte du todo | `/todos` |
| `event` | même route : `cal_event` des agendas cochés, minuté, non décliné, non annulé | `startAt − 10 min`, ou `startAt` pour un bloc de tâche (`sourceRef`) | « Dans 10 min · 14:00 » / titre, ou « C'est l'heure » / titre du bloc | `/agenda`, ou la source du bloc ; `joinUrl` = Meet |
| `followup` | `loadFollowups()` | `dueAt` | « Pas de réponse » / objet | `/mail?thread=…` |
| `snooze` | `loadSnoozed()` | `until` | « De retour » / objet | `/mail?thread=…` |

- La route worker `push.upcoming({ from, to })` renvoie rappels et événements en une requête, contrat dans `packages/ipc`. ⚠️ Chaque champ doit figurer dans le schéma zod de sortie.
- **Quand envoyer :**
  - au démarrage, une fois le worker prêt et le premier tirage de synchro en ligne fait ;
  - 10 s après un changement (`MAIL_FOLLOWUP_EVENT`, `MAIL_SNOOZE_EVENT`, `CALENDAR_CHANGED_EVENT`, mutation d'un todo) ;
  - toutes les 15 min onglet visible ;
  - **au passage en arrière-plan** (`visibilitychange` → `hidden`, `fetch` avec `keepalive`) : c'est le moment où l'état est le plus frais et où l'app va se fermer.
- Hors ligne : l'envoi échoue en silence et repart au prochain déclencheur. Les échéances déjà envoyées au serveur sonnent quand même.

### Recevoir (`public/sw.js`)

- Handler `push` : lit `{ title, body, url, tag, joinUrl }`, puis **affiche toujours** la notification : Safari révoque la permission d'un site qui reçoit un push sans notification affichée.
  - Appel : `showNotification(title, { body, tag, data: { url, joinUrl }, actions })`, avec l'action « Rejoindre » quand `joinUrl` existe (Android et ordinateur ; iOS ignore les actions).
  - Si une fenêtre Supernote est visible, le message lui est aussi transmis, et elle le pousse dans le tiroir de notifications de l'app. Les rappels (`tag` en `reminder:`) sont exclus : le moteur local les y a déjà posés.
- `notificationclick` générique :
  - action `join` : ouvre `joinUrl` ;
  - sinon, focalise une fenêtre existante et y navigue vers `url` (`client.navigate`), ou ouvre `url`.
  - Le cas `periodic-sync` actuel est conservé.

### Pas de doublon avec le moteur local

Quand l'appareil est abonné, `AutomationNotificationBridge` **ne crée plus de `new Notification`** pour les rappels ; il garde le tiroir in-app. C'est le push qui affiche la notification système, onglet ouvert ou non. Le moteur local continue de poser `reminderFiredAt`.

## Cas limites

| Cas | Comportement |
|---|---|
| Aucun appareil ouvert depuis 7 jours | plus rien de planifié au-delà de l'horizon ; rien ne sonne à tort |
| Todo terminé sur le téléphone, ordinateur éteint | le téléphone envoie `reminder` et remplace la liste du salon : le rappel ne sonne pas |
| Relance posée sur l'ordinateur | sonne sur tous les appareils du salon, y compris le téléphone |
| Permission refusée par le navigateur | l'interrupteur revient à off avec la raison |
| Abonnement expiré (410) | supprimé côté serveur ; au démarrage, le client détecte `getSubscription() === null` alors qu'il se croit abonné, et se réabonne |
| Deux appareils envoient `event` en même temps | le dernier gagne ; les deux listes viennent du même Google |

## Hors périmètre

- Choisir les catégories notifiées (tout est actif quand on s'abonne). À ajouter si les notifications d'événement doublonnent trop avec Google Agenda.
- Masquer le contenu des notifications sur l'écran verrouillé.
- Nouveaux mails importants (exigerait que le serveur surveille Gmail).
- Délai de prévenance réglable (constante 10 min, marquée `ponytail:`).
- Push sans synchro en ligne.

## Découpage en lots

1. **Serveur** : `web-push`, `push-store.mjs`, `push-backend.mjs`, planificateur, branchement dans `server.mjs`, export de `vaultAuthed`.
2. **Réception** : handlers `push` et `notificationclick` dans `sw.js`, relais in-app.
3. **Abonnement et envoi** : `push-client.ts`, interrupteur des réglages, route worker `push.upcoming` + contrat IPC, `PushScheduleRunner`, coupure des notifications système du pont local.

## Vérification

- `pnpm typecheck`.
- Serveur en local (`SYNC_DB_PATH`, clés VAPID de dev) : un `curl PUT /api/push/schedule` avec `fireAt = now + 40 s` déclenche un envoi, visible dans les logs et reçu par Chrome.
- e2e : le handler `push` du SW est déclenché par CDP (`ServiceWorker.deliverPushMessage`) et la notification est lue via `registration.getNotifications()`. Autre cas : une requête `PUT /api/push/schedule` interceptée après la création d'un rappel contient `reminder:<todoId>`.
- Contrôle réel en prod : téléphone Android (Chrome) et iPhone (PWA installée), app fermée.
- Pas de test unitaire (politique du projet).
