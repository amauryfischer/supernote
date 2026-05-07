# Open-source inspiration research

Date: 2026-05-07
Author: research-agent

---

## Executive summary

Five cross-cutting takeaways for Supernote, derived from source-level inspection of AppFlowy, AnyType, Logseq, and the Obsidian plugin API:

1. **Dual-DB architecture (DataScript + SQLite) is the right split for Supernote.** Logseq runs an in-memory DataScript graph for relational queries and a separate SQLite FTS5 database (in a web worker) for full-text search, kept in sync by DB triggers. Supernote should mirror this: SQLite (Prisma) as the persistent store, an in-process in-memory cache for graph traversal, and SQLite FTS5 for text search — all rebuilt from the filesystem on corruption.

2. **Blocks-as-typed-classes and Relations-as-first-class-objects is the right object model.** AnyType's `ObjectLayout` enum (Page, Human, Task, Set, Collection, Date …) plus `RelationType` enum (LongText, ShortText, Number, Select, Date, Checkbox, Url, Email, Phone, Object, Relations) maps almost exactly to Supernote's `EntityType + Field + RelationType` data model. Steal this taxonomy verbatim; it encodes years of UX iteration.

3. **Use a dedicated web/Node worker for all DB writes + indexing.** Both Logseq and AnyType run their heavy work off the UI thread. Logseq exposes its worker via Comlink (`db-worker.cljs`), AnyType uses a PixiJS web-worker for graph rendering. For Supernote: keep Prisma writes, FTS indexing, and embedding computation inside a Node worker thread; communicate with the renderer via tRPC-over-IPC exactly as specced.

4. **Plugin lifecycle must be based on a Component class with automatic cleanup.** Obsidian's `Plugin extends Component` pattern (with `registerEvent`, `registerInterval`, `registerDomEvent`) ensures all subscriptions are torn down on `onunload()` with zero boilerplate. Supernote's plugin sandbox (iframe + postMessage) should provide the same auto-cleanup guarantee via a typed SDK wrapper.

5. **The `.canvas` format should stay a strict superset of the Obsidian spec.** Obsidian's `canvas.d.ts` is minimal (nodes: file/text/link/group, edges, plus `[key: string]: any` escape hatch). Adding `type: 'entity'`, `type: 'query'`, `type: 'formula'` keys to `CanvasNodeData` remains backward-compatible: Obsidian silently ignores unknown node types.

---

## AppFlowy

### Stack

- **Backend:** Rust — `collab` crate (custom CRDT built on top of `yrs`/Yjs for Rust), gRPC protobuf IPC.
- **Frontend:** Flutter (mobile/desktop) + React (web). The React web client is a thin skin over the same protobuf API.
- **IPC model:** Flutter calls Rust through Dart FFI; the web client calls a shared gRPC/HTTP gateway.
- **State management:** BLoC + Freezed (Dart immutable unions); every view state is a sealed `ViewState`.
- **Relevance for Supernote:** Lower — Flutter/Rust stack is not reusable, but the architecture decisions and UX patterns are valuable.

**Key files inspected:**
- `frontend/appflowy_flutter/lib/workspace/application/view/view_bloc.dart` — bloc pattern per view
- `frontend/appflowy_flutter/lib/workspace/application/settings/application_data_storage.dart` — vault path management
- `frontend/appflowy_flutter/lib/workspace/application/workspace/workspace_bloc.dart` — workspace protobuf integration

### Storage architecture

AppFlowy stores all document data in a **custom CRDT format** (`appflowy_collab` crate, built on `yrs`). The filesystem is **not** the primary source of truth; the CRDT binary is. Markdown export is a derived view.

Workspace path management is handled by `ApplicationDataStorage`:
- The data folder is always named `AppFlowyDataDoNotRename` (a stable sentinel).
- Custom path is validated at set time; if the directory does not exist yet, it is created recursively.
- A KV store (simple file) caches the resolved path; if the directory disappears (e.g. moved USB), the KV is cleared and the default path is restored automatically.

