# Packages du monorepo

Supernote est organisé en monorepo pnpm + Turborepo. Les 22 packages sont dans `packages/` et les 2 apps dans `apps/`.

---

## Applications

### `apps/desktop`

**Rôle :** Electron main process + preload script.

Responsabilités :
- Cycle de vie de l'app (BrowserWindow, app.ready, quit)
- Exposition du pont tRPC over IPC (via `contextBridge`)
- GlobalShortcut pour la capture rapide
- electron-updater (vérification des mises à jour)
- Titlebar custom (Linear/Notion style)

**Dépendances clés :** `electron`, `@supernote/ipc`, `@supernote/core`, `@supernote/db`

---

### `apps/web`

**Rôle :** Renderer Next.js 15 (App Router, client components uniquement, static export).

RSC désactivé (pas de serveur dans Electron). Toutes les pages sont des Client Components.

**Dépendances clés :** `next`, `react`, `@supernote/ui`, `@supernote/editor`, `@supernote/canvas`, `@supernote/views`, `@supernote/ipc`

---

## Packages core

### `@supernote/core`

**Rôle :** Logic pure sans dépendances Electron ou React. Peut tourner dans n'importe quel contexte (main, worker, renderer, tests).

Contenu :
- Types TypeScript centraux (`Entity`, `EntityType`, `Field`, `RelationType`, `RelationEdge`, etc.)
- Schema Engine : validation Zod des frontmatters, auto-fix proposals
- Markdown parser (remark/unified) : parse `.md` → AST → extraire mentions/tags/links
- Query language : parser + évaluateur des filtres/tris
- Utilitaires : ULID, dates, path normalization

**Dépendances :** zod, remark, unified, gray-matter, ulid

---

### `@supernote/db`

**Rôle :** Prisma schema + client typé + migrations.

Contenu :
- `schema.prisma` : toutes les tables (`Entity`, `EntityType`, `Field`, `RelationType`, `RelationEdge`, `Tag`, `Mention`, `Embedding`, `Automation`, `AutomationRun`, `View`, `Template`, `Plugin`, `Setting`, `GitCommit`, `Workflow`)
- Client Prisma généré (better-sqlite3 driver)
- Migrations SQL
- Helpers de requêtes fréquentes
- FTS5 virtual table setup + triggers (sync auto)
- `PRAGMA user_version` management

**Dépendances :** `@prisma/client`, `prisma`, `better-sqlite3`

---

### `@supernote/ipc`

**Rôle :** Contrats tRPC pour toute communication renderer ↔ main.

Contenu :
- Routers tRPC : `entities`, `entityTypes`, `relations`, `search`, `views`, `automations`, `git`, `vault`, `settings`, `finance`, `plugins`, `ai`
- Types des inputs/outputs (Zod schemas)
- Helpers Result<T, E>

**Dépendances :** `@trpc/server`, `zod`, `@supernote/core`

Voir [IPC](ipc.md) pour le détail.

---

## Packages UI et éditeur

### `@supernote/ui`

**Rôle :** Design tokens et wrappers HeroUI v3 pour Supernote.

Contenu :
- Variables CSS (colors, spacing, typography)
- Composants wrappers HeroUI personnalisés
- Icônes Lucide centralisées
- Theming (light/dark/custom)

**Dépendances :** `@heroui/react`, `tailwindcss`, `lucide-react`, `motion`

---

### `@supernote/editor`

**Rôle :** Editeur de notes BlockNote avec tous les blocs custom.

Contenu :
- Configuration BlockNote avec extensions
- Blocs custom : `WikilinkBlock`, `MentionBlock`, `TagBlock`, `CalloutBlock`, `MermaidBlock`, `KaTeXBlock`, `ExcalidrawInlineBlock`, `CanvasInlineBlock`, `EntityCardBlock`, `QueryBlock`, `FormulaBlock`, `ButtonBlock`, `SyncedBlock`, `ImageBlock`, `AudioBlock`
- Slash menu étendu
- Sérialisation markdown propre (round-trip fidèle)
- Drag handle entre blocs

**Dépendances :** `@blocknote/react`, `@supernote/ui`, `@supernote/core`, `shiki` (code highlight), `katex`, `mermaid`

