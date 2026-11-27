# Notifications téléphone — plan d'implémentation

> **Exécution** : inline (choix d'Amaury : « je code les 5 lots d'affilée »), lot par lot, dans l'ordre. Cases `- [ ]` pour le suivi.

**Goal :** le téléphone ne vibre que pour ce qui compte, au bon moment, et chaque notif se traite depuis l'écran verrouillé.

**Architecture :** le serveur (`push-backend.mjs`) décide pour chaque abonnement : il trie les mails, applique les préférences et les heures calmes, gère les reports. Le SW (`public/sw.js`) affiche et exécute les actions. La page envoie les préférences et teste la livraison.

**Tech :** Node HTTP (`server.mjs`), `web-push`, SQLite/Postgres (`push-store.mjs`), SW non bundlé, React + `@supernote/ui` (HeroUI v3).

**Spec :** `docs/superpowers/specs/2026-11-27-notifications-telephone-design.md`

## Contraintes globales

- Zéro test : pas de fichier de test. Vérification : `pnpm typecheck`, `pnpm lint`, `node --check` sur les `.mjs` et `sw.js`, plus un contrôle jetable dans le scratchpad pour le tri (non commité).
- Le SW affiche toujours une notif par push. Ce qui ne doit pas sonner ne part pas.
- `computeSchedule` ne filtre jamais une catégorie.
- Même SQL pour les deux moteurs. `ALTER TABLE … ADD COLUMN` en `try/catch`, erreur « duplicate/already exists » ignorée.
- Routes authentifiées par l'endpoint : `test`, `prefs`, `later`, `archive`. Endpoint inconnu → 404.
- UI : `@supernote/ui`, boutons icône avec Tooltip et `aria-label`, retour par `useActionFeedback`, aucun toast.
- Commentaires : seulement le pourquoi, en français.

## Review Focus

1. **Abonnement sans `prefs`** (tous les existants) → défauts appliqués : mails `people`, tout le reste actif, heures calmes de 22:00 à 07:30, `Europe/Paris`.
2. **Push qui ne porte que `close`** → notif silencieuse ouverte puis fermée, aucune vibration.
3. **Téléphone hors réseau pendant 3 mails** → au retour, 3 notifs et une seule vibration, sans réafficher les mails déjà vus.
4. **Fuseau invalide ou heure mal formée dans `prefs`** → 400 au `PUT`. En lecture, une valeur corrompue vaut les défauts.
5. **`POST /archive` sur un fil non notifié, ou depuis un autre salon** → 403, et le SW retombe sur le chemin existant.

---

### Lot 1 : banc d'essai et appareils

**Fichiers :** `apps/web/push-store.mjs`, `apps/web/push-backend.mjs`, `apps/web/src/lib/push/push-client.ts`, `apps/web/src/components/settings/tabs/NotificationsTab.tsx`, `apps/web/src/components/settings/{types,defaults}.ts`

**Interfaces produites :**
- Store :
  - `upsertSubscription({ endpoint, vault, deviceId, p256dh, auth, label })`
  - `getSubscription(endpoint) → { endpoint, vault, deviceid, p256dh, auth, label, prefs } | null`
  - `listSubscriptions(vault)` renvoie aussi `deviceid, label, prefs, createdat, lastokat`
  - `setPrefs(endpoint, json)`
- Backend :
  - `deliver(sub, payload, topic, ttl = TTL_S) → { ok: boolean, status?: number }`
  - `POST /api/push/test { endpoint }` → `{ ok, status? }`
  - `GET /api/push/devices?vault=&endpoint=` → `{ devices: [{ label, createdAt, lastOkAt, mine, endpoint }] }`
- Client :
  - `currentEndpoint(): Promise<string>`
  - `sendTestPush(): Promise<void>`, qui lève une erreur lisible si FCM refuse
  - `listPushDevices(config): Promise<PushDevice[]>`
  - `removePushDevice(endpoint): Promise<void>`