**Multi-machine conflict resolution:** AppFlowy uses CRDT merging (Yjs/yrs semantics). Two offline clients can both edit the same document; on reconnect, the CRDT merge is deterministic and lossless. This is the correct approach for real-time collaboration but adds significant complexity.

Supernote explicitly rejects CRDT in favour of git/Syncthing (design §12). This is the right call for a single-user desktop app: it eliminates `yrs` dependency (~500 KB WASM), simplifies the code, and the file remains valid markdown at all times.

### What we should steal

1. **`AppFlowyDataDoNotRename` sentinel folder name.** Name Supernote's internal folder `.supernote` (already done in spec). The lesson: make it obviously machine-owned so users don't rename it.

2. **Custom workspace path with directory-existence validation.** `ApplicationDataStorage.setCustomPath` normalises platform path separators, strips macOS volume prefix, appends a well-known subfolder, and creates the directory if absent. Copy this pattern verbatim in Supernote's `VaultManager.setCustomPath`.

3. **`FlowyResult<T, E>` (Rust-style Result across IPC).** Every BLoC method returns `FlowyResult` — no thrown exceptions cross process boundaries. Supernote already plans tRPC `Result<T, E>` — reinforce this: never `.throw()` across IPC, always return typed errors.

4. **Sidebar space/section architecture.** AppFlowy organises sidebar into "spaces" (like named vaults within a workspace) with public/private sections. For Supernote: use this to separate CRM contacts from notes from finance data at the sidebar level, not just at the filesystem level.

5. **Command palette as first-class citizen.** `command_palette/` is a dedicated BLoC. Supernote's `Cmd+K` quick switcher should be a standalone module with its own state, not coupled to the router.

### What we should NOT do

- **CRDT-first storage.** AppFlowy cannot expose plain markdown to third-party editors because the CRDT binary is the source of truth. Supernote's filesystem-first model is superior for the target audience.
- **Flutter for desktop.** The Flutter+Rust stack gives AppFlowy excellent cross-platform rendering but at the cost of a custom widget toolkit, non-standard text rendering on Linux, and a very large binary. Electron + React is the right trade-off for Supernote (already decided).
- **Protobuf for IPC.** AppFlowy generates protobuf types for every data structure. The overhead of `generate:protos` and the boilerplate of `.pb.dart` files is significant. tRPC-over-IPC with Zod is strictly better for a TypeScript-only stack.

---

## AnyType

### Stack

- **Backend:** Go — `anytype-heart` binary (closed source), exposing a gRPC + gRPC-Web proxy; all storage, sync, and CRDT logic is in this Go process.
- **Frontend:** React + TypeScript + Electron. The TS client (`anytype-ts`) only renders; all business logic is in the Go middleware.
- **IPC model:** Renderer → gRPC-Web → Electron main → HTTP → Go process. The Go process is started as a `childProcess.spawn` in `electron/ts/server.ts`; its stdout emits the gRPC-Web proxy address.
- **State management:** MobX (observable stores: `BlockStore`, `RecordStore`, `DetailStore`).
- **Search:** Pixi.js (OffscreenCanvas web worker) for graph rendering; SQLite FTS (in Go) for text search.

**Key files inspected:**
- `electron/ts/server.ts` — Go middleware lifecycle
- `electron/ts/api.ts` — Electron IPC handler (multi-tab, pin lock, GPU settings)
- `src/ts/lib/api/dispatcher.ts` — gRPC-Web Dispatcher class
- `src/ts/lib/api/command.ts` — all gRPC commands exposed as typed TS functions
- `src/ts/model/block.ts` — Block class with `ContentModel` registry
- `src/ts/model/view.ts` — View class (Grid/List/Gallery/Board)
- `src/ts/model/content/dataview.ts` — Dataview block (Set/Collection)
- `src/ts/store/block.ts` — `BlockStore` (treeMap, blockMap, restrictionMap)
- `src/ts/store/record.ts` — `RecordStore` (relationKeyMap, typeKeyMap, viewMap, recordMap)
- `src/ts/store/detail.ts` — `DetailStore` (object properties, layout-aware mappers)
- `src/ts/interface/index.ts` — all interface re-exports
- `src/ts/interface/block/index.ts` — `BlockType`, `RelationType`, `ObjectLayout` enums
- `src/ts/interface/object.ts` — `ObjectLayout`, `RelationType`, `RelationScope`, `ObjectOrigin`

