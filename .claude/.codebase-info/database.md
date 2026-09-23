# Stockage et schéma

*Last Updated: 2026-09-23*

Le coffre est un SQLite qui tourne **dans un Web Worker du navigateur**. Côté serveur, une base optionnelle porte l'op-log de la synchronisation en ligne, les abonnements push et le partage par lien (voir la dernière section).

## Moteur

`@sqlite.org/sqlite-wasm` 3.53, le build officiel, sur la VFS **OPFS SAH pool** (`installOpfsSAHPoolVfs`, pool nommé `supernote-vfs`, 12 slots initiaux). FTS5 est inclus dans ce build, ce qui est la raison du choix.

`apps/web/src/lib/vault-worker/sqlite-adapter.ts` expose une interface compatible sql.js (`exec`, `run`, `export`, `close`) pour éviter de réécrire les milliers d'appels existants. `sql.js` reste listé en dépendance mais n'est plus le moteur actif du worker.

⚠️ `optimizeDeps.exclude: ["@sqlite.org/sqlite-wasm"]` dans `apps/web/vite.config.ts` est obligatoire. Le pré-bundling de Vite réécrit l'URL du `.wasm` et casse le chargement. Ne retire jamais cette exclusion.

## Tables

Le DDL vit dans `apps/web/src/lib/vault-worker/db-schema.ts`. Il reproduit en SQL brut la migration Prisma de `packages/db/prisma/migrations/`, parce que Prisma ne tourne pas dans un navigateur.

| Groupe | Tables |
|---|---|
| Coffre | `vault`, `setting` |
| Modèle | `entity_type`, `entity`, `deleted_entity` |
| Relations | `relation_type`, `relation_edge`, `mention` |
| Étiquettes | `tag`, `entity_tag` |
| Bases et vues | `view`, `variable`, `template` (⚠️ jamais utilisée, voir ci-dessous) |
| Automatisations | `automation`, `automation_run` |
| Miroir courriel | `mail_thread`, `mail_message`, `mail_label`, `mail_sync_state`, `mail_outbox` |
| Miroir agenda | `cal_calendar`, `cal_event`, `cal_sync_state`, `cal_outbox` |
| Recherche | `entity_fts` (table virtuelle FTS5) |

## Le point structurant : les champs sont du JSON, pas des colonnes

C'est la décision de conception qui explique le plus de comportements surprenants.

| Colonne | Contenu |
|---|---|
| `entity_type.fields` | définitions de champs, JSON, défaut `'[]'` |
| `entity.fields` | valeurs de champs de l'entité, JSON, défaut `'{}'` |
| `view.filters`, `.sorts`, `.visibleFields`, `.summarize`, `.conditionalFormats` | JSON |
| `automation.trigger`, `.conditions`, `.actions` | JSON |
| `relation_edge.fields`, `template.defaultFields` | JSON |

