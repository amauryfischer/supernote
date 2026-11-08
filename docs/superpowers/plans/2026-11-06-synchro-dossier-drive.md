# Synchro dossier ↔ Google Drive — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** lier un dossier du coffre à un dossier Drive choisi, synchronisés dans les deux sens par passes périodiques.

**Architecture:** le worker expose l'état local (`drive_sync_file`) et des écritures de notes qui déclenchent les hooks ; le thread principal (`lib/drive-sync.ts` + `DriveSyncRunner`) détient le jeton, liste Drive, rapproche et applique. Liaisons par appareil en `localStorage`.

**Tech Stack:** React 19, tRPC sur postMessage, sqlite-wasm, Google Drive API v3 REST via `googleRequest`, HeroUI v3 via `@supernote/ui`.

**Spec:** `docs/superpowers/specs/2026-11-06-synchro-dossier-drive-design.md` (à lire en entier : tableau de décision, conflits, suppressions).

## Global Constraints

- Zéro test unitaire, pas de vitest. Vérification de chaque tâche : `pnpm build:packages` (si `packages/` touché) + `pnpm typecheck` + `pnpm lint`.
- Pas de `any` ; `unknown` + narrowing.
- UI : `@supernote/ui` (HeroUI v3), boutons icône phosphor + Tooltip + `aria-label`, pas de toast (`lib/action-feedback.tsx`).
- Mobile dans le même mouvement : modal plein écran < 768px (`useIsMobile`), cibles ≥ 32px.
- Scope ajouté : `https://www.googleapis.com/auth/drive`, demandé seulement depuis un geste (création de liaison ou « Reprendre »).
- Tous les appels Drive passent par `googleRequest` (`apps/web/src/lib/google-api.ts`).
- Écritures de notes venues de Drive : routes à hooks, jamais `sync.applyOps`.
- Commentaires : seulement le pourquoi, en français. Pas de commit sans demande explicite.

## Review Focus

1. **Écho / boucle** : une passe sans changement réel ne doit rien écrire ni sur Drive ni localement — vérifier deux passes d'affilée (Task 6 étape 3).
2. **Sérialisation non déterministe** : `driveSync.localFiles` doit renvoyer exactement le contenu sur disque (lire le fichier, ne pas resérialiser) — sinon md5 ≠ et upload en boucle (Task 2).
3. **`.md` créé à la main sur Drive sans frontmatter** : devient une note dans le bon sous-dossier, le fichier Drive est réécrit avec `id` (Task 6 étape 4).
4. **Jeton absent au démarrage** : aucune popup, état « en pause » (Task 5).
5. **Liaison retirée** : aucun fichier supprimé d'aucun côté, état oublié (Task 4).

---

### Task 1: Table d'état + contrats IPC

**Files:**
- Modify: `apps/web/src/lib/vault-worker/db-schema.ts` (après `cal_outbox`)
- Create: `packages/ipc/src/schemas/drive-sync.ts`
- Create: `packages/ipc/src/router/drive-sync.router.ts`
- Modify: `packages/ipc/src/router/index.ts`, `packages/ipc/src/index.ts`

**Interfaces — Produces:**
- Table `drive_sync_file(linkId TEXT, driveFileId TEXT, entityId TEXT, relPath TEXT, driveMd5 TEXT, localHash TEXT, syncedAt INTEGER, PRIMARY KEY(linkId, driveFileId))`, index `(linkId, entityId)`. Commentaire SQL : locale à l'appareil, hors op-log.
- Zod + types : `DriveSyncLocalFile { entityId: string; filePath: string; fileHash: string; content: string }`, `DriveSyncStateRow { linkId; driveFileId; entityId; relPath; driveMd5; localHash; syncedAt: number }`.
- Router `driveSync` (modèle `calendar.router.ts`, corps `notImplemented`) :
  - `localFiles` query `{ prefix: string }` → `DriveSyncLocalFile[]`
  - `applyRemote` mutation `{ entityId?: string; filePath: string; content: string }` → `{ entityId: string; fileHash: string }`
  - `deleteLocal` mutation `{ entityId: string }` → `{ ok: true }`
  - `stateList` query `{ linkId }` → `DriveSyncStateRow[]`
  - `stateUpsert` mutation `DriveSyncStateRow` → `{ ok: true }`
  - `stateRemove` mutation `{ linkId; driveFileId }` → `{ ok: true }`
  - `stateClearLink` mutation `{ linkId }` → `{ ok: true }`

- [ ] **Step 1:** ajouter la table et l'index, les schémas, le router, l'enregistrer sous la clé `driveSync`.
- [ ] **Step 2:** `pnpm build:packages && pnpm typecheck` → OK.

### Task 2: Routes worker

**Files:**
- Create: `apps/web/src/lib/vault-worker/drive-sync-routes.ts`
- Modify: `apps/web/src/lib/vault-worker/worker-router.ts` (spread à côté de `...buildCalendarRoutes(db, vaultId)`, ~l. 3974)