### Storage architecture

AnyType's storage is entirely inside the Go middleware. The TypeScript frontend has **no direct filesystem or database access** — it only sends gRPC commands and receives events via a persistent stream. This is the cleanest separation of concerns possible, but it requires the closed-source `anytype-heart`.

Key insight from `dispatcher.ts`: all state changes arrive as a **streaming event** from the middleware. The dispatcher buffers events in a `requestAnimationFrame` flush loop to batch UI updates. This is why AnyType feels snappy despite all data coming over gRPC.

The `DetailStore` is the MobX representation of object properties. It maintains a three-level `Map<rootId, Map<objectId, Map<relationKey, Detail>>>`. This is equivalent to Supernote's `Entity.fields JSON` column — but AnyType exposes it as a fully reactive MobX graph.

**Multi-machine sync:** P2P encrypted sync via `anytype-heart` (libp2p). Not relevant for Supernote.

### What we should steal

1. **`ObjectLayout` + `RelationType` taxonomy.** AnyType's enum values are the result of shipping a real product. Key layouts: `Page=0, Human=1, Task=2, Set=3, Collection=14, Date=17`. Supernote's `EntityType` seeds should map to these: Note→Page, Personne→Human, Projet→Task, a "Set view"→Set/Collection. The `RelationType` enum (LongText, ShortText, Number, Select, Date, File, Checkbox, Url, Email, Phone, MultiSelect, Object, Relations) is exactly Supernote's `Field.type` list — use the same names.

2. **`ContentModel` registry pattern.** `block.ts` builds `ContentModel = { layout: BlockContentLayout, text: BlockContentText, dataview: BlockContentDataview, … }` as a static map. When deserialising a block, it does `new ContentModel[this.type](this.content)`. Supernote's `EntityType` deserialiser should do the same: a registry mapping `type` string → typed class.

3. **`RecordStore` key maps for fast lookups.** `relationKeyMap: spaceId → relationKey → relationId` and `typeKeyMap: spaceId → uniqueKey → typeId` are hot-path lookup caches. Supernote's equivalent: cache `fieldId → fieldDef` and `typeId → EntityType` in memory after every schema load, invalidated on schema edit.

4. **Event-buffered RAF flush in the dispatcher.** `dispatcher.ts` accumulates events in `eventBuffer` and flushes them in a `requestAnimationFrame` callback (`rafId`), with a fallback `setTimeout` flush. This prevents excessive React re-renders on bulk imports or large transactions. Copy this pattern in Supernote's IPC event bus.

5. **`DetailStore` layout-aware mappers.** The `keyMap` object in `detail.ts` remaps raw relation keys to friendly names per `ObjectLayout`. For example, for `Participant` layout, `permissions → participantPermissions`. This enables layout-specific display logic without `if/else` chains in components. Apply this to Supernote's entity card renderer.

6. **Tab architecture with `activeTabOnly` guards.** `api.ts` maintains a `Set<string>` of commands (like `payloadBroadcast`, `notification`) that should only be processed by the currently active browser tab/view. Without this guard, each tab receives duplicate IPC messages. Supernote should implement the same when multi-window support is added.

### What we should NOT do

- **Closed-source middleware.** AnyType's Go `anytype-heart` binary is not open source. All the interesting storage/sync/CRDT logic is in a black box. Supernote keeps everything in TypeScript/Node — the right call.
- **gRPC-Web between renderer and main.** The full gRPC → HTTP proxy → Go process chain is elegant for a networked P2P app but adds 50+ MB of binary overhead and a local HTTP server for a single-user desktop app. tRPC over Electron IPC is strictly lighter.
- **MobX for everything.** MobX's deep observability is powerful but leads to subtle reactivity bugs. Supernote's Zustand + TanStack Query gives more predictable and debuggable state.

