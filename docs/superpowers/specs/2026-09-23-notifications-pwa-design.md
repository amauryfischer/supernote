# Notifications par défaut, mails en push, PWA exploitée — design

*2026-09-23 · statut : à relire*

## Problème

Les notifications push existent (`push-backend.mjs`, `public/sw.js`, `lib/push/`) mais :

1. elles sont **éteintes par défaut** (`pushSubscribed: false`, `settings/defaults.ts`) et cachées dans Réglages → Notifications ;
2. côté mail, seules les **relances** et les **reports** notifient ; un **nouveau mail** ne notifie jamais, app ouverte ou fermée ;
3. la PWA n'exploite ni badge d'icône, ni raccourcis, ni partage, ni actions de notification (hors « Rejoindre »).

## Décisions de cadrage

| Sujet | Décision |
|---|---|
| Nouveau mail app fermée | **Gmail `users.watch` → Google Pub/Sub → serveur Scalingo → Web Push** |
| Mails concernés | **Toute la boîte de réception** (`labelIds: ["INBOX"]`) |
| Contenu de la notification | **Jeton Gmail court partagé avec le SW** : riche si le jeton (≤ 1 h) est encore valide, générique sinon |
| Obtenir la permission | **Bandeau contextuel** dans `/mail`, abonnement silencieux si déjà accordée |
| PWA | badge non-lus, actions dans les notifs, raccourcis d'icône, cible de partage |

Contraintes non négociables :

- le navigateur exige un **geste utilisateur** pour `Notification.requestPermission()` : « par défaut » = proposer tôt, pas accorder en silence ;
- le push exige un **salon protégé** (403 sinon) : inchangé, pour la raison documentée dans `communication.md` ;
- le serveur **ne stocke jamais** de jeton Gmail ni de contenu de mail ;
- Safari révoque la permission d'un push sans notification affichée : **tout push affiche quelque chose**.

## Sous-projet A — activé par défaut

### Comportement

- `pushSubscribed` passe à `true` dans `defaults.ts`. Il exprime désormais « l'utilisateur veut le push », pas « l'abonnement a réussi ».
- `PushScheduleRunner` (déjà monté partout) appelle au démarrage un nouveau `ensurePushSubscription()` :
  - permission `granted` + disponibilité `ok` → abonnement silencieux (réutilise `refreshPushSubscription`) ;
  - permission `default` + disponibilité `ok` → rien ; le bandeau prend le relais ;
  - permission `denied` ou disponibilité ≠ `ok` → rien.
- Nouveau composant `PushPromptBanner`, rendu en tête de la liste `/mail` (desktop et mobile), visible si :
  `pushSubscribed && Notification.permission === "default" && pushAvailability() === "ok" && !dismissed`.
  - texte : « Reçois tes mails, rappels et relances même Supernote fermé » · bouton **Activer** · bouton icône **Plus tard** (croix, Tooltip) ;
  - **Activer** → `subscribePush()` (le clic est le geste requis) ; retour porté par le bouton (chargement → coche) via `lib/action-feedback.tsx`, pas de toast ;
  - **Plus tard** → masqué 14 jours (`localStorage` `supernote.push.promptDismissedUntil`) ;
  - disponibilité `no-password` : même bandeau, bouton **Protéger le salon** qui ouvre le réglage du salon (existant, `onOpenSync`) ;
  - disponibilité `ios-not-installed` : texte « Ajoute Supernote à l'écran d'accueil pour recevoir les notifications », sans bouton d'action.
- Réglages → Notifications : l'interrupteur reste la source de vérité ; le couper désabonne et masque le bandeau pour de bon.

### Fichiers

- `components/settings/defaults.ts` : `pushSubscribed: true`
- `lib/push/push-client.ts` : `ensurePushSubscription()`
- `lib/push/PushScheduleRunner.tsx` : appel au montage
- `components/mail/PushPromptBanner.tsx` (nouveau, HeroUI v3 + `@supernote/ui`)
- `app/mail/page.tsx` : insertion du bandeau

## Sous-projet B — nouveau mail en push

### Flux

```
Client (page)                     Google                         Serveur Scalingo                  SW (téléphone)
─────────────                     ──────                         ────────────────                  ──────────────
users.watch(topic, INBOX) ──────▶ Gmail
POST /api/push/mail-watch
  {accessToken} ────────────────────────────────────────────────▶ getProfile(accessToken) → email
                                                                   upsert(email, vault) ; jeton jeté
                                  nouveau mail ─▶ Pub/Sub
                                  POST /api/push/gmail?key=… ─────▶ {emailAddress, historyId}
                                                                   par salon abonné à cet email :
                                                                   web push {kind:"mail", historyId}
                                                                   ───────────────────────────────▶ push
                                                                                                    jeton IDB valide ?
                                                                                                    oui → history.list
                                                                                                      → notif riche + badge exact
                                                                                                    non → notif générique + badge +1
```

