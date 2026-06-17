# Import Coda → Supernote (bases distantes readonly)

**Date** : 2026-06-17
**Statut** : design validé (cadrage), prêt pour plan d'implémentation

## Objectif

Connecter Supernote à des bases distantes (Coda v1) et en produire une copie
locale « Supernote » **en lecture seule**. L'utilisateur parcourt ses docs/tables
Coda, choisit lesquelles importer, et obtient des bases Supernote
(`EntityType` + `Entity`) qui reproduisent la structure, les données **et les
relations** entre les tables importées. Re-synchronisable manuellement.

Hors scope v1 : écriture vers Coda (write-back), sync automatique périodique,
autres providers (Notion, Airtable…).

## Décisions (cadrage)

1. **Accès** : proxy côté serveur. Le token vit dans `CODA_API_TOKEN` (env
   serveur `apps/web`), jamais exposé au navigateur. Nouveau module
   `apps/web/coda-backend.mjs` monté dans `server.mjs` (comme `sync-backend.mjs`,
   activé seulement si `CODA_API_TOKEN` présent). Résout CORS + secret.
   Conséquence : nécessite le backend Node (Scalingo / `node server.mjs` local),
   indisponible en SPA pure / `file://`.
2. **Rafraîchissement** : miroir re-synchronisable. Chaque base importée garde un
   *binding* Coda. Bouton « Rafraîchir » → re-pull, upsert par `rowId` Coda,
   suppression des rows disparues. Manuel en v1.