---

## Logseq

### Stack

- **Language:** ClojureScript (compiled via shadow-cljs). Functional, immutable data, Datalog queries.
- **In-memory DB:** DataScript (Datomic-like in-memory store with Datalog query language).
- **Persistent DB:** SQLite WASM (in a dedicated web worker) for graph data + a **separate** SQLite FTS5 database for full-text search.
- **Worker architecture:** Main thread runs ClojureScript/React (Rum). A web worker (Comlink-exposed) owns all DataScript + SQLite operations.
- **Sync:** Optional paid cloud sync (`frontend/worker/sync/`) using an operation log + remote transactions. Local-only mode uses plain files.
- **Editor:** Custom ProseMirror-compatible outliner (block-based, indented bullets).

**Key files inspected:**
- `src/main/frontend/db/conn.cljs` — DataScript connection management per repo
- `src/main/frontend/db/persist.cljs` — graph/DB listing, Electron IPC `getGraphs`
- `src/main/frontend/worker/db-worker.cljs` — Comlink-exposed worker entry
- `src/main/frontend/worker/db_core.cljs` — dual-DB init (DataScript + SQLite), search index versioning
- `src/main/frontend/worker/db_listener.cljs` — post-transaction pipeline: refs, search sync, CRDT upload
- `src/main/frontend/worker/pipeline.cljs` — `invoke-hooks` after every DataScript `transact!`
- `src/main/frontend/worker/search.cljs` — SQLite FTS5 (`fts5` + trigram tokenizer) + trigger-based sync
- `src/main/frontend/search/agency.cljs` — search engine abstraction (browser + plugin engines)
- `src/main/frontend/search/browser.cljs` — delegates search to worker via `state/<invoke-db-worker`
- `src/main/frontend/fs/memory-fs.cljs` — lightning-fs in-memory FS (browser fallback)
- `CODEBASE_OVERVIEW.md` — authoritative architecture summary

### Storage architecture

Logseq's new "DB-based graph" (replacing the file-based graph) uses two SQLite databases in a web worker:

1. **Main graph DB:** DataScript in-memory + SQLite WASM persistence (OPFS on browser, native file on Electron). Schema is Datalog: entities are just `{:db/id, :block/uuid, :block/title, :block/refs, :block/tags, …}`. No fixed schema — any attribute can be added to any entity.

2. **Search DB:** A separate SQLite file, tables `blocks` (id, title, page) + `blocks_fts` (FTS5 virtual table with **trigram tokenizer**). Kept in sync by three SQL triggers: `blocks_ai` (after insert), `blocks_au` (after update), `blocks_ad` (after delete). The trigram tokenizer enables substring search — not just token search.

**The key architecture insight:** The DataScript DB is the authoritative in-memory index. SQLite is just the persistence backend for DataScript data, and a separate FTS index. After every `d/transact!`, a pipeline runs:
- rebuild block refs
- sync search index (delete removed, upsert added blocks in batches of 2000)
- handle CRDT/RTC upload (if sync enabled)

**Incremental re-index:** Logseq does not re-index the entire graph on change. The pipeline receives the `tx-report` (DataScript diff: `:tx-data` = datoms added/retracted) and only updates the search index for changed blocks. This is the correct approach for Supernote's indexer.

The worker exposes an API via Comlink. The main thread invokes it as:
```
state/<invoke-db-worker :thread-api/search-blocks repo q option
```
All DB calls are async (Promise-based) with no synchronous main-thread blocking.

### What we should steal

1. **FTS5 trigram tokenizer.** Logseq's search creates `blocks_fts USING fts5(id, title, page, tokenize="trigram")`. The trigram tokenizer supports arbitrary substring search (e.g. searching "react" finds "React", "reactivity", "@react-flow"). Supernote's `FtsIndex` table should use `tokenize="trigram"` from day one.

2. **SQL triggers for FTS sync.** Three triggers (`blocks_ai`, `blocks_au`, `blocks_ad`) keep the FTS table in sync automatically on every INSERT/UPDATE/DELETE to `blocks`. No application-layer sync code needed. Apply the same pattern: add FTS5 triggers on Supernote's `Entity` table so the FTS index is always consistent.