### Client

- **Inscription du watch** (`lib/mail-push-watch.ts`, nouveau) : quand Gmail est connecté, le push abonné et le dernier watch a plus de 24 h (`localStorage` `supernote.mailWatch.renewedAt`), appeler :
  1. `POST gmail/v1/users/me/watch` `{ topicName: <GMAIL_PUBSUB_TOPIC>, labelIds: ["INBOX"], labelFilterBehavior: "include" }` via `googleRequest` ;
  2. `POST /api/push/mail-watch?vault=…` `{ accessToken }` (en-tête `x-sync-token` comme les autres routes push).
  Le watch expire à 7 jours, le renouvellement quotidien le garde vivant tant que l'app est ouverte au moins une fois par semaine. Le nom du topic arrive par `GET /api/push/key` (champ `gmailTopic` ajouté), pas par une variable Vite : une seule source de vérité côté serveur.
- **Jeton partagé avec le SW** (`lib/google-drive.ts`) : à chaque jeton obtenu dont les scopes couvrent Gmail, l'écrire dans IndexedDB (`supernote-sw` v1, store `kv`, clé `gmailToken` : `{ token, expiresAt }`) ; l'effacer sur `forgetAccessToken` / `clearAccessToken`. Base IndexedDB **dédiée**, pour ne pas faire évoluer la version partagée avec le stockage des handles de coffre.
- **Dernier historyId vu** : écrit par la page dans le même store (clé `mailHistoryId`) à chaque synchro du miroir, pour que le SW ne renotifie pas ce que l'utilisateur a déjà vu.

### Serveur (`push-backend.mjs`, `push-store.mjs`)

- Table `push_mail_watch (email TEXT, vault TEXT, updatedat BIGINT, PRIMARY KEY (email, vault))`, purge des lignes de plus de 8 jours au tour du planificateur.
- `POST /api/push/mail-watch` (derrière `vaultAuthed` + `vaultProtected`) : appelle `https://gmail.googleapis.com/gmail/v1/users/me/profile` avec le jeton reçu ; 200 → `upsert(emailAddress, vault)` ; sinon 400. **Le jeton n'est ni stocké ni journalisé.** C'est la preuve de propriété de l'adresse : sans elle, n'importe qui pourrait écouter l'activité d'une adresse.
- `POST /api/push/gmail?key=<GMAIL_PUSH_SECRET>` : point d'entrée de l'abonnement push Pub/Sub. Clé comparée en temps constant, sinon 403. Décode `message.data` (base64 JSON `{emailAddress, historyId}`), répond **204 immédiatement** (Pub/Sub rejoue sur non-2xx), puis :
  - **coalescence** : au plus un push par salon et par adresse toutes les **30 s** ; les messages intermédiaires ne font que mettre à jour le `historyId` en attente ;
  - payload `{ kind: "mail", title: "Nouveau mail", body: "", url: "/mail", tag: "mail-new", historyId, email }`.
- Variables d'environnement : `GMAIL_PUBSUB_TOPIC` (`projects/<id>/topics/<nom>`), `GMAIL_PUSH_SECRET`. Absentes → routes mail désactivées, le reste du push inchangé.

### SW (`public/sw.js`)

Sur `push` avec `kind === "mail"` :

