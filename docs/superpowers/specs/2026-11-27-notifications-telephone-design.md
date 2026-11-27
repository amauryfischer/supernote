# Notifications téléphone — design

*2026-11-27 · statut : à relire*

## Intention

Le téléphone (PWA Supernote sur Android, Chrome) ne vibre que pour ce qui compte et au bon moment. Chaque notification se traite depuis l'écran verrouillé, ou disparaît seule quand elle est réglée ailleurs. Amaury a confié le quoi et le comment (« va bien plus loin, à toi de voir ») : tout ce qui suit est une proposition, à corriger.

## Ce que disent les données (prod, 2026-09-22 → 2026-11-27)

- **~11 300 push envoyés, dont 92 % de mails** (150 à 290 par jour), ~20 rappels d'habitudes par jour, ~7 événements par jour, 3 reports. **Aucun** rappel de todo ni relance « pas de réponse » envoyé en deux mois.
- **2 abonnements, tous les deux FCM** (Chrome Android et Chrome bureau, probablement), aucun iPhone.
- **Échantillon du 26/11** : sur 19 fils encore en boîte, 3 viennent d'une personne, 3 sont des notes envoyées à soi-même, 13 sont automatiques (réseaux sociaux, transport, banque, outils).
- Les mails détaillés passent par le refresh token serveur (log « (détaillé) ») : c'est le serveur qui lit l'expéditeur et l'objet.

## Défauts constatés dans le code

1. **Un mail en écrase un autre en silence.** Tout mail porte le tag `mail-new` sans `renotify`. Un 2ᵉ mail remplace la notif du 1ᵉʳ sans vibrer, et le 1ᵉʳ disparaît du volet (`public/sw.js`, `notifyMail`).
2. **Des mails perdus.** Le TTL est de 15 min et le topic est unique par adresse, alors que `lasthistoryid` avance à chaque lecture. Un téléphone hors réseau plus de 15 min, ou un push remplacé par le suivant, perd ces mails pour de bon (`push-backend.mjs`, `deliver`, `detailedMail`).
3. **Le téléphone se réveille pour rien.** Chaque lecture ou archivage, sur n'importe quel appareil, envoie un push vide. Le SW affiche alors une notif silencieuse puis la ferme aussitôt.
4. **Le vrai envoi n'est pas testable.** Le bouton de test ne remplit que le tiroir in-app. Rien ne vérifie la chaîne serveur → FCM → téléphone, et la réception sur un vrai téléphone n'a jamais été validée.
5. **Des réglages morts ou confus.** « Persistance » et « Durée des toasts » ne sont lus nulle part. « Notifications OS » (app ouverte) côtoie « Notifications app fermée » sans explication.
6. **Pas d'icône de barre d'état.** Sans icône `badge` monochrome, Android affiche une icône générique.

## Objectifs (5 lots, chacun vérifiable sur le téléphone en 2 min)

| Lot | Résultat visible | Estim. |
|---|---|---|
| L1 Banc d'essai | « Tester sur cet appareil » envoie un vrai push ; liste des appareils du salon avec leur dernière livraison réussie | ~1 h 30 |
| L2 Mails de personnes | le téléphone ne vibre plus pour les mails automatiques ni pour les notes à soi | ~2 h |
| L3 Mails propres | une notif par fil, refermée seule quand le fil est lu ou archivé ailleurs, aucun mail perdu hors réseau, plus de réveils vides | ~3 h |
| L4 Réglages par appareil | par appareil : mails (personnes / tous / aucun), choix par catégorie, heures calmes où rien ne vibre | ~3 h |
| L5 Agir depuis la notif | « Plus tard » sur chaque notif, « Archiver » sans déverrouiller, « Fait » sur les rappels de todo, icône de barre d'état, heure de l'échéance | ~3 h 45 |

Ordre imposé : L1 d'abord (sert à vérifier tous les autres), L2 avant L3 (même fonction serveur), L4 avant L5 (L5 lit les préférences).

## Non-objectifs (plus tard, ou jamais)