---

### `@supernote/canvas`

**Rôle :** Canvas spatial dual-mode (Excalidraw + React Flow).

Contenu :
- Composant `Canvas` principal (couches superposées)
- Nodes React Flow : `EntityCardNode`, `NoteEmbedNode`, `QueryNode`, `TextNode`, `MediaNode`, `IframeNode`
- Parser/serializer format `.canvas` (Obsidian-compat + extensions `sn-*`)
- Modale "type de relation" (création de RelationEdge depuis le canvas)
- Layouts auto (Dagre)
- Mode présentation

**Dépendances :** `@excalidraw/excalidraw`, `@xyflow/react`, `@supernote/ui`, `@supernote/core`

---

### `@supernote/views`

**Rôle :** Composants de vues React pour toutes les visualisations.

Contenu :
- `TableView` (TanStack Table + AG Grid pour gros volumes)
- `KanbanView` (drag entre colonnes)
- `GalleryView`
- `CalendarView`
- `TimelineView` (Gantt)
- `GraphView` (react-force-graph-2d)
- `MapView`
- `DashboardView` (widgets composables)

**Dépendances :** `@tanstack/react-table`, `ag-grid-community`, `react-force-graph-2d`, `@supernote/ui`, `@supernote/core`

---

## Packages logique métier

### `@supernote/search`

**Rôle :** Moteur de recherche full-text + sémantique + query language.

Contenu :
- FTS5 wrapper (trigram tokenizer) — requêtes synchrones
- Semantic search (ONNX/transformers.js, `all-MiniLM-L6-v2`) — async, worker-safe
- Query language parser/évaluateur : `type:`, `tag:`, `field:`, `path:`, `relation:`, `created:`, `modified:`
- Hybrid search : FTS results + semantic reranking
- Exports : `./fts`, `./semantic`, `./query`

**Dépendances :** `@supernote/core`, `better-sqlite3`, `@huggingface/transformers` (peer, optional)

---

### `@supernote/formulas`

**Rôle :** Langage de formule Coda-like.

Contenu :
- Parser Lezer (grammaire custom)
- AST des expressions
- Evaluateur : opérateurs math/string/date, agrégats (SUM, AVG, COUNT, MIN, MAX), accès aux champs d'entité, lookups de relations
- Stdlib : `filter()`, `map()`, `sort()`, `unique()`, `format()`, `dateAdd()`, `now()`, `if()`, etc.
- Formules nommées globales (réutilisables)

**Dépendances :** `@lezer/common`, `@supernote/core`

---

### `@supernote/automations`

**Rôle :** Engine de triggers, conditions et actions pour routines et automations.

Contenu :
- Parser de DSL YAML (routines/automations)
- Scheduler cron (`node-cron`)
- Alarm manager (alarmes sur champs date)
- Event bus (triggers entity.created, entity.updated, workflow.transition)
- Runner d'actions : create_note, create_entity, update_entity, notification_os, notification_inapp, draft_email, webhook, llm_prompt, js_script
- Logs dans `AutomationRun`

**Dépendances :** `@supernote/core`, `@supernote/db`, `@supernote/notifications`, `node-cron`

---

### `@supernote/ai`

**Rôle :** Bridge Ollama + auto-tagging + classifieur + extraction d'actions.

Contenu :
- `OllamaBridge` : détection auto du daemon, sélection de modèle, prompt templates
- `AutoTagger` : propose des tags (Ollama si dispo, fallback embeddings cosine)
- `EntityClassifier` : suggère le type d'entité pour une note
- `MentionDetector` : détecte les entités implicitement mentionnées
- `ActionExtractor` : extrait les TODO/actions depuis une note de réunion
- RAG pipeline : "Ask my notes" (FTS + embeddings → context → Ollama)

**Dépendances :** `@supernote/core`, `@supernote/search`, `@supernote/db`, `pino`

---

### `@supernote/finance`

**Rôle :** Module finance — pricing live, amortissement, snapshots.