3. **Post-transaction pipeline pattern.** Logseq's `pipeline.cljs` runs a series of hooks after every `d/transact!`: ref rebuild, search sync, template insertion, CRDT upload. Supernote's indexer should be modelled the same way: after every `prisma.entity.upsert`, run a `post-save pipeline` that recomputes mentions, FTS, embeddings, formulas, and automations — in a worker thread, debounced.

4. **Worker isolation for DB.** Logseq enforces `React is forbidden in worker scope!` via `check-worker-scope!`. This ensures the DB worker is a clean environment with no UI dependencies. Supernote's indexer worker should have the same constraint — no React, no Electron renderer imports.

5. **Search protocol abstraction.** `search/agency.cljs` implements a protocol with `query`, `rebuild-blocks-indice!`, `transact-blocks!`, `truncate-blocks!`, `remove-db!`. The Agency delegates to a list of engines (browser FTS + optional plugin engines). Supernote's `SearchEngine` interface should expose the same protocol, enabling future semantic search or plugin search engines without changing call sites.

6. **Search index versioning via `PRAGMA user_version`.** `db_core.cljs` defines `search-db-version = 1` and checks it on open. If the version does not match, it drops and rebuilds the index. Supernote should do the same: store `schema_version` in `index.db`'s `PRAGMA user_version` to trigger automatic re-index on schema changes.

### What we should NOT do

- **ClojureScript.** The language is elegant but creates a hard hiring barrier, a slow compile loop, and a large runtime. TypeScript is the right choice for Supernote.
- **Outliner-only UX.** Logseq forces the bullet-indented outliner paradigm for everything, which is powerful for note-taking but alien for CRM or database views. Supernote's BlockNote editor is more flexible.
- **File-based graph (legacy).** Logseq's original file-based graph (parse markdown → DataScript on every open) had serious performance issues on large vaults. The new DB-based graph is the correct model — Supernote starts with SQLite-first, which is already the right choice.
- **DataScript as primary persistent store.** DataScript is in-memory; persistence requires a separate SQLite layer. Prisma + SQLite is simpler and more debuggable for Supernote.

---

## Obsidian

### Stack

(Based on `obsidian-api` — the public TypeScript type definitions — and `obsidian-sample-plugin`.)

- **Runtime:** Electron (closed-source core). The renderer is a standard Chromium page.
- **Editor:** CodeMirror 6 (exposed via `Extension`, `StateField`, `EditorView`, `ViewPlugin` imports in `obsidian.d.ts`).
- **Plugin system:** Each plugin is a JS file loaded in the renderer process (no iframe sandbox). Plugins get direct access to the `App` object.
- **No TypeScript strict mode in plugin API:** The API uses `any` in several places (`getFileCache` returns `CachedMetadata | null`, `loadData/saveData` use `any`).

**Key files inspected:**
- `obsidian.d.ts` — full API surface (~7800 lines)
- `canvas.d.ts` — canvas JSON format spec
- `obsidian-sample-plugin/src/main.ts` — canonical plugin structure
- `manifest.json` — plugin manifest format

### Storage architecture

**Vault = directory.** `Vault` class wraps the filesystem. Key methods: `create`, `read`, `write`, `delete`, `rename`, `copy`, `getFiles()`, `getMarkdownFiles()`, `getAbstractFileByPath(path)`. All are async Promises.

**MetadataCache = the index.** Obsidian maintains a `MetadataCache` that parses frontmatter, headings, links, tags, and blocks in real-time. Key API:
- `getFileCache(file: TFile): CachedMetadata | null` — returns parsed frontmatter + links + headings + blocks for a file.
- `resolvedLinks: Record<string, Record<string, number>>` — bidirectional link graph (source path → target path → count).
- `unresolvedLinks: Record<string, Record<string, number>>` — same for broken links.
- Events: `on('changed', cb)`, `on('deleted', cb)`, `on('resolve', cb)` — fired after index update.