- [ ] Ajouter les colonnes `label TEXT` et `prefs TEXT` à `push_subscription` (migration tolérante, après `SCHEMA`).
- [ ] Faire envoyer `label` par le client au subscribe. Le serveur le borne à 60 caractères : `deviceLabel()` déduit « Android · Chrome », « Windows · Edge », etc. de `navigator.userAgent`.
- [ ] Faire renvoyer le résultat à `deliver`. Ajouter les routes `test` (avant le garde de salon) et `devices` (après).
- [ ] Changer le log mail en `[push] mail → N abonnement(s), K nouveau(x), F fermé(s)` (K et F valent 0 tant que L3 n'est pas fait).
- [ ] Réglages : section « Appareils », avec le libellé, « cet appareil », la dernière livraison en relatif, « Tester » via `useActionFeedback` et le bouton icône « Retirer » sur les autres. Retirer « Persistance » et « Durée des toasts » (types, défauts, onglet) et l'ancien « Ajouter une notif test ». Renommer « Notifications OS ».
- [ ] Vérifier : `node --check apps/web/push-*.mjs`, `pnpm typecheck`, `pnpm lint`.

### Lot 2 : tri des mails

**Fichier :** `apps/web/push-backend.mjs`

**Interface produite :** `classifyMail(meta, watchedEmail) → "self" | "auto" | "person"`, une fonction pure au niveau du module. Ordre des règles : celui de la spec L2.

- [ ] Ajouter les en-têtes `List-Unsubscribe`, `Precedence` et `Auto-Submitted` à la requête de métadonnées, et `cls` à chaque item.
- [ ] Faire filtrer par abonnement dans `sendMail` : `people` → `person` seul, `all` → tout sauf `self`, `off` → rien. Avant L4, la préférence vaut `people`.
- [ ] Contrôle jetable : un script dans le scratchpad importe `classifyMail` (export nommé) et vérifie les 8 cas suivants. `node --check`.
  - SENT
  - même adresse
  - noreply
  - collègue avec `List-Id`
  - promo
  - `List-Unsubscribe`
  - `Auto-Submitted`
  - personne externe

### Lot 3 : notifs par fil, rangement, rien de perdu

**Fichiers :** `apps/web/push-backend.mjs`, `apps/web/public/sw.js`

**Interfaces produites :**
- Charge utile mail : `{ kind: "mail", email, historyId, badge, items: [{ messageId, threadId, from, subject, cls }], close: string[], silent: boolean }`
- SW :
  - `seenMail(ids) → Set` (lecture)
  - `markSeen(ids)` (FIFO, 200 au plus, clé kv `mailSeen`)

- [ ] `detailedMail` lit `history` avec `messageAdded` et `labelRemoved`, sans `labelId`. Il renvoie `{ added: Item[], closed: threadId[], badge }`.
- [ ] `recent` est une `Map` par adresse, avec `threadId → item & { at, notified: Set<endpoint> }`. Ses entrées vivent 6 h et sont retirées à la fermeture.
- [ ] `sendMail` construit la charge par abonnement : `items` = les 5 plus récents de `recent` qui passent le filtre ; `close` = les fils fermés que cet abonnement avait reçus. S'il n'y a ni nouveauté ni fermeture, rien ne part. Le TTL des mails est de 6 h.
- [ ] SW `notifyMail` :
  - une notif par fil (tag `mail:<threadId>`) ;
  - les items déjà vus sont sautés ;
  - le premier item nouveau a `renotify`, les autres sont `silent` ;
  - au-delà de 5 items, une notif `mail-more` ;
  - `close` referme les fils ;
  - sans rien de nouveau, notif silencieuse puis fermeture.
- [ ] Repli par jeton dans le SW : il passe au tag par fil.
- [ ] Vérifier : `node --check apps/web/public/sw.js apps/web/push-backend.mjs`.

### Lot 4 : réglages par appareil

**Fichiers :** `apps/web/push-backend.mjs`, `apps/web/src/lib/push/push-client.ts`, `apps/web/src/lib/push/PushScheduleRunner.tsx`, `NotificationsTab.tsx`, `settings/{types,defaults}.ts`

**Interfaces produites :**
- Serveur :
  - `DEFAULT_PREFS`
  - `parsePrefs(text) → Prefs` (repli sur les défauts)
  - `validPrefs(body) → Prefs | null`
  - `inQuiet(prefs, now) → boolean`
  - `PUT /api/push/prefs { endpoint, prefs }`
- Client :
  - `type PushDevicePrefs`
  - `settings.notifications.device: PushDevicePrefs`
  - `sendPushPrefs(prefs)`

- [ ] Côté serveur : `tick` saute les catégories coupées pour chaque abonnement (`followup` couvre `snooze`). `sendMail` lit `prefs.mail`. Les deux ajoutent `silent: true` pendant les heures calmes.
- [ ] Côté client, envoi des préférences :
  - à chaque changement de réglage ;
  - après `registerOnServer`.
  - Le fuseau vient de `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- [ ] SW : passer `silent` à `showNotification`.
- [ ] UI « Sur cet appareil » :
  - un `Select` pour les mails ;
  - 4 `Switch` (Rappels, Agenda, Habitudes, Relances) ;
  - un `Switch` pour les heures calmes, avec 2 champs d'heure ;
  - une colonne sur mobile.
- [ ] Vérifier : `pnpm typecheck`, `pnpm lint`.

### Lot 5 : agir depuis la notif

**Fichiers :** `push-backend.mjs`, `public/sw.js`, `PushScheduleRunner.tsx`, `apps/web/src/app/todos/page.tsx`, `public/icons/badge-96.png`

**Interfaces produites :**
- `POST /api/push/later { endpoint, key, title, body, url, joinUrl, delayMs }`, avec `delayMs` entre 60 000 et 86 400 000. La ligne créée a la catégorie `later` et l'appareil de l'abonnement ; `tick` la livre aux seuls abonnements de cet appareil.
- `POST /api/push/archive { endpoint, threadId }` → `{ ok, badge }`, avec 403 si le fil n'est pas dans `recent` pour une adresse liée au salon.

- [ ] Ajouter une `kind` aux lignes planifiées (dérivée de la catégorie, envoyée dans la charge) pour que le SW choisisse ses actions :
  - `reminder` : Fait, Dans 1 h
  - `habit` : Fait, Dans 1 h
  - `event` : Rejoindre (si lien), Dans 5 min
  - `followup` et `snooze` : Dans 3 h
  - `later` : selon la `kind` d'origine
  - mail : Archiver, Dans 3 h
- [ ] Rappel de todo : l'URL devient `/todos?edit=<id>&done=1`. `todos/page.tsx` coche le todo une seule fois après `replaceState` (sur le patron des habitudes), sans ouvrir l'éditeur.
- [ ] SW Archiver : d'abord `/api/push/archive`, puis le jeton, puis l'ouverture de la page.
- [ ] Finitions :
  - `badge: "/icons/badge-96.png"` (silhouette blanche sur fond transparent, générée depuis l'icône) ;
  - `timestamp` = `fireAt` ;
  - `vibrate: [80, 40, 80]` pour les mails de personnes.
- [ ] Vérifier : `node --check`, `pnpm typecheck`, `pnpm lint`. Le packaging se vérifie par `pnpm build:packages` seulement si un paquet est touché (aucun prévu).