Contenu :
- Seeds EntityType : Account, Asset, Loan, Snapshot, Goal
- Pricing engine : `StockPricer` (yahoo-finance2), `CryptoPricer` (CoinGecko), `ForexConverter`
- Cache TTL (15min intraday, 24h quotidien)
- Amortissement : calcul de tableau d'amortissement depuis Loan fields
- Snapshot engine : freeze toutes les valeurs courantes

**Dépendances :** `@supernote/core`, `@supernote/db`, `yahoo-finance2`

---

### `@supernote/git`

**Rôle :** Wrappers isomorphic-git pour versioning automatique.

Contenu :
- `GitManager` : init, auto-commit debounced, branches scratch, restore par entité
- `RemoteSync` : push/pull vers remote (HTTPS/SSH)
- Logs `GitCommit` par entité

**Dépendances :** `@supernote/core`, `isomorphic-git`, `pino`

---

### `@supernote/templates`

**Rôle :** Engine de templates pour notes et entités.

Contenu :
- Parser de templates (variables `{{field}}`, blocs conditionnels, boucles)
- Seeds templates : Daily, Interaction, Réunion, Rapport hebdo
- Template picker UI

**Dépendances :** `@supernote/core`

---

## Packages systèmes

### `@supernote/notifications`

**Rôle :** Notifications OS + in-app (toast persistant).

Contenu :
- `NotificationService` : bridge vers Electron Notification API (OS)
- Centre de notifications in-app (React, avec badge et liste)
- Types partagés : `Notification`, `NotificationAction`

**Dépendances :** `@supernote/core`, `nanoid`

---

### `@supernote/api`

**Rôle :** Serveur HTTP local (`127.0.0.1:PORT`) + MCP server.

Contenu :
- Serveur HTTP REST + WebSocket (événements)
- Token d'authentification par session
- Endpoints : `/entities`, `/search`, `/query`, `/vault`
- MCP server : permet à un LLM externe de manipuler le vault

**Dépendances :** `@supernote/core`, `@supernote/db`, `@supernote/ipc`

---

### `@supernote/cli`

**Rôle :** CLI compagnon `supernote`.

Contenu :
- `supernote new "titre"` — crée une note dans l'Inbox
- `supernote search <query>` — recherche dans le vault
- `supernote query --type Personne --filter "..."` — requête structurée
- `supernote export <id>` — exporte une entité
- Communication avec l'app via Unix socket local

**Dépendances :** `@supernote/core`, `commander`, `chalk`, `ora`

---

### `@supernote/plugin-sdk`

**Rôle :** API et types pour les plugins tiers.

Contenu :
- Interface `SupernotePlugin` (base class avec auto-cleanup)
- Types de l'API postMessage (requêtes/réponses typées)
- Helpers : `registerBlock`, `registerCommand`, `registerSidebarPanel`, `onBeforeSave`, `storage.get/set`
- Manifest types et validation

**Dépendances :** `@supernote/core`, `zod`

---

### `@supernote/import`

**Rôle :** Importeurs depuis sources externes.

Contenu :
- `NotionImporter` : ZIP Notion → Notes + EntityTypes
- `ObsidianImporter` : vault Obsidian → notes natives
- `VCardImporter` : `.vcf` → Personnes
- `OFXImporter` : `.ofx`/`.qfx` → transactions Account
- `CSVImporter` : configurable par colonnes

**Dépendances :** `@supernote/core`, `@supernote/db`

---

### `@supernote/ocr`

**Rôle :** OCR local sur images.

Contenu :
- `OcrEngine` : wrapper Tesseract.js (WASM)
- Intégration dans le pipeline image (auto-trigger à l'insertion d'image)

**Dépendances :** `tesseract.js`

---

### `@supernote/voice`

**Rôle :** Transcription audio locale.

Contenu :
- `VoiceTranscriber` : wrapper whisper.cpp (WASM)
- Modèles disponibles : tiny, base, small
- Intégration dans le bloc Audio de l'éditeur

**Dépendances :** `@xenova/whisper` ou whisper.cpp WASM

---

## Packages utilitaires

### `@supernote/tsconfig`

Config TypeScript partagée (strict, paths, target ES2022).

### `@supernote/eslint-config`

Config ESLint partagée (TypeScript strict, import order, unicorn).
