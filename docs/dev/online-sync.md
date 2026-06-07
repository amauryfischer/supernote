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
- Détection : `GET /api/sync/info` → `{ enabled, requiresToken }`.

Aucune dépendance supplémentaire côté transport (ni WebSocket ni lib externe) :
SSE + `fetch` traversent les proxys (dont Scalingo) et fonctionnent à l'identique
sur navigateur de bureau et PWA installée sur Android.

## Activation côté serveur

Le backend de sync (`apps/web/sync-backend.mjs`) n'est monté **que si**
`DATABASE_URL` est défini — sinon le serveur statique reste strictement
inchangé (zéro nouvelle surface).

| Variable        | Rôle                                                                 |
| --------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`  | Active la sync. Une URL `file:` est utilisée directement.           |
| `SYNC_DB_PATH`  | Chemin du fichier SQLite op-log (sinon dérivé de `DATABASE_URL`).   |
| `SYNC_TOKEN`    | Secret partagé optionnel exigé sur chaque requête.                  |

> Sur un hébergement à disque éphémère (Scalingo), pointez `SYNC_DB_PATH` vers
> un volume persistant pour conserver l'op-log entre déploiements.

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