- **Résumé du matin** : le texte serait calculé par l'appareil la veille, donc figé et parfois faux à l'envoi. À reprendre si besoin, avec un calcul au plus près de l'heure.
- **Bureau actif → téléphone muet** : il faudrait un signal de présence permanent. Plus tard.
- **Liste VIP ou contacts prioritaires** : le tri L2 couvre l'essentiel. Une VIP reste possible plus tard.
- **Délai d'événement réglable** : l'appareil calcule `fireAt` et l'index unique est `(vault, key, fireat)`, donc deux délais différents produiraient des doublons sur tous les appareils. On reste à 15 min.
- **Centre de notifications in-app** : hors sujet ici, c'est un chantier séparé.
- **Tri des mails sans autorisation serveur** (repli par jeton dans le SW) : comportement inchangé, hormis le tag par fil. La prod passe par le serveur.
- **`pushsubscriptionchange`** : Chrome ne l'émet pas en pratique, et le réabonnement à chaque ouverture de l'app (`ensurePushSubscription`) suffit.
- iPhone : aucun abonnement Apple aujourd'hui. On ne casse rien pour iOS, mais on n'optimise pas pour lui.

## Anti-objectifs (échec même si « ça marche »)

- Un mail d'une **personne** n'est jamais notifié. Le tri doit rater par excès de notif, jamais par défaut.
- Une notif fantôme réapparaît après avoir été balayée.
- Le téléphone vibre plusieurs fois d'affilée en reprenant le réseau.
- Un toast (règle du projet : le retour passe par le bouton, via `lib/action-feedback.tsx`).
- Des appareils existants passent sous silence à cause d'une préférence absente. L'absence de préférence vaut les défauts.

## Contraintes

- **Le SW affiche toujours une notif par push** (Safari révoque sinon, et Chrome affiche « site mis à jour en arrière-plan »). Il ne peut donc pas filtrer : ce qui ne doit pas sonner ne doit pas partir.
- **`computeSchedule` ne doit jamais filtrer une catégorie.** Une liste vide envoyée par un appareil efface celle de tout le salon (catégories partagées).
- **Colonnes ajoutées sur les deux moteurs** (SQLite et Postgres) avec le même SQL. SQLite n'a pas de `ADD COLUMN IF NOT EXISTS` : on tente l'`ALTER`, on ignore l'erreur « duplicate column ».
- **`sw.js` n'est pas bundlé** : pas d'import partagé avec le serveur. La logique de tri reste côté serveur.
- **Déployer serveur et client ensemble.** Un vieux SW ignore les champs nouveaux sans casser, et un vieux serveur ignore les routes nouvelles.
- **Politique zéro test** : vérification par `pnpm build:packages`, `pnpm typecheck`, `pnpm lint`, et le bouton L1 sur le vrai téléphone. Aucun fichier de test.
- HeroUI v3 via `@supernote/ui`, boutons icône avec Tooltip et `aria-label`, mobile traité dans le même mouvement.

## Approches considérées

- **A. Le serveur décide, abonnement par abonnement** (retenue). Préférences et fuseau sont stockés sur `push_subscription`. Le serveur trie les mails là où il les lit déjà (`detailedMail`) et construit une charge utile par abonnement. Le SW affiche et exécute les actions. Avantages : fonctionne app fermée, respecte « toujours afficher », et toute la logique tient en un seul endroit. Coûts : une migration de colonnes, et le repli sans autorisation serveur n'est pas trié.
- **B. Le SW filtre.** Rejetée : chaque push filtré réveille quand même le téléphone et doit afficher quelque chose. Le SW ne peut ni retenir ni regrouper de façon fiable.
- **C. L'appareil qui planifie filtre** (`computeSchedule`). Rejetée : les listes partagées sont propres au salon, pas à l'appareil, une liste vide efface celle des autres, et les mails viennent du serveur, pas de l'appareil.

## Design par lot

### L1 — Banc d'essai et santé des appareils