1. Lire le jeton IndexedDB. **Valide** (expiresAt > maintenant + 60 s) :
   - `history.list?startHistoryId=<dernier vu>&historyTypes=messageAdded&labelId=INBOX` ;
   - pour chaque message ajouté (5 au plus), `messages.get?format=metadata&metadataHeaders=From&metadataHeaders=Subject` ;
   - 1 message → titre = expéditeur (nom seul), corps = objet ; n messages → « n nouveaux mails », corps = expéditeurs ;
   - aucun message ajouté (le watch notifie aussi les archivages et les lectures) → **aucune notification utile** ; afficher une notification `silent` au tag `mail-sync` puis la fermer aussitôt (Safari exige l'affichage) ;
   - `labels.get INBOX` → `setAppBadge(messagesUnread)` ;
   - enregistrer le nouveau `historyId` vu.
2. **Invalide** : notification générique « Du nouveau dans ta boîte » (tag `mail-new`, remplace la précédente), `setAppBadge` +1 sur la dernière valeur connue (IndexedDB).
3. Texte toujours posé en `textContent`-équivalent (API Notification = texte brut) ; jamais de HTML du mail.

**Plafond connu** : jeton expiré (app pas ouverte depuis plus d'1 h), un archivage fait sur un autre appareil déclenche une notification générique à tort. La coalescence de 30 s et le tag unique limitent l'empilement. `ponytail:` à lever si ça gêne en usage réel : un filtre serveur exigerait un jeton serveur, écarté au cadrage.

### Opérations manuelles (une fois, par Amaury)

1. GCP (projet OAuth existant) : activer Pub/Sub, créer le topic, donner `roles/pubsub.publisher` à `gmail-api-push@system.gserviceaccount.com`.
2. Créer un abonnement **push** vers `https://<app>.osc-fr1.scalingo.io/api/push/gmail?key=<secret>`.
3. `scalingo env-set GMAIL_PUBSUB_TOPIC=… GMAIL_PUSH_SECRET=…`.

## Sous-projet C — PWA

### Badge non-lus

- Page : quand le miroir mail connaît le nombre de non-lus de l'INBOX, `navigator.setAppBadge(n)` (0 → `clearAppBadge`). Écrit aussi la valeur dans IndexedDB pour le +1 du SW.
- SW : voir B. Feature-detect partout (`"setAppBadge" in navigator`).

### Actions dans les notifications

- Notification mail riche à **un seul** message : `actions: [{ action: "archive", title: "Archiver" }, { action: "read", title: "Lu" }]`, `data: { messageId, threadId }`.
- `notificationclick` :
  - `archive` / `read` avec jeton valide → `threads/{id}/modify` (`removeLabelIds: ["INBOX"]` ou `["UNREAD"]`) directement depuis le SW, badge recalculé, pas de fenêtre ;
  - sans jeton → `openWindow("/mail?thread=<id>&action=archive|read")` ; la page `/mail` lit `action`, pousse l'opération dans `mail_outbox` (chemin de triage existant), puis retire le paramètre de l'URL.
- Clic sur le corps → `/mail?thread=<id>` (existant).
- iOS ignore les actions : dégradé naturel vers le clic simple.

### Raccourcis d'icône (`public/manifest.json`)

`shortcuts` : **Nouveau message** (`/mail?compose=1`), **Nouvelle note** (`/mail?new=note`), **Agenda** (`/agenda`), **Todos** (`/todos`). `/mail` ouvre `openCompose` sur `compose=1` et crée la note par `useNewInboxNote` sur `new=note`, puis retire le paramètre. Pas `/?new=note` : la redirection du loader `/` → `/mail` perd la query. Icônes 96 px dans `public/icons/shortcuts/`.

### Partager vers Supernote

- `manifest.json` : `share_target` `{ action: "/share-target", method: "POST", enctype: "multipart/form-data", params: { title, text, url, files: [{ name: "files", accept: ["image/*"] }] } }`.
- SW intercepte `POST /share-target`, range le `FormData` dans Cache Storage (`share-inbox`), répond `303 → /partage?pending=1`.
- Route `/partage` (pas `/share`, déjà servi par `share.html` du partage par lien) : lit le partage, crée une note Inbox (`useNewInboxNote`) avec titre, texte, lien et images en pièces jointes (chemin de collage existant), puis navigue vers la note. Hors worker (mode dégradé) : message « Ouvre un coffre pour recevoir des partages ».

## Mobile

Le bandeau A s'affiche dans la liste mobile de `/mail` (`px-4 md:px-10`, cibles ≥ 32 px). Les raccourcis et le partage sont surtout mobiles par nature. Rien de desktop-only.

## Vérification

- `pnpm typecheck`.
- e2e Playwright (banc `tests/e2e/helpers` : `bootCloud` + `mockGoogleApis`) :
  - A : bandeau visible avec permission `default` (permission Playwright non accordée), disparaît après **Plus tard** ;
  - C : `/mail?compose=1` ouvre la composition ; `/mail?thread=X&action=archive` pousse l'archivage dans l'outbox (fetch Gmail mocké) ;
  - C : `POST /share-target` → note Inbox créée (SW actif en build preview).
- Serveur : `curl` sur `/api/push/gmail` avec clé fausse → 403, bonne clé + message factice → 204 et push émis vers un abonnement de test.
- Réel : Pub/Sub branché en prod, un mail envoyé à soi-même → notification sur le téléphone. **Jamais testé tant que les opérations manuelles B ne sont pas faites.**

## Hors périmètre

- Filtrage serveur des changements non-« nouveau mail » (exigerait un jeton serveur).
- Réponse rapide depuis la notification (champ texte d'action : Chrome Android seulement).
- Notifications d'autres boîtes que Gmail.
- Periodic Background Sync (déjà câblé pour les routines, inchangé).