`CachedMetadata` contains:
- `frontmatter?: FrontMatterCache` — raw YAML frontmatter object
- `links?: LinkCache[]` — all wikilinks in the file
- `headings?: HeadingCache[]` — all headings
- `blocks?: Record<string, BlockCache>` — named blocks (`^block-id`)
- `tags?: TagCache[]` — all `#tags`

This is the correct model for Supernote's `Mention` and backlink tables. Supernote should maintain equivalent structures in SQLite, rebuilt from the remark AST on every file change.

**Canvas format** (`canvas.d.ts`):
```ts
interface CanvasData {
  nodes: AllCanvasNodeData[];  // CanvasFileData | CanvasTextData | CanvasLinkData | CanvasGroupData
  edges: CanvasEdgeData[];
  [key: string]: any;           // ← forward-compat escape hatch
}
```
Node types: `file` (links to a vault file), `text` (inline text), `link` (external URL), `group` (named bounding box). Edges: `fromNode/fromSide/fromEnd` → `toNode/toSide/toEnd` with optional `label`. All node data has `[key: string]: any` for forward compatibility.

### Plugin API patterns

**Plugin lifecycle** (`abstract class Plugin extends Component`):
- `onload(): Promise<void> | void` — called when plugin is enabled.
- `onunload(): void` — called when disabled. All resources registered via `registerEvent`, `registerInterval`, `registerDomEvent` are automatically cleaned up.
- `loadData(): Promise<any>` / `saveData(data: any): Promise<void>` — per-plugin persistent key-value storage (stored as JSON in `.obsidian/plugins/<id>/data.json`).
- `addCommand(command: Command)` — registers a command palette entry with optional `hotkeys`, `editorCallback`, `checkCallback`.
- `registerView(type: string, viewCreator: ViewCreator)` — registers a custom leaf/panel type.
- `registerMarkdownCodeBlockProcessor(language, handler)` — renders custom code fences.
- `addSettingTab(tab: PluginSettingTab)` — adds a settings page.

**Manifest format** (`manifest.json`):
```json
{
  "id": "plugin-id",
  "name": "Display Name",
  "version": "1.0.0",
  "minAppVersion": "0.15.0",
  "isDesktopOnly": false
}
```

**App object** exposed to plugins (`class App`):
- `app.vault` — filesystem
- `app.metadataCache` — link/frontmatter index
- `app.workspace` — panes/leaves layout
- `app.keymap` — global keymap
- `app.fileManager` — file management helpers (move, rename with backlink update)

**Workspace architecture** (`class Workspace`):
- Panes are `WorkspaceLeaf` objects (container for a single view).
- `getLeaf(newLeaf?: boolean)` — get or create a leaf.
- `getActiveViewOfType(type)` — returns the focused view of a specific type.
- Events: `on('layout-change')`, `on('active-leaf-change')`, `on('file-open')`.

**Scope/hotkey system:** Each modal, view, or plugin has a `Scope` that can push/pop from a global scope stack. Only the top scope's hotkeys are active. This prevents hotkey conflicts between panes.

### What we should steal

1. **Plugin manifest with `minAppVersion`.** Supernote's plugin manifest should require a `minAppVersion` field (semver). The plugin loader rejects plugins whose `minAppVersion` is newer than the installed app. This prevents silent breakage after app updates.

2. **Auto-cleanup via Component pattern.** Obsidian's `Component` base class tracks all registered events, intervals, and DOM listeners. Calling `unload()` cleans up everything. Supernote's plugin SDK (`packages/plugin-sdk`) should expose a `SupernotePlugin` base class with the same pattern. Even in an iframe sandbox, the plugin runtime should call `plugin.unload()` on disable and auto-cancel all pending callbacks.

3. **`loadData / saveData` per plugin.** Each Obsidian plugin gets its own JSON file in `.obsidian/plugins/<id>/data.json`. For Supernote: store per-plugin settings in `.supernote/plugins/<id>/data.json`. Simple, auditable, portable.