- **Migration `push_subscription`** : ajouter `label TEXT` (nom lisible tiré du user-agent à l'abonnement, par exemple « Android · Chrome ») et `prefs TEXT` (JSON, utilisé à partir de L4). Les deux colonnes sont posées dès L1 pour n'avoir qu'une migration.
- **`POST /api/push/test`** `{ endpoint }`. L'endpoint fait foi, comme pour `unsubscribe`. Le serveur pousse vers ce seul abonnement `{ title: "Test Supernote", body: "Envoyé à HH:MM", tag: "test" }` et répond avec le statut réel de FCM (`ok`, ou le code d'erreur).
- **`GET /api/push/devices?vault=`** (`vaultAuthed` + `vaultProtected`) : liste `label`, `createdat`, `lastokat`, et `mine` (vrai si l'endpoint correspond à celui de l'appelant, passé en paramètre).
- **Retirer un appareil** : la route `unsubscribe` existe déjà.
- **Mesure** : le log mail devient `[push] mail → N abonnement(s), K nouveau(x), F fermé(s)`, pour mesurer l'effet de L2 et L3.
- **Réglages → Notifications** : la section « Appareils » liste les appareils du salon (« cet appareil » en tête), avec la dernière livraison en relatif (« il y a 3 h »), un bouton « Tester » sur cet appareil (chargement, coche ou ⚠ via `useActionFeedback`) et un bouton icône « Retirer » sur les autres.
- **Nettoyage** : retirer « Persistance » et « Durée des toasts » (réglages et types), et renommer « Notifications OS » en « Notifications quand Supernote est ouvert ».

### L2 — Les mails qui sonnent sont ceux des personnes

