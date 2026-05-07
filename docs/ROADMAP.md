# Roadmap Supernote

Supernote se construit en itérations agiles. Voici l'état du backlog au 2026-05-07.

---

## v0.1 — Alpha (monorepo structuré, foundations)

Ce qui est en place ou à finaliser pour une première alpha fonctionnelle.

### Infrastructure
- [x] Monorepo pnpm + Turborepo configuré
- [x] 22 packages scaffoldés avec leurs `package.json` et descriptions
- [x] TypeScript strict + ESLint partagé
- [x] Vitest configuré sur tous les packages
- [ ] Prisma schema complet + migrations initiales
- [ ] Client Prisma + helpers de requêtes
- [ ] FTS5 virtual table avec trigram tokenizer + triggers SQL
- [ ] `PRAGMA user_version` + migration runner

### Vault et filesystem
- [ ] `VaultManager` : init, multi-vault, chemin par défaut OS
- [ ] `FileIO` : lecture/écriture atomique (temp file + rename)
- [ ] `FileWatcher` (chokidar) : events → reindex incrémental
- [ ] `lock.json` : verrou multi-machine avec TTL + heartbeat
- [ ] Indexeur : reconstruction complète au lancement
- [ ] Post-save pipeline (worker thread) : AST parse → mentions → FTS → embeddings → formules → automations

### Core
- [ ] Types TypeScript centraux (Entity, EntityType, Field, RelationType…)
- [ ] Schema Engine : génération Zod dynamique + validation + auto-fix
- [ ] Query language : parser + évaluateur (`type:`, `tag:`, `field:`, `path:`, etc.)
- [ ] Markdown parser (remark/unified) : frontmatter + wikilinks + mentions + tags

### IPC
- [ ] tRPC over Electron IPC (preload + contextBridge)
- [ ] Routers : `entities`, `entityTypes`, `relations`, `search`, `views`, `vault`, `settings`
- [ ] Type `Result<T, E>` sur toutes les procédures

### Electron
- [ ] BrowserWindow + App Router Next.js
- [ ] Titlebar custom (Linear/Notion style) — macOS hiddenInset + Win/Linux custom
- [ ] GlobalShortcut capture rapide
- [ ] Premier lancement : vault par défaut `~/Documents/Supernote/`

### Editeur
- [ ] BlockNote configuré avec extensions de base
- [ ] Blocs custom : WikilinkBlock, MentionBlock, TagBlock, CalloutBlock
- [ ] Slash menu `/` avec autocomplétion
- [ ] Sérialisation markdown propre (round-trip)
- [ ] Drag handle entre blocs
- [ ] Sauvegarde auto (debounce 500ms)

### CRM seeds
- [ ] EntityTypes seed : Personne, Organisation, Projet, Interaction
- [ ] Champs par défaut de chaque seed
- [ ] Relations seed : organisation↔personne, projet↔personne, interaction↔personne

### UI de base
- [ ] Sidebar : vault switcher, navigation par type, tags, vues
- [ ] Quick switcher `Cmd+K`
- [ ] Panneau droit : backlinks, propriétés
- [ ] Vue Table (TanStack Table) sur les EntityTypes

### Recherche
- [ ] Recherche FTS5 (trigram) — rapide et synchrone
- [ ] Embeddings ONNX `all-MiniLM-L6-v2` dans worker thread
- [ ] Barre de recherche avancée avec opérateurs

### Git
- [ ] Init git auto dans le vault
- [ ] Commits auto debouncés (5 min)
- [ ] Historique par entité dans le panneau droit

---

## v0.2 — Beta (toutes les features planifiées)

### Editeur avancé
- [ ] MermaidBlock, KaTeXBlock, ExcalidrawInlineBlock
- [ ] EntityCardBlock, QueryBlock, FormulaBlock, ButtonBlock
- [ ] SyncedBlock (bloc partagé entre notes)
- [ ] ImageBlock avec OCR auto (Tesseract.js)
- [ ] AudioBlock avec transcription (whisper.cpp)
- [ ] Drag de blocs entre notes (onglets)
- [ ] Transclusion `![[note]]`

### Canvas
- [ ] Composant Canvas principal (Excalidraw + React Flow superposés)
- [ ] Nodes : EntityCardNode, NoteEmbedNode, QueryNode, TextNode
- [ ] Modale "type de relation" à la connexion de deux EntityCards
- [ ] Sérialisation `.canvas` compatible Obsidian (nodes `sn-*`)
- [ ] Layout auto Dagre, mini-map, mode présentation
- [ ] Canvas inline dans l'éditeur (`/canvas`)

### Knowledge Graph
- [ ] Vue Graph (react-force-graph-2d)
- [ ] Filtres par type / tag / profondeur
- [ ] WebGL fallback pour vaults >5000 entités

### Vues
- [ ] KanbanView (drag entre colonnes)
- [ ] GalleryView
- [ ] CalendarView
- [ ] TimelineView (Gantt)
- [ ] MapView (champs géo)
- [ ] DashboardView (widgets composables)
- [ ] Filtres composés + tris + groupements
- [ ] Sauvegarde des vues dans `.supernote/views/`

### Schema Editor
- [ ] Page "Schémas" : liste EntityTypes, créer/éditer/dupliquer
- [ ] Drag-drop des champs avec preview live
- [ ] Workflows : états + transitions
- [ ] Validations par champ
- [ ] Visualisation React Flow des types et relations