4. **`CachedMetadata` model for Supernote's Mention table.** Obsidian's `CachedMetadata` (frontmatter + links + headings + tags + blocks) maps directly to what Supernote needs. The `Mention` table should store: `sourceId`, `targetId | targetPath`, `mentionType` (wikilink | embed | tag | blockRef), `position` (line/col for conflict UI), `isResolved`. The backlink graph is then derived as `SELECT * FROM Mention WHERE targetId = ?`.

5. **Canvas `[key: string]: any` forward-compat.** All Obsidian canvas interfaces have an explicit `[key: string]: any` catchall. This means Supernote can add `type: 'entity'`, `entityId`, `queryDef`, `formulaDef` to any node without breaking Obsidian compatibility. Keep this property in Supernote's canvas types.

6. **`processFrontMatter(file, fn)` atomic update.** `FileManager.processFrontMatter` takes a callback that receives the raw frontmatter object and mutates it; the method serialises back to YAML atomically. This is safer than read-modify-write. Supernote's `FileIO.updateFrontMatter(path, updater)` should work the same way.

### What we should NOT do

- **Expose the full App object to plugins without sandboxing.** Obsidian gives plugins unrestricted access to `app.vault.read/write/delete` — any plugin can silently delete files. Supernote's iframe sandbox + permission model is the right approach: plugins declare which `Entity types` they read/write, and the SDK enforces it via postMessage filtering.
- **CodeMirror 6 as the editor.** Obsidian uses CM6 for its markdown source editor. BlockNote (Tiptap/ProseMirror) is already chosen for Supernote and provides a better block-based experience. No reason to change.
- **One global plugin namespace.** Obsidian plugins all share the same renderer process memory. This causes plugin conflicts and crashes. Supernote's iframe-per-plugin design is correct even though it's more complex.

---

## Cross-cutting recommendations for Supernote

### R1: FTS5 trigram tokenizer from day one
**Inspired by:** Logseq (`create virtual table blocks_fts using fts5(…, tokenize="trigram")`)

Configure `FtsIndex` as `USING fts5(id, title, body, tokenize="trigram")`. Also add SQL triggers on the `Entity` table so the FTS is always in sync without application-layer code. This enables "contains" searches that SQLite's default MATCH does not support.

**Rationale:** The trigram tokenizer is a drop-in SQLite FTS5 feature available since SQLite 3.43 (2023). It costs ~3× more storage than the default tokenizer but enables substring matching, which is essential for searching entity names and note content.

### R2: Post-save pipeline as a single composed hook
**Inspired by:** Logseq (`worker/pipeline.cljs`), AnyType (dispatcher event buffer + RAF flush)

After every `prisma.entity.upsert`, run a deterministic pipeline in the worker thread:
1. Parse AST → extract mentions, tags, block refs
2. Upsert `Mention` table
3. Sync FTS index (delete old, insert new)
4. Recompute embeddings (if content hash changed)
5. Recompute formula fields and rollups that depend on this entity
6. Fire automations whose trigger matches

Each step should be idempotent and independently replayable. If step 4 fails (ONNX model not loaded), the rest of the pipeline still completes.

### R3: ContentModel / field-type registry
**Inspired by:** AnyType (`block.ts` ContentModel, `interface/object.ts` RelationType enum)

Define a static `FIELD_TYPE_REGISTRY: Record<FieldType, FieldTypeDefinition>` where `FieldTypeDefinition` encodes: `{ serialize, deserialize, validate, render, filterOperators, sortComparator }`. This avoids `switch (field.type)` in 10 different places. When a new field type is added (e.g. `geolocation`), only the registry needs updating.

### R4: Schema version in `PRAGMA user_version`
**Inspired by:** Logseq (`db_core.cljs` `search-db-version`)

Store the current indexer schema version in SQLite's `PRAGMA user_version`. On vault open, compare with the expected version. If lower: run migrations and rebuild stale indexes. If higher (user downgrades app): show a warning and refuse to open (prevents data corruption). This is simpler than a custom `Setting` row and survives file copies.

### R5: Plugin manifest `minAppVersion` + auto-cleanup Component base
**Inspired by:** Obsidian (`manifest.json`, `Plugin extends Component`)