**Interfaces:**
- Consumes: Task 1 ; dans `worker-router.ts` : `entitiesCreate`, `entitiesUpdate`, `entitiesDelete`, `entitiesGet` ; `parseFrontmatter` (`fsa-file-io.ts:35`) ; lecture de fichier du coffre (même primitive que `vault.readFile`).
- Produces: `buildDriveSyncRoutes(db: Database, vaultId: string, deps: { readFile(path: string): Promise<string>; create(input: unknown): Promise<unknown>; update(input: unknown): Promise<unknown>; remove(input: unknown): Promise<unknown> }): Record<string, RouteHandler>` avec les clés `driveSync.*` de Task 1.

- [ ] **Step 1: `localFiles`** — entités `vaultId = ? AND sourceVaultId IS NULL AND filePath LIKE prefix || '/%'` en `.md`/`.markdown` ; `content` = **le fichier lu sur disque**, pas resérialisé (Review Focus 2) ; `fileHash` = colonne.
- [ ] **Step 2: `applyRemote`** — `parseFrontmatter(content)` ; si `entityId` connu en base → `update({ id, fields, body, filePath })` ; sinon `create({ typeId: <type note>, fields, body, id: frontmatter.id s'il est libre })` puis `update({ id, filePath })` si le chemin dérivé diffère. Un `id` de frontmatter déjà pris par une entité hors `prefix` → ignorer l'id (nouvel id). Renvoyer `{ entityId, fileHash }` relu en base après écriture.
- [ ] **Step 3: `deleteLocal`** → `remove({ id })`. **`state*`** : SQL direct.
- [ ] **Step 4:** `pnpm typecheck && pnpm lint` → OK. Vérif manuelle en dev via `window.__supernoteWorker` : `driveSync.localFiles` sur un dossier connu renvoie ses notes.

### Task 3: Client Drive + moteur de passe

**Files:**
- Modify: `apps/web/src/lib/google-drive.ts` (exporter `DRIVE_FULL_SCOPE = "https://www.googleapis.com/auth/drive"`)
- Create: `apps/web/src/lib/drive-sync/links.ts`
- Create: `apps/web/src/lib/drive-sync/drive-api.ts`
- Create: `apps/web/src/lib/drive-sync/engine.ts`

**Interfaces — Produces:**
- `links.ts` : `type DriveSyncLink = { id: string; vaultFolder: string; driveFolderId: string; driveFolderPath: string; enabled: boolean; lastSyncAt?: number; lastError?: string }` ; `readLinks(vaultId): DriveSyncLink[]`, `writeLinks(vaultId, links)`, clé `supernote.driveSync.links`, événement fenêtre `DRIVE_SYNC_LINKS_EVENT = "supernote:drive-sync-links"` émis à l'écriture.
- `drive-api.ts` (tout via `googleRequest(clientId, DRIVE_FULL_SCOPE, …)`) :
  - `listFolderTree(clientId, rootId): Promise<{ files: RemoteFile[]; folders: Map<string /*relPath*/, string /*id*/> }>` avec `RemoteFile = { id; relPath; md5: string; modifiedTime: string }` ; récursif, `trashed = false`, paginé ; garder `.md`/`.markdown`, ignorer le reste. Commentaire `shortcut:` de la spec (décision 6).
  - `listChildFolders(clientId, parentId | "root"): Promise<{ id; name }[]>`, `createFolder(clientId, name, parentId): Promise<string>`
  - `ensureFolderPath(clientId, rootId, relDir, cache: Map<string,string>): Promise<string>`
  - `downloadText(clientId, fileId): Promise<string>` (`alt=media`)
  - `uploadNew(clientId, parentId, name, content): Promise<{ id; md5 }>` (multipart, `text/markdown`), `uploadContent(clientId, fileId, content): Promise<{ md5 }>`
  - `moveRename(clientId, fileId, name, addParent?, removeParent?)`, `trash(clientId, fileId)`
  - Toujours demander `fields=id,md5Checksum` pour récupérer le md5 après écriture.
- `engine.ts` : `syncLink(clientId: string, link: DriveSyncLink, rpc: DriveSyncRpc): Promise<{ uploaded: number; downloaded: number; conflicts: number; deleted: number; errors: number }>` où `DriveSyncRpc` = les 7 procédures de Task 1 (appelées via le client tRPC vanilla).