### Finance
- [ ] EntityTypes seed finance : Account, Asset, Loan, Snapshot, Goal
- [ ] Pricing engine : stocks (yahoo-finance2), crypto (CoinGecko), forex
- [ ] Cache TTL (15min/24h)
- [ ] Calcul d'amortissement (Loan → table dans un Query block)
- [ ] Dashboard Finance (metric cards + chart)
- [ ] Toutes les vues Finance (Comptes, Actifs, Loans, Snapshots, Goals)
- [ ] Import OFX/CSV

### Formules
- [ ] Parser Lezer (grammaire custom)
- [ ] Evaluateur : math, dates, strings, agrégats, accès aux champs d'entité
- [ ] Recalcul à la sauvegarde (dépendances)
- [ ] Formules nommées globales

### Automations et routines
- [ ] DSL YAML (routines/automations)
- [ ] Scheduler cron (node-cron)
- [ ] Alarm manager (champs date)
- [ ] Actions : create_note, create_entity, notification_os, notification_inapp, draft_email, webhook, llm_prompt, js_script
- [ ] 4 routines seed installées au premier lancement
- [ ] UI no-code (builder visuel de routines)
- [ ] Dashboard Routines (prochaines exécutions + logs)
- [ ] Table `AutomationRun`

### IA
- [ ] Bridge Ollama (détection auto, sélection de modèle)
- [ ] Auto-tagging proactif (Ollama + fallback cosine)
- [ ] Détection de mentions implicites
- [ ] Extraction d'actions depuis notes de réunion
- [ ] Auto-classification
- [ ] "Ask my notes" RAG (FTS + embeddings → Ollama)
- [ ] Actions LLM contextuelles (résumer, réécrire, traduire, etc.)
- [ ] Transcription vocale (whisper.cpp WASM)
- [ ] OCR images (Tesseract.js)

### Sync
- [ ] Sync git remote (push/pull auto)
- [ ] Résolution de conflits git (diff UI)
- [ ] Restauration par entité (git restore)
- [ ] Documentation Syncthing

### Import / Export
- [ ] NotionImporter (ZIP → Notes + EntityTypes)
- [ ] ObsidianImporter (vault → native)
- [ ] VCardImporter (`.vcf` → Personnes)
- [ ] Export PDF, HTML, CSV, JSON
- [ ] Import thèmes Obsidian

### Plugins
- [ ] Sandbox iframe + postMessage protocol
- [ ] Plugin SDK (`@supernote/plugin-sdk`) avec auto-cleanup
- [ ] Plugin manifest avec `minSupernoteVersion`
- [ ] API plugin : registerBlock, registerCommand, registerSidebarPanel, hooks, storage
- [ ] Plugin loader + gestion des permissions
- [ ] Settings > Plugins (liste, activer/désactiver, désinstaller)

### CLI et API locale
- [ ] CLI `supernote new|search|query|export`
- [ ] Serveur HTTP local (`127.0.0.1:PORT`)
- [ ] MCP server intégré

### Multi-vault
- [ ] Plusieurs vaults ouverts en navigation (sidebar)
- [ ] Vault switcher complet

---

## v1.0 — Production-ready

### Qualité et polish
- [ ] Couverture de tests : 90%+ sur core/formulas, 80%+ sur db/automations
- [ ] E2E Playwright Electron : tous les flows principaux couverts
- [ ] Performance : vault 10k entités < 200ms pour la recherche FTS
- [ ] Performance : rendu du Knowledge Graph fluide à 5000 noeuds (WebGL)
- [ ] Audit de sécurité du sandbox plugin (iframe isolation)
- [ ] Audit des permissions plugin

### Distribution
- [ ] Signature de code macOS (notarisation Apple)
- [ ] Signature de code Windows (certificat EV)
- [ ] Auto-update via electron-updater + GitHub Releases
- [ ] Linux : AppImage + .deb packagés et testés
- [ ] Rollback de version sécurisé (migrations DB additives seulement)

### UX
- [ ] Onboarding amélioré (tour interactif au premier lancement)
- [ ] Thèmes supplémentaires (3-5 thèmes intégrés)
- [ ] Accessibilité (ARIA, navigation clavier complète)
- [ ] i18n : structure en place pour traductions futures (défaut : français)
- [ ] Personnalisation des raccourcis clavier
- [ ] Import Obsidian themes (compat maximale)

### Stabilité
- [ ] Crash reporter local (sans envoi distant)
- [ ] Gestion de la corruption DB : détection + reindex auto + notification utilisateur
- [ ] Lock file robuste : TTL + heartbeat + recovery sur crash
- [ ] Gestion des vaults > 50k entités (pagination lazy dans toutes les vues)

### Documentation
- [x] Documentation utilisateur complète
- [x] Documentation développeur complète
- [ ] Plugin SDK documentation (site dédié ou section enrichie)
- [ ] Screencast d'introduction (YouTube)

---

## Post-v1.0 (backlog non daté)

- Plugin Marketplace public (registry git)
- Mobile (iOS/Android) — projet séparé
- Collaboration temps réel (CRDT) — projet séparé si demande
- Sync natif cloud (optionnel, self-hosted) — projet séparé
- Capture par email (IMAP poll)
- Intégration Cal.com / Google Calendar (lecture only)
- Voice-to-note depuis l'iOS Shortcuts
- Export vers Notion (API)
- Tableau de bord analytics vault (stats de notes, activité, tags populaires)