Add `minSupernoteVersion: "0.1.0"` to Supernote plugin manifests. The plugin loader compares this with the current app version and refuses to load incompatible plugins. The `SupernotePlugin` base class in `packages/plugin-sdk` should mirror Obsidian's Component: `registerDisposable(fn)`, `registerInterval(id)`, `onunload()` auto-clears everything. This makes plugin authors' lives easier and prevents memory leaks.

### R6: Canvas as strict Obsidian superset
**Inspired by:** Obsidian (`canvas.d.ts` `[key: string]: any` escape hatch)

Keep `.canvas` files byte-compatible with Obsidian. Supernote-specific node types use `type: 'sn-entity' | 'sn-query' | 'sn-formula'` (namespaced) to avoid collision with future Obsidian node types. When Obsidian opens a Supernote canvas, it renders file/text/link/group nodes normally and silently ignores `sn-*` nodes. When Supernote opens an Obsidian canvas, it renders all standard node types and shows `sn-*` nodes with their full Supernote semantics.

### R7: `RelationType` + `ObjectLayout` enum taxonomy from AnyType
**Inspired by:** AnyType (`interface/object.ts`)

Supernote's `Field.type` enum should align with AnyType's `RelationType` values:
`text (ShortText), longtext (LongText), number, select, multiselect, date, checkbox, url, email, phone, file, object (= relation to EntityType), relations`. This ensures future interoperability and encodes UX decisions already validated by AnyType's shipped product.

---

## Open questions

**Q1: Embedding storage — JSON BLOB vs. sqlite-vec extension vs. separate vector DB?**
Logseq does not implement semantic search. AnyType stores vectors server-side (in Go). Obsidian plugins like `Smart Connections` store vectors as JSON in a flat file. The spec says `sqlite-vec` or JSON BLOB. Decision needed: `sqlite-vec` is not yet stable on all platforms; JSON BLOB in a dedicated `Embedding` table is simpler and fast enough for <50k entities if we use ANN with HNSW in JS. Recommend: start with JSON BLOB + cosine similarity in the worker (no native extension), add `sqlite-vec` migration path in a later iteration.

**Q2: Plugin sandboxing level — iframe vs. VM2?**
The spec lists `VM2 / iframe-sandbox`. VM2 has known sandbox escape vulnerabilities (deprecated since 2023 for untrusted code). iframes with `sandbox` attribute + postMessage is the only safe option for truly untrusted third-party plugins. For first-party plugins, a looser `worker`-based sandbox is acceptable. Decision: use iframes for third-party marketplace plugins, Node worker for first-party/trusted plugins.

**Q3: Conflict resolution for the lock file?**
The spec defines `lock.json` (pid/host/timestamp) for multi-machine protection. Logseq uses DataScript transactions (atomic) and SQLite WAL mode. Question: what happens if the previous process crashed and the lock is stale? Need a `lock_ttl` (e.g. 30 seconds) + `lock_heartbeat` from the running process. On open, if `lock.mtime < now - 2×ttl`, treat lock as stale and overwrite. This needs a concrete decision before the lock module is implemented.

**Q4: FTS5 vs. hybrid search as default search path?**
The spec says "hybrid search (FTS + semantic reranked)". Logseq uses FTS5-only (no semantic). AnyType uses server-side full-text. Recommendation: make FTS5 the primary path (synchronous, always available), semantic reranking as an optional async enrichment that fires after FTS results are displayed. Never block the search UI on embedding computation.

**Q5: How to version EntityType schemas and migrate existing entities?**
Neither AppFlowy nor AnyType expose their schema migration strategy in the open-source code. Obsidian has no schema — everything is freeform frontmatter. The spec mentions "auto-fix proposals when schema migrates". Decision needed: when a field is removed from a type, what happens to existing entities that have a value for that field? Options: (a) keep the value in `Entity.fields` as an "orphan" field (display as raw JSON, allow re-attachment), (b) move it to a `_deprecated_fields` JSON column, (c) prompt the user per-entity. Option (a) is the safest and most reversible.