3. **Relations** : reconstruites. Une colonne Coda lookup/relation dont la table
   cible est **dans la sélection d'import** devient un `RelationField` Supernote
   pointant vers la base importée. Cible hors sélection → aplatie en texte
   (valeur d'affichage Coda).

## Architecture

```
Navigateur (SPA)                          Serveur apps/web (server.mjs)
─────────────────                          ─────────────────────────────
CodaTab (Settings) ──┐                     coda-backend.mjs  (si CODA_API_TOKEN)
Browse/Select UI ────┼─ fetch /api/coda/* ──► GET /docs
Import orchestrator ─┘   (same-origin)        GET /docs/:doc/tables
   │                                          GET /docs/:doc/tables/:t/columns
   │ schemas.create / entities.create/update  GET /docs/:doc/tables/:t/rows
   ▼                                              │ Bearer CODA_API_TOKEN
Vault worker (sql.js)                              ▼  https://coda.io/apis/v1
   entity_type / entity                          Coda
   + supernote.coda.bindings (localStorage)
```

### 1. Proxy serveur — `apps/web/coda-backend.mjs`

Pattern calqué sur `sync-backend.mjs` (handler `(req,res,url)`, monté dans
`server.mjs`, CORS same-origin suffit). Routes proxy (réécriture 1:1 vers
`https://coda.io/apis/v1`, injecte `Authorization: Bearer ${CODA_API_TOKEN}`) :

| Route Supernote | Coda |
|---|---|
| `GET /api/coda/docs?limit&pageToken` | `GET /docs` |
| `GET /api/coda/docs/:docId/tables` | `GET /docs/{docId}/tables` |
| `GET /api/coda/docs/:docId/tables/:tableId/columns` | `.../columns` |
| `GET /api/coda/docs/:docId/tables/:tableId/rows?valueFormat=rich&limit&pageToken` | `.../rows` |

- Token jamais renvoyé au client. `GET /api/coda/status` → `{ enabled: !!token }`
  (l'UI sait si le connecteur est dispo).
- **Throttle** : respecter les limites Coda (lecture 100/6s, list docs 4/6s).
  File d'attente simple côté backend (token-bucket) ; sur 429, relai du
  `Retry-After`. La pagination est faite **côté client** (le client suit
  `nextPageToken`), le throttle backend lisse le débit.
- Activation : dans `server.mjs`, `if (process.env.CODA_API_TOKEN) { mount coda-backend }`.

### 2. Client Coda — `apps/web/src/lib/coda/`

- `client.ts` : `listDocs()`, `listTables(docId)`, `listColumns(docId,tableId)`,
  `listRows(docId,tableId)` (suit `nextPageToken` jusqu'au bout, `valueFormat=rich`).
  Tous via `/api/coda/*` (même origine). Erreurs → `Result` (`ok`/`err`), pas de throw.
- `types.ts` : types des réponses Coda (Doc, Table, Column avec `format.type`,
  Row avec `values: Record<columnId, richValue>`).
- `mapping.ts` (pur, testé vitest) :
  - `codaTypeToFieldKind(format)` → `FieldKind`. Table de correspondance :

    | Coda `format.type` | FieldKind |
    |---|---|
    | text, canvas (texte) | text / longtext |
    | number, slider, scale | number |
    | percent | percent |
    | currency | currency (+ `currencyCode`) |
    | date | date |
    | dateTime | datetime |
    | time, duration | duration |
    | checkbox | bool |
    | select | select (options dérivées des valeurs distinctes) |
    | email | email · link → url · image/attachments → image/file |
    | person | text (nom) |
    | lookup/relation (cible importée) | relation |
    | lookup/relation (cible hors sélection) | text (display value) |
    | button, reaction, formules non résolues | ignoré ou text |

  - `codaCellToFieldValue(richValue, kind)` → `FieldValue`. Pour les
    JSON-LD `StructuredValue` (relation/person/image) : extraire `name`/`url` et,
    pour relation, le `rowId`. Multi-valeur = array.
  - `extractRelationRefs(richValue)` → `{ tableId, rowId }[]` (pour la passe 2).

### 3. Orchestrateur d'import — `apps/web/src/lib/coda/import.ts`

Entrée : liste de tables sélectionnées `[{ docId, docName, tableId, tableName }]`.

**Passe 0 — métadonnées** : pour chaque table, `listColumns`. Construire le
mapping colonnes→fields. Pour chaque colonne lookup/relation, lire la table cible
(`format.table.id`) ; marquer `relation` si la cible ∈ sélection, sinon `text`.

**Passe 1 — schémas + lignes** :
- `schemas.create` par table → `EntityType` (fields = colonnes mappées, dont les
  `RelationField {kind:"relation", targetTypeId:<baseId cible>, cardinality}`).
  Cardinalité : colonne Coda multi → `many_to_many`, sinon `one_to_one`
  (par défaut `many_to_many` si indéterminé — le stockage array gère les deux).
  Conserver un champ technique `_codaRowId` (kind text, caché) par base.
- `listRows` (rich, paginé, throttlé). Par row : `entities.create` avec les
  valeurs scalaires/texte + `_codaRowId = row.id`. **Ne pas** encore remplir les
  champs relation. Construire la map globale `codaRowId → { entityId, typeId }`.

**Passe 2 — câblage des relations** :
- Pour chaque entité ayant des colonnes relation, résoudre les `rowId` Coda
  (via `extractRelationRefs`) → `entityId` Supernote dans la map. Inconnus
  (target non importée) ignorés (déjà aplatis en texte en passe 1).
- `entities.update` pour poser `fields[relFieldId]` = id (one_to_one) ou
  `string[]` (many). (id auto-généré par le worker → pas de pré-allocation,
  d'où les 2 passes.)

**Progression** : émettre un événement de progrès (réutiliser le bus
`supernote:index-progress` ou un `CustomEvent` dédié) pour la barre d'import.

### 4. Bindings + readonly — `apps/web/src/lib/coda/bindings.ts`

- `localStorage["supernote.coda.bindings"]` = `Record<entityTypeId, CodaBinding>` :
  `{ docId, docName, tableId, tableName, columnMap, importedAt, lastRefreshedAt }`.
  `columnMap` = `Record<codaColumnId, { fieldId, kind, targetTableId? }>` (rejoue
  le mapping au refresh, stable).
- **Readonly** : pas de flag natif (cf. mounts = invariant applicatif). L'UI des
  bases consulte `getCodaBinding(baseId)` → si présent, base **readonly** :
  désactiver l'édition de cellules, masquer « + ligne »/« + colonne »/suppression,
  bandeau « Source : Coda · <table> · Rafraîchir ». Hook `useCodaReadonly(baseId)`.
- **Refresh** : `refreshBinding(baseId)` = re-pull rows → upsert par `_codaRowId`
  (update si existe, create sinon), supprimer les entités dont le `_codaRowId`
  n'est plus chez Coda, re-câbler relations (passe 2). Le schéma (colonnes) n'est
  pas re-négocié en v1 (si Coda change la structure → ré-import recommandé ;
  noter cette limite).

### 5. UI (desktop + mobile, règle CLAUDE.md)

- **`CodaTab`** dans Settings : statut connecteur (`/api/coda/status`), si absent
  → message « définir `CODA_API_TOKEN` côté serveur ». Bouton « Importer depuis
  Coda » → ouvre le flow de sélection.
- **Sélecteur d'import** (modal / page) : liste docs → expand tables (cases à
  cocher), bouton « Importer (n) ». Barre de progression pendant l'import.
  Mobile : pleine page via `useMobileTitle`, FAB/action publiée ;
  pas de débordement horizontal, hit-targets ≥32px.
- **Bandeau readonly** sur les bases Coda + bouton « Rafraîchir » (desktop dans
  l'entête de base, mobile dans le `MoreDrawer`/header actions).
- Composants HeroUI v3 (`Modal`, `Checkbox`, `Button`, `Chip`, `Progress`,
  `Accordion` pour docs→tables).

## Découpage en lots (un plan par lot)

1. **Backend + client + mapping** : `coda-backend.mjs` + montage `server.mjs`,
   `lib/coda/{client,types,mapping}.ts`, tests vitest du mapping. Vérifiable :
   lister docs/tables/columns/rows en local avec `CODA_API_TOKEN` dans `.env.local`.
2. **Orchestrateur + bindings + refresh** : `import.ts`, `bindings.ts`, 2 passes,
   relations, upsert refresh. Tests sur le mapping rich→FieldValue + résolution refs.
3. **UI** : `CodaTab`, sélecteur, readonly enforcement, refresh, mobile.

## Risques / notes

- **Sync en ligne** : les entités Coda sont des entités normales → poussées dans
  le salon si la sync est active (avantage : dispo multi-appareils ; coût : churn
  au refresh delete+recreate). v1 : accepté. Option future : marquer les entités
  Coda pour skip sync (comme `sourceVaultId` pour les montages).
- **Rate limits** : import d'un doc volumineux = nombreuses pages → throttle
  backend + barre de progression ; logguer si on plafonne.
- **Cardinalité Coda** parfois indéterminée → défaut `many_to_many` (array).
- **Évolution de schéma Coda** non gérée au refresh v1 (données seulement).
- **`_codaRowId`** : champ technique réservé, caché des vues, clé de réconciliation.
```