Conséquence directe : le worker est un **pass-through**. Ajouter une propriété de champ ne demande aucune modification du worker, il sérialise ce qu'on lui donne. En revanche les adaptateurs écrits à la main de `components/schemas/adapters.ts` recopient une liste fixe de propriétés, et une clé qu'ils ignorent disparaît (zod ne s'exécute pas). Voir [patterns.md](patterns.md), c'est le piège le plus coûteux du dépôt.

## Miroir Google Agenda

Tables `cal_*`, locales à l'appareil comme le miroir mail (hors op-log). Routes dans un module à part, `lib/vault-worker/calendar-routes.ts`, branché par `buildCalendarRoutes` dans la map de `worker-router.ts` ; les helpers SQL partagés (`row`, `rows`, `runInTransaction`) vivent dans `lib/vault-worker/sql.ts`. `calendar.listEvents` rejoint `entity` pour renvoyer la note de réunion liée (`fields.gcalEventId`), seul lien qui voyage entre appareils. Une écriture en file (`cal_outbox`, id provisoire `local-…`) survit à une synchro complète ; son acquittement remplace l'id provisoire et rafraîchit l'etag des ops suivantes du même événement (sinon 412). `calendar.overlay` lit les todos datés et les champs `date` de toutes les bases. `cal_event.sourceRef` (migration `ALTER TABLE` dans `worker.ts`) recopie `extendedProperties.private.supernoteRef` : la référence de la tâche qu'un bloc planifie (voir [communication.md](communication.md)).

## Modèles de notes : des entités, pas la table `template`

Les modèles sont des entités du type système `template` (`TEMPLATE_TYPE_ID` dans `seed-default-types.ts`), rangées sous `Modèles/`, sur le même principe que `vault_mount`. Ils héritent ainsi du miroir `.md`, de la recherche et de la synchro cloud. Routes `templates.list`, `templates.save`, `templates.delete` dans `worker-router.ts`, `templates.seedDefaults` appelée par `worker.ts` avant `VAULT_READY`. Les deux modèles de départ ont des ids fixes et une date en 2000 pour que toute édition ou suppression gagne en LWW, et sont exclus du snapshot tant qu'ils sont intacts. La table SQL `template` n'est lue par rien.

## Migrations

Il n'existe **pas de système de migration versionné**. Toutes les évolutions de schéma sont des opérations idempotentes exécutées au démarrage du worker, dans `worker.ts`, et détectées par `PRAGMA table_info`.

Ce qui est fait ainsi aujourd'hui : recréation de `entity_fts` si sa forme a changé, réindexation complète de la table `mention` quand le réglage `system.mentions.indexVersion` diffère de la version du code (`worker-router.ts`, backlinks), recréation de `view` si `typeId` manque, ajout ciblé des colonnes `view.summarize`, `view.conditionalFormats` et `view.chartConfig`, ajout de `entity.sourceVaultId` pour la provenance des entités montées.

⚠️ C'est fragile dès que deux migrations touchent la même colonne : rien ne garantit leur ordre. `CREATE TABLE IF NOT EXISTS` n'ajoute jamais une colonne à une table existante, d'où les `ALTER TABLE` explicites.

## Recherche plein texte

Table virtuelle `entity_fts`, colonnes `id UNINDEXED, title, body, tags, path`, tokenizer `unicode61 remove_diacritics 2` pour que « lea » trouve « Léa ».

L'indexation est **câblée à la main**, sans trigger ni content-table : `worker-router.ts` appelle explicitement `ftsAdd()` et `ftsRemove()` à chaque création, modification et suppression d'entité. La raison est que `title`, `tags` et `path` sont dérivés, pas des colonnes physiques d'`entity`, donc un lien `content="entity"` ne suffirait pas.

Le classement utilise `bm25(entity_fts, 2.0, 1.0, 1.0, 1.5)` avec extraits via `snippet()`. Une requête vide retombe sur un tri `updatedAt DESC`, parce que `MATCH ''` est une erreur de syntaxe FTS5.

⚠️ `search.semantic` est un **stub qui renvoie toujours une liste vide**. La colonne `entity.embedding` existe dans le schéma, mais aucune recherche sémantique n'est opérationnelle.

## Persistance et mirroring

En mode dossier local, la base est aussi miroitée vers `.supernote/index.db` dans le coffre, ce qui la rend synchronisable par Git. Voir `db-persistence.ts` et `fsa-file-io.ts`.

⚠️ Le pool SAH est **global à l'origine du navigateur**, un seul `/index.db`, alors que les fichiers de salon cloud sont nommés par salon. Un marqueur `supernote-cloud/.supernote/db-owner.json` arbitre : si le propriétaire enregistré ne correspond pas au salon visé, le worker reçoit `resetStorage: true` et reconstruit l'index. Un changement de coffre interrompu peut donc laisser une base orpheline, que le démarrage suivant répare tout seul.

## Store du serveur de synchronisation

`apps/web/sync-store.mjs`, monté seulement si `DATABASE_URL` est défini : SQLite (`better-sqlite3`, URL `file:`) en dev, PostgreSQL en prod Scalingo. Trois tables par moteur : l'op-log (`op` / `sync_op`, dernière op par `(vault, entité)` conservée à la compaction), une table clé-valeur de méta (`meta` / `sync_meta`) et les pièces jointes des notes (`blob` / `sync_blob`, clé `(vault, path)`, créée au démarrage, jamais purgée).

La méta porte l'`epoch` et les **mots de passe de salon** sous la clé `pw:<nom>`, valeur `sel:hash` en hex (`scrypt`). `claimVaultPassword` insère sans écraser (`INSERT OR IGNORE` / `ON CONFLICT DO NOTHING`), ce qui arbitre deux revendications simultanées. Il n'y a pas de table des salons : un salon existe dès sa première op, et il est « protégé » dès qu'une clé `pw:` le nomme.

`apps/web/push-store.mjs`, même double moteur, ajoute `push_subscription` (clé `endpoint`, salon, appareil, clés de chiffrement) et `push_schedule` (échéances à venir par salon, catégorie, appareil, index unique `(vault, key, fireat)`, `sentat` posé à la réservation, lignes envoyées purgées au bout de 7 jours). Le texte des notifications, objets de mail compris, y est en clair jusqu'à la purge. `push_mail_watch` (`email`, `vault`, `updatedat`, clé `(email, vault)`) relie une adresse Gmail prouvée aux salons à prévenir, purgée après 8 jours sans renouvellement. Aucun jeton ni contenu de mail n'y est stocké.

`apps/web/share-store.mjs`, même double moteur (adaptateur SQL qui réécrit `?` en `$n` pour Postgres), porte le partage par lien : `share_resource` (note ou mail, hash de la clé propriétaire, titre, instantané du fil), `share_link` (slug, mode, hash de mot de passe et sa version, expiration, révocation douce), `collab_doc` (état Yjs d'une note, écrit par Hocuspocus), `share_blob` (images publiées) et `share_meta` (secret de signature quand `SHARE_SECRET` manque). L'ancienne table `share` (liens v1, HTML figé) est encore lue. Voir [sharing.md](sharing.md).

Voir aussi : [communication.md](communication.md), [architecture.md](architecture.md).
