# Synchronisation en ligne (temps réel)

Troisième option de persistance, **en alternative à Git et au dossier
physique**. Quand le serveur dispose d'une base de données, Supernote réplique
le coffre entre tous les appareils (web et PWA Android) en temps réel.

## Principe

L'unité de réplication est un **journal d'opérations d'entités** (op-log) :

- chaque création / modification / suppression locale devient une `EntityOp`
  (`upsert` ou `delete`) ;
- le worker du coffre émet un message `ENTITY_CHANGE` vers le thread principal ;
- le client en ligne (`apps/web/src/lib/online-sync/`) pousse l'op au serveur ;
- le serveur lui attribue un numéro de séquence monotone et le diffuse à tous
  les appareils connectés ;
- chaque appareil applique les ops des autres via la procédure worker
  `sync.applyOps` (qui **n'émet pas** `ENTITY_CHANGE`, donc pas de boucle).

Politique de conflit : **dernier écrivain gagne** par entité (clé `ts`, départage
par `opId`). Adapté au cas réel « j'édite sur mon téléphone puis sur mon
portable ».

## Transport

- **SSE** en descendant : `GET /api/sync/stream?vault=&since=&clientId=`.
- **POST** en montant : `POST /api/sync/push`.
- Repli sans SSE : `GET /api/sync/pull?vault=&since=`.
- Détection : `GET /api/sync/info` → `{ enabled, requiresToken, epoch }`.

Aucune dépendance supplémentaire côté transport (ni WebSocket ni lib externe) :
SSE + `fetch` traversent les proxys (dont Scalingo) et fonctionnent à l'identique
sur navigateur de bureau et PWA installée sur Android.

## Activation côté serveur

Le backend de sync (`apps/web/sync-backend.mjs`) n'est monté **que si**
`DATABASE_URL` est défini — sinon le serveur statique reste strictement
inchangé (zéro nouvelle surface).

| Variable        | Rôle                                                                       |
| --------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`  | Active la sync. `postgres://…` → op-log PostgreSQL ; `file:…` → SQLite.    |
| `SYNC_DB_PATH`  | Chemin du fichier SQLite op-log (sinon dérivé de `DATABASE_URL`).          |
| `SYNC_TOKEN`    | Secret partagé optionnel exigé sur chaque requête.                         |

Deux moteurs de stockage (`apps/web/sync-store.mjs`), même interface :

- **PostgreSQL** (`postgres://`) — **le choix durable sur PaaS** : sur Scalingo,
  ajoutez l'addon PostgreSQL et la variable `DATABASE_URL` est fournie ;
  l'op-log (et l'epoch) survivent aux redéploiements.
- **SQLite** (`file:` ou `SYNC_DB_PATH`) — pour l'auto-hébergement sur disque
  persistant. Sur un disque éphémère, l'op-log meurt à chaque déploiement et
  seul le mécanisme d'epoch (ci-dessous) garantit la reconvergence.

### Epoch — résilience au reset du serveur

Le serveur frappe un **epoch** (id aléatoire, table `meta`) à la création de sa
base op-log et l'expose dans `/info` et le `hello` SSE. Les clients le stockent
avec leur curseur : si l'epoch change (op-log effacé — redéploiement sur disque
éphémère, reset manuel), le client **remet son curseur à zéro et re-seed son
coffre complet**. Sans ça, un reset serveur désynchroniserait silencieusement
tous les appareils pour toujours (curseur au-delà du nouveau head). Le coffre
étant local-first, la perte de l'op-log serveur est ainsi auto-réparée au
premier appareil reconnecté.

### Compaction de l'op-log

Avec un LWW par entité, seule la **dernière** op de chaque `(vault, entityId)`
compte pour la convergence. Au démarrage puis toutes les 6 h, le serveur purge
les ops supplantées vieilles de plus de 7 jours : le journal (et le replay
initial d'un nouvel appareil) reste borné, sans changer l'état final reconstruit.

### Journal durable côté client

Les ops locales non encore acquittées sont journalisées dans `localStorage`
(`supernote.onlineSync.pending.<salon>`) **avant** le debounce d'envoi : un
onglet fermé (ou tué) juste après une édition ne perd plus l'op — la session
suivante la re-pousse (le serveur déduplique par `opId`). Le flush de
fermeture utilise `fetch keepalive`. En cas de dépassement du budget du journal
(~2 Mo / 500 ops), il est abandonné et un **re-seed complet** est programmé au
prochain connect — sur-pousser est inoffensif, sous-pousser perd des données.

En développement, le même backend est monté sur le serveur Vite via un plugin
(`onlineSyncDevServer` dans `apps/web/vite.config.ts`) dès que `DATABASE_URL`
est présent — `pnpm dev` exerce donc la fonctionnalité de bout en bout.

## Activation côté utilisateur

Paramètres → **Synchronisation** → « Synchronisation en ligne (temps réel) » :

- **Serveur** : vide = même origine que l'application.
- **Clé de salon** : même clé sur tous les appareils à apparier.
- **Jeton** : requis seulement si le serveur définit `SYNC_TOKEN`.

La configuration est stockée dans `localStorage`
(`supernote.onlineSync.config`) ; un identifiant d'appareil stable
(`supernote.onlineSync.clientId`) permet d'ignorer l'écho de ses propres ops.

## Limites connues (MVP)

- Les fichiers binaires (pièces jointes) et les `.excalidraw` frères ne sont pas
  transportés ; seules les notes Markdown et les métadonnées d'entités le sont.
- Les ops appliquées à distance ne déclenchent pas le moteur d'automatisations
  local (pas de hooks, pour éviter les boucles d'écho).
- Pas de fusion CRDT : conflit résolu en dernier-écrivain-gagne par entité.