Dans `detailedMail`, la requête de métadonnées demande en plus les en-têtes `List-Unsubscribe`, `Precedence` et `Auto-Submitted` (les `labelIds` sont déjà renvoyés). **Aucun appel Gmail supplémentaire par message** (le quota a déjà cassé une fois, le 2026-11-19). Chaque nouveau message reçoit une classe, évaluée dans cet ordre (la première règle qui s'applique gagne) :

1. `self` : `labelIds` contient `SENT`, ou l'adresse `From` est l'adresse surveillée.
2. `auto` si la partie locale de `From` correspond à un motif de non-réponse (`no-?reply`, `ne-?pas-?repondre`, `mailer-daemon`), ou si `Auto-Submitted` est présent et différent de `no`.
3. `person` si `From` est du même domaine que l'adresse surveillée (les collègues, y compris quand ils écrivent via un groupe Google).
4. `auto` si `labelIds` contient `CATEGORY_PROMOTIONS`, `CATEGORY_SOCIAL` ou `CATEGORY_UPDATES`, ou si `List-Unsubscribe` est présent, ou si `Precedence` vaut `bulk` ou `junk`. `CATEGORY_UPDATES` est ajouté après vérification sur la vraie boîte : la banque, Google Agenda et la SNCF n'ont ni motif de non-réponse ni en-tête de liste, mais Gmail les classe en Updates. Les collègues restent protégés par la règle 3.
5. `person` : tout le reste. `List-Id` seul et `CATEGORY_FORUMS` ne suffisent **pas** à faire taire un mail.

Vérifié le 2026-11-27 : l'adresse surveillée est `amaury.fischer@numerisk.fr`, la boîte Gmail personnelle y est transférée, et les notes à soi portent `SENT` + `INBOX`. Le log mail compte les classes reçues (`[reçus : P personne(s), A auto, S soi]`) pour mesurer le tri en prod.

Les items portent `cls`. Le filtre appliqué par abonnement vient de la préférence `mail` (L4) ; défaut `people` = `person` seulement. **Avant L4**, tous les abonnements sont en `people`.

Risque connu : une personne extérieure qui écrit depuis un outil d'envoi en masse (avec `List-Unsubscribe`) est classée `auto`. C'est accepté. Le mail reste dans la boîte et le badge le compte.

### L3 — Une notif par fil, qui se range seule, sans perte

- **Lecture de l'historique** : `history.list` avec `historyTypes=messageAdded` **et** `labelRemoved`, sans filtre `labelId`, puis filtrage côté serveur. Les ajouts gardés sont ceux qui portent `INBOX`. Un retrait d'`INBOX` ou d'`UNREAD` ajoute le fil à `close`.
- **État récent par adresse, en mémoire** : `threadId → { messageId, from, subject, cls, at }` pour les mails notifiables des 6 dernières heures, retirés dès que le fil part dans `close`. Il est perdu au redémarrage, ce qui est accepté (on perd seulement le rattrapage).
- **Charge utile mail = état courant** :
  - `recent` : les 5 plus récents notifiables pour cet abonnement, chacun avec son `messageId` ;
  - `items` : les seuls nouveaux de ce push. Un SW d'avant la refonte ne lit que ce champ et n'affiche donc pas de fausse alerte pendant sa mise à jour ;
  - `close` (20 au plus), `badge` et `silent`.
  
  Le topic reste unique par adresse, et le **TTL des mails passe à 6 h** : un push remplacé par le suivant ne perd plus rien, puisque chaque push porte l'état entier.
- **Pas de push** quand un abonnement n'a ni nouvel item, ni `close`. C'est la fin des réveils vides.
- **`close` ne vise que les fils notifiés à cet abonnement** (présents dans l'état récent et passés par son filtre). Un push qui ne porte que `close` reste un push. Le SW garde alors l'astuce actuelle : notif silencieuse ouverte puis refermée, puisque Chrome en exige une par push. Ce réveil discret n'a lieu qu'une fois par mail notifié puis réglé ailleurs, soit quelques fois par jour au lieu de 150 à 290.
- **Un seul conteneur** (`web-1`, vérifié le 2026-11-27) : l'état en mémoire est cohérent. Si un jour il y a plusieurs conteneurs, l'état et la coalescence existante devront passer en base.
- **SW** :
  - Une notif par fil, tag `mail:<threadId>`.
  - Il retient en IndexedDB `supernote-sw` les `messageId` déjà montrés (200 au plus, les plus anciens sortent en premier). Un item déjà montré n'est jamais réaffiché, même balayé.
  - Dans un même push, seule la première notif nouvelle vibre (`renotify: true`) ; les suivantes sont `silent`. Le téléphone qui reprend le réseau vibre donc une seule fois.
  - `close` ferme les notifs `mail:<threadId>` affichées.
  - Pas de notif de synthèse : le serveur n'envoie jamais plus de 5 items.
- **Repli par jeton dans le SW** (sans autorisation serveur) : il passe au tag par fil, sans tri ni `close`.

### L4 — Réglages par appareil

- **`prefs`** (JSON sur l'abonnement) :
  ```json
  { "mail": "people|all|off", "reminder": true, "event": true, "habit": true, "followup": true,
    "quiet": { "on": true, "start": "22:00", "end": "07:30" }, "tz": "Europe/Paris" }
  ```
  `followup` couvre les catégories `followup` et `snooze`. Les défauts sont ceux affichés, et une préférence absente ou illisible vaut ces défauts.
- **`PUT /api/push/prefs`** `{ endpoint, prefs }` : l'endpoint fait foi, et le serveur valide la forme (énumérations, `HH:MM`, fuseau accepté par `Intl.DateTimeFormat`). L'appareil l'envoie à chaque changement et à chaque enregistrement de l'abonnement (`registerOnServer`, donc à chaque ouverture de l'app). La copie locale vit dans `localStorage` (`supernote.push.devicePrefs`, géré par `push-client.ts`), hors des réglages généraux.
- Sans lecture serveur (repli par jeton), l'appareil en `mail: "off"` n'est plus prévenu et les heures calmes s'appliquent aussi.
- **Envoi** (`tick` et `sendMail`) : catégorie coupée → rien ne part vers cet abonnement. Si l'heure locale tombe dans les heures calmes (calculée avec `tz`), la charge porte `silent: true` : la notif arrive dans le volet sans son ni vibration. Rien n'est retenu ni rejoué.
- **UI** : section « Sur cet appareil », au-dessus de « Appareils ». Un `Select` pour les mails (Personnes · Tous · Aucun), des `Switch` pour Rappels, Agenda, Habitudes et Relances, un `Switch` pour les heures calmes avec deux champs d'heure. Sur mobile, une colonne, cibles de 32 px ou plus.

### L5 — Agir depuis la notif, et finitions Android

Android affiche **2 actions au plus**. Répartition proposée :

| Notif | Action 1 | Action 2 |
|---|---|---|
| Mail d'une personne | Archiver | Dans 3 h |
| Rappel de todo | Fait | Dans 1 h |
| Habitude | Fait | Dans 1 h |
| Événement | Rejoindre (si lien de visio) | Dans 5 min |
| Relance / retour de report | Dans 3 h | — |

- **« Dans X »** : le SW envoie `POST /api/push/later` `{ endpoint, key, title, body, url, joinUrl, delayMs }`. L'endpoint fait foi, et `delayMs` est borné à 1 min..24 h. Le serveur insère une ligne de catégorie `later`, pour le seul appareil de cet abonnement, avec la clé `later:<clé d'origine>`. `later` ne fait pas partie des catégories que les appareils remplacent : rien ne l'écrase. Pour un mail, c'est la même notif qui revient, sans toucher Gmail.
- **« Fait » sur un rappel de todo** : même patron que les habitudes. L'URL devient `/todos?edit=<id>&done=1`, la page fait `replaceState` puis coche le todo, et ne fait rien s'il est déjà coché.
- **« Archiver » sans déverrouiller** : le SW appelle d'abord `POST /api/push/archive` `{ endpoint, threadId }`. Le serveur archive le fil avec le refresh token déjà en place, à trois conditions : l'endpoint correspond à un abonnement, le fil figure dans l'état récent d'une adresse liée à ce salon (`push_mail_watch`), et il a été notifié dans les 6 dernières heures. Le serveur n'archive donc que ce qu'il a lui-même notifié. En cas de refus ou d'échec (y compris un scope insuffisant), on reprend le chemin existant : jeton du SW, puis `/mail?thread=…&action=archive`. Le badge renvoyé met à jour l'icône.
- **Finitions** :
  - icône `badge` monochrome 96×96 (`public/icons/badge-96.png`) ;
  - `timestamp` égal à l'échéance pour les catégories planifiées ;
  - vibration courte distincte pour les mails de personnes.
- Le lien « Lu » disparaît des notifs de mail, faute de place. Choix de Claude, réversible.

## Laissé au constructeur

- La forme exacte de la migration (tenter l'`ALTER` puis ignorer l'erreur, ou lire `PRAGMA table_info` et `information_schema`), à condition d'utiliser le même chemin pour les deux moteurs.
- Le libellé d'appareil tiré du user-agent.
- Le dessin de l'icône `badge`, une silhouette de la marque.
- Le motif de vibration.
- Le découpage en commits à l'intérieur d'un lot.

## Choix faits par Claude (à vérifier en relisant)

1. Les mails automatiques et les notes à soi ne sonnent plus, **par défaut**, sur tous les appareils existants.
2. Heures calmes actives par défaut, de 22 h à 7 h 30 : silence, sans retenue.
3. « Lu » est remplacé par « Dans 3 h » sur les mails.
4. Délai avant un événement fixé à 15 min, et pas de résumé du matin.
5. Téléphone supposé Android : tous les abonnements sont FCM.
6. Les collègues du même domaine sonnent toujours, même via une liste ; `List-Id` seul ne fait pas taire un mail.
7. Un mail lu ou archivé ailleurs referme sa notif au prix d'un réveil discret, plutôt que d'attendre le mail suivant.
8. « Archiver » passe par le serveur, autorisé par l'endpoint mais limité aux fils que ce serveur a notifiés au salon depuis moins de 6 h (L5 passe à ~3 h 45).