- [ ] **Step 1:** `links.ts` et `drive-api.ts`.
- [ ] **Step 2:** `engine.ts` — implémenter le tableau « Algorithme d'une passe » de la spec tel quel. Rapprochement dans cet ordre : ligne d'état (`driveFileId`), puis `id` du frontmatter Drive (lu seulement pour les fichiers Drive sans ligne d'état), puis `relPath` + contenu identique. `relPath` = `filePath` sans le préfixe `vaultFolder/`. Après chaque écriture, `stateUpsert` avec le `localHash`/`driveMd5` **résultants**. Conflit : `applyRemote({ filePath: <même dossier>/<titre> (conflit Drive AAAA-MM-JJ).md, content: <contenu Drive sans id> })` ; la note locale reste et repart à la passe suivante. Nouveau `.md` Drive sans `id` : `applyRemote` puis `uploadContent` du fichier local produit (Review Focus 3). Erreur par fichier : compter, `console.warn`, continuer.
- [ ] **Step 3:** `pnpm typecheck && pnpm lint` → OK.

### Task 4: Réglages + navigateur de dossiers Drive

**Files:**
- Create: `apps/web/src/components/settings/drive-sync/DriveFolderBrowser.tsx`
- Create: `apps/web/src/components/settings/drive-sync/DriveSyncLinks.tsx`
- Modify: `apps/web/src/components/settings/tabs/GoogleDriveTab.tsx` (nouvelle `SettingSection` « Dossiers synchronisés »)
- Modify: `apps/web/src/components/notes/FileTree.tsx` (menu dossier : « Synchroniser avec Drive… » ; pastille sur dossier lié) + l'équivalent du menu dossier mobile s'il est distinct

**Interfaces:**
- Consumes: Task 3 (`readLinks`/`writeLinks`, `listChildFolders`, `createFolder`), `requestAccessToken(clientId, { scope: DRIVE_FULL_SCOPE })`.
- Produces: `<DriveFolderBrowser open onClose onPick(folder: { id; path }) />` ; `openDriveSyncFor(vaultFolder: string)` (événement fenêtre `supernote:drive-sync-open` avec `detail.vaultFolder`, écouté par `DriveSyncLinks` qui ouvre le flux pré-rempli).

- [ ] **Step 1:** navigateur : fil d'Ariane depuis « Mon Drive », liste des sous-dossiers, « Créer un dossier ici », « Choisir ce dossier » ; plein écran sous 768px.
- [ ] **Step 2:** liste des liaisons : dossier du coffre → chemin Drive, dernière synchro / erreur, Switch activé, bouton « Synchroniser maintenant » (retour porté par le bouton), retirer (= `writeLinks` sans elle + `stateClearLink`, rien supprimé — Review Focus 5). « Ajouter » : choisir le dossier du coffre (liste des dossiers existants), puis le navigateur ; le clic « Ajouter » est le geste qui demande le scope `drive`.
- [ ] **Step 3:** masquer la section si `!hasWorkerBackend()` ou Drive non connecté.
- [ ] **Step 4:** `pnpm typecheck && pnpm lint` → OK ; vérif visuelle desktop + mobile (375px) sur `/settings`.

### Task 5: DriveSyncRunner

**Files:**
- Create: `apps/web/src/lib/drive-sync/DriveSyncRunner.tsx`
- Modify: `apps/web/src/RootLayout.tsx` (monter à côté de `CalendarRunner`)

**Interfaces:**
- Consumes: Task 3 `syncLink`, `readLinks`/`writeLinks` ; `hasValidToken(clientId, DRIVE_FULL_SCOPE)`.
- Produces: `requestDriveSync(linkId?: string)` (événement `supernote:drive-sync-request`) utilisé par le bouton de Task 4.

- [ ] **Step 1:** déclencheurs : intervalle 5 min, `visibilitychange` visible, `ENTITY_CHANGE` dont le `filePath` est sous un `vaultFolder` lié (debounce 10 s), `requestDriveSync`. Une passe en cours → une seule relance derrière elle (comme `syncCalendars`). Liaisons traitées en séquence ; résultat écrit dans `lastSyncAt`/`lastError`.
- [ ] **Step 2:** sans jeton valide : ne rien appeler, pas de popup (Review Focus 4) ; `lastError = "pause"`, affiché « Synchro en pause · Reprendre » par Task 4 (le clic appelle `requestAccessToken` puis `requestDriveSync`).
- [ ] **Step 3:** `pnpm typecheck && pnpm lint` → OK.

### Task 6: Essai réel bout à bout

- [ ] **Step 1:** `pnpm dev`, coffre de test, lier `Projets/Test` à un dossier Drive neuf → les notes apparaissent en `.md` avec la même arborescence.
- [ ] **Step 2:** modifier une note dans Supernote → Drive à jour à la passe suivante ; modifier le `.md` sur Drive → note à jour.
- [ ] **Step 3:** deux passes sans rien toucher → aucun appel d'écriture dans l'onglet Réseau (Review Focus 1).
- [ ] **Step 4:** créer `nouveau.md` sans frontmatter dans un sous-dossier Drive → note créée au bon endroit, fichier Drive réécrit avec `id` (Review Focus 3).
- [ ] **Step 5:** modifier la même note des deux côtés → note `(conflit Drive …)` créée, rien perdu.
- [ ] **Step 6:** supprimer une note locale → fichier dans la corbeille Drive ; supprimer un fichier Drive d'une note inchangée → note supprimée ; d'une note modifiée → fichier recréé.
- [ ] **Step 7:** retirer la liaison → rien supprimé nulle part.
- [ ] **Step 8:** mettre à jour la carte (`codebase-mapper:update-codebase-map`) : nouvelle frontière Drive dans `communication.md`, table `drive_sync_file` dans `database.md`.
