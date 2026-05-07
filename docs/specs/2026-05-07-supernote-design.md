# Supernote — Design Spec (version finale ambitieuse)

**Statut :** approuvé (itération agile IA × humain)
**Date :** 2026-05-07
**Cible :** version finale directement, sans MVP intermédiaire

## 1. Vision

Un **système de connaissance + CRM personnel** local-first, packagé Electron, qui vise la rencontre de :
- **Tolaria** — pureté du markdown filesystem.
- **Notion** — pages, blocs, bases de données flexibles, vues multiples.
- **Coda** — formules first-class, automations, "docs comme apps".
- **Salesforce** — CRM puissant, objets custom, workflows, validations, rapports/dashboards.
- **AnyType / Tana** — schéma 100% dynamique, tout est entité typée, graphe de relations.
- **Obsidian** — backlinks, transclusion, canvas, knowledge graph, interop fichier.

Ambition : un seul outil pour ses notes, sa connaissance, ses relations, ses projets, ses workflows. Tout est entité typée, tout est connecté, tout est requêtable, tout reste sur ton disque en markdown.

## 2. Principes architecturants

1. **Local-first absolu.** Aucun serveur, aucune télémétrie, aucun cloud requis.
2. **Filesystem = source de vérité.** SQLite = index reconstructible.
3. **Markdown interopérable.** Lisible/éditable depuis VS Code, Obsidian, n'importe quel éditeur. Format `.canvas` Obsidian-compatible.
4. **Tout est entité typée.** Notes incluses. Schéma 100% utilisateur, seeds modifiables.
5. **Tout est requêtable.** Langage de requête riche, formules Coda-like, vues sauvegardables.
6. **Tout est connecté.** Wikilinks, mentions, embeds, relations typées, graphe global.
7. **Type-safe end-to-end.** TypeScript strict, tRPC over IPC, Zod runtime validation.
8. **Programmable.** CLI, API locale HTTP, plugin sandbox, formules, automations.

## 3. Stack technique

| Couche | Choix | Note |
|---|---|---|
| Wrapper desktop | **Electron 33** | Demandé. Chromium-only assumé. |
| App | **Next.js 15** (App Router, client components, static export) + **React 19** + **TypeScript strict** | RSC désactivé (Electron = client). |
| DB | **SQLite** (better-sqlite3) + **Prisma 6** | Embed simple, performant. |
| Runtime validation | **Zod 4** | Pour tout I/O et schémas dynamiques. |
| Éditeur | **BlockNote** (Tiptap/ProseMirror) avec extensions custom | Block-based natif, on étend largement. |
| Canvas | **Excalidraw** (`@excalidraw/excalidraw`) + **React Flow** (`@xyflow/react`) en overlay | Dessin libre + nodes typés. |
| Graph view | **react-force-graph-2d** (+ option WebGL pour très gros vaults) | Knowledge graph global. |
| Tableurs | **TanStack Table** + **AG Grid Community** (vue Database lourde) | Composables avec HeroUI Table pour les vues simples. |
| UI | **HeroUI v3** (sur Tailwind v4) + **Lucide** | Lib UI moderne, composants riches, outils IA HeroUI pour génération de designs. |
| Animations | **Motion** (ex Framer Motion) | Micro-interactions polies. |
| State | **Zustand** + **TanStack Query** | Léger. |
| Forms | **React Hook Form** + **Zod resolvers** | Auto-form depuis schéma. |
| IPC | **tRPC over Electron IPC** | Type-safe end-to-end. |
| File watcher | **chokidar** | Standard. |
| Markdown | **remark/unified** + **gray-matter** + **mdast-util-from-markdown** | AST extensible. |
| Search FTS | **SQLite FTS5** | Natif, ultra rapide. |
| Search sémantique | **transformers.js** + ONNX `Xenova/all-MiniLM-L6-v2` (intégré dès le départ) | 100% local, dans le main process. |
| IA générative locale | **Ollama** (intégration optionnelle, détection auto) | Résumés, suggestions, RAG. |
| Voice / OCR | **whisper.cpp** WASM + **Tesseract.js** | Transcription voix + OCR images. |
| Versioning | **isomorphic-git** | Historique auto, sync remote git. |
| Sync collab | **Yjs** + **y-indexeddb** + **y-webrtc** (optionnel) | CRDT pour collab inter-appareils si activé. |
| Crypto | **age** (via `age-encryption` npm) | Vaults chiffrés au repos (config par dossier). |
| Plugins | **VM2 / iframe-sandbox** | Sandbox plugin tiers. |
| Formules | **Lezer** + parser custom | Langage de formule type Coda. |
| Automations | **node-cron** + **EventEmitter** + DSL custom | Workflows déclaratifs. |
| Tests | **Vitest** (unit/integration) + **Playwright Electron** (E2E) | |
| Build | **electron-builder** + **Turborepo** + **pnpm** | Monorepo. |
| Logs | **pino** + **pino-pretty** | Structurés. |
| Theming | **CSS variables** + **theme bundles** + **import Obsidian themes** | Customisation avancée. |

## 4. Architecture en couches

```
┌──────────────────────────────────────────────────┐
│  RENDERER (Next.js / React 19)                   │
│   UI · Editor · Canvas · Schema Editor · Views   │
│   Plugin host (iframe sandbox)                   │
└──────────────┬───────────────────────────────────┘
               │ tRPC over IPC
┌──────────────▼───────────────────────────────────┐
│  MAIN (Electron + Node)                          │
│   FileIO · Watcher · Prisma · Git · Schema engine│
│   Indexer · Search · Embeddings · Formulas       │
│   Automations engine · LLM bridge (Ollama)       │
│   Local HTTP API · CLI bridge · Plugin loader    │
└──────────────┬───────────────────────────────────┘
               │
        ┌──────┴───────┐
     ┌──▼──┐         ┌─▼─────┐
     │Disk │         │SQLite │
     │ .md │         │ index │
     │.canvas        │ FTS5  │
     │.ag  (chiffré) │ vec   │
     └─────┘         └───────┘
```

## 5. Layout filesystem (vault)

```
~/Notes/                          # vault root configurable, multi-vault possible
├── .supernote/
│   ├── schemas/                  # définitions de types (JSON)
│   ├── relations/                # définitions des RelationTypes
│   ├── views/                    # vues sauvegardées (sql-like JSON)
│   ├── templates/                # templates de notes/entités
│   ├── automations/              # workflows déclaratifs
│   ├── formulas/                 # formules nommées partagées
│   ├── plugins/                  # plugins installés
│   ├── themes/                   # thèmes CSS custom
│   ├── settings.json
│   └── index.db                  # SQLite (peut être hors vault)
├── _assets/                      # images, fichiers binaires liés
├── Inbox/                        # capture rapide
├── Daily/YYYY/MM-DD.md           # journal quotidien
├── Notes/                        # zone libre
├── Contacts/                     # type=Personne par défaut
├── Organisations/
├── Projets/
└── Vault.private/                # dossier chiffré age (exemple)
```

### Format d'une entité (`.md`)

```yaml
---
id: 01HX2K...                     # ULID stable, jamais visible UI
type: personne
created: 2026-05-07T12:00:00Z
updated: 2026-05-07T13:24:00Z
fields:
  name: Jean Dupont
  email: [jean@example.com]
  birthday: 1985-03-12
  employer: "[[01HX...]]"
tags: [client/important, "2026"]
---

Body markdown libre, blocs BlockNote sérialisés.
```

### Canvas (`.canvas`)
JSON Obsidian-compatible étendu (type `crm` ignoré gracieusement par Obsidian).

## 6. Data model (Prisma)

### Entités noyau
- **Vault** — répertoire racine. Multi-vault supporté.
- **EntityType** — schéma défini par l'utilisateur (name, plural, icon, color, fields[], defaultPath, fileNamePattern, defaultView, validations[], workflows[]).
- **Field** — type, options, default, required, unique, validation, helpText, group.
- **RelationType** — arête typée (forwardLabel, inverseLabel, sourceTypeId, targetTypeId, cardinality, fields[]).
- **Entity** — instance (id ULID, typeId, filePath, fields JSON, body, fileHash, AST cache, embedding vector, lastEditedBy).
- **RelationEdge** — instance de relation (sourceId, targetId, relationTypeId, fields, createdAt).
- **Tag** — hiérarchique (`client/important`, `client/prospect`).
- **EntityTag** — m2m.
- **Mention** — wikilink/embed/mention/tag détectés dans le body.
- **FtsIndex** — table virtuelle FTS5.
- **Embedding** — vecteurs ONNX (table sqlite-vec ou JSON BLOB).
- **GitCommit** — pointer commits git par entité.
- **View** — vue sauvegardée (filtres, tri, group, columns).
- **Template** — template d'entité.
- **Automation** — règle déclarative (trigger, conditions, actions).
- **Formula** — formule nommée réutilisable.
- **Workflow** — états + transitions par EntityType.
- **AutomationRun** — historique d'exécution.
- **Plugin** — plugin installé (manifest, permissions accordées).
- **Setting** — k/v.

### Field types complets
text, longtext, number, currency, percent, rating, progress, date, datetime, duration, bool, url, email, phone, select (mono/multi avec options colorées), file, image, color, markdown, **relation** (vers EntityType, cardinalité 1/n/m, avec champs portés), **formula** (expression évaluée), **rollup** (agrégat sur relation), **lookup** (champ d'une entité reliée), **createdAt/updatedAt/createdBy** (auto), **autoNumber**, **status** (workflow lié).

**Notes = un EntityType** (pas un concept séparé).

## 7. Modules majeurs

### 7.1 Vault & Filesystem (main)
VaultManager (multi-vault), FileWatcher (chokidar), FileIO (write atomique avec lock), SchemaEngine (validation Zod sur le frontmatter, auto-fix proposals quand schéma migre).

### 7.2 Indexer (main)
- Reconstruction complète au lancement / vault changé.
- Sync incrémental par events watcher (debounce 100ms).
- Calcule mentions, backlinks, tags, FTS, embeddings sémantiques.
- Worker thread dédié pour ne pas bloquer l'UI.

### 7.3 Editor (renderer, BlockNote étendu)
**Custom blocks dès le départ :**
- Wikilink, Embed (transclusion), Mention, Tag
- Callout (info/note/warning/danger/quote, custom callouts user-defined)
- Mermaid, KaTeX (inline + block), PlantUML, Excalidraw inline
- Mini-canvas inline (point d'entrée canvas full)
- **Entity card** (carte compacte d'une entité, inline ou block)
- **Query block** — résultat live d'une requête, vue table/list/gallery/kanban/calendar/timeline
- **Formula block** — calcul live (à la Coda), basé sur les entités
- **Button block** — déclenche une automation au clic
- Code (shiki) + bouton "run" pour JS/TS/Python via worker
- Image (drag-drop, copy-paste, stockée en `_assets/`, OCR auto optionnel)
- Audio (drag-drop voice memo, transcription whisper.cpp auto)
- Video, fichier générique
- Toggle, checklist (avec assignations possibles à @personne)
- Table markdown éditable avec types par colonne
- Synced block (édité dans une note, affiché dans plusieurs)

Slash commands `/` riches, drag handle (drag bloc entre notes), sérialisation markdown propre.

### 7.4 Canvas (full + inline)
- Excalidraw (couche dessin libre, formes, freehand, sticky notes, flèches manuelles)
- React Flow (couche nodes typés en overlay) :
  - `EntityCard`, `NoteEmbed`, `QueryNode`, `TextNode`, `MediaNode`, `IframeNode`
- Une flèche entre 2 EntityCard ouvre une modale "type de relation" → crée un `RelationEdge` réel persisté en frontmatter.
- Frames groupes, layouts auto (Dagre), mini-map, présentation mode.
- Format `.canvas` Obsidian-compat avec extensions `crm`, `query`, `formula`.

### 7.5 Schema Editor (renderer)
- Page "Schémas" : liste des EntityTypes, créer/éditer/dupliquer/exporter.
- Éditeur de fields drag-drop avec preview live.
- Éditeur de relations : visualisation React Flow des types et leurs liens.
- **Validation rules** par champ (ex : email valide, date future, etc.).
- **Workflows** : états (draft, in_review, published) + transitions + actions associées.
- **Permissions par champ** (lecture/écriture, conditionnelles).

### 7.6 Vues
Sur tout type ou résultat de requête :
- **Table** (TanStack Table + AG Grid pour gros volume) avec édition inline
- **Kanban** (drag entre colonnes = transition workflow)
- **Galerie** (grandes cartes, optimisée pour images)
- **Calendrier** (sur n'importe quel champ date)
- **Timeline / Gantt** (champs début + fin)
- **Graph** (force-directed)
- **Map** (champs géo / coordonnées extraites adresse)
- **Dashboard** (composé de widgets : metric, chart, query block, list)

Configurables : colonnes, tri, groupement, filtres composés, formules. Persistées dans `.supernote/views/`.

### 7.7 Recherche
- `Cmd+K` quick switcher : entités, tags, types, vues, actions, commandes.
- `Cmd+Shift+F` recherche full-text + filtres : `path: type: tag: field: created: modified: relation: in:` etc.
- **Recherche sémantique active dès le départ** (embeddings ONNX dans worker).
- Hybrid search (FTS + sémantique reranké).
- "Ask my notes" : RAG local avec Ollama si dispo.

### 7.8 Formules (Coda-like)
- Langage propre, parser Lezer.
- Champs formula et rollup recalculés à la sauvegarde.
- Lib stdlib : math, dates, strings, listes, agrégats sur relations.
- Formules nommées globales (réutilisables).
- Inline dans le markdown (`{{ formula:... }}`).

### 7.9 Automations & Routines
- DSL déclaratif YAML stocké dans `.supernote/automations/` et `.supernote/routines/`.
- **Distinction** :
  - **Automation** = règle réactive (déclenchée par un event entité/workflow).
  - **Routine** = règle proactive nommée et gérée par l'utilisateur (cron, alarmes, envois récurrents). Routines = automations avec UI dédiée et concept "user-friendly".
- **Triggers** :
  - Évent : création/édition/suppression d'entité, transition workflow.
  - **Cron** : crontab-like ("tous les lundi à 9h", "le 1er du mois", "tous les 14 jours"). UI builder pour exprimer la récurrence en langage naturel.
  - **Alarme** : déclenchement à une date/heure absolue (extraite d'un champ d'entité, ex. `birthday`, `deadline`).
  - Webhook / API local.
- **Conditions** : expressions formula.
- **Actions** :
  - Créer / mettre à jour entité / créer relation
  - **Envoyer email** (SMTP configuré dans settings, ou Resend/SendGrid si clé fournie) — destinataire = champ d'entité (ex. `email` d'une Personne du CRM), template avec variables, support pièces jointes (depuis `_assets/` ou exports d'entité)
  - **Notification OS** (alarme, rappel)
  - **Notification in-app** (toast persistant dans un centre de notifications)
  - Appeler webhook
  - Exécuter prompt LLM (Ollama)
  - Lancer script JS sandboxé
  - **Créer une note dans Inbox** ("rappel : voir avec Jean")
- **Templates de routines** prêts à l'emploi :
  - "Email hebdo à un contact" (cron weekly + action email)
  - "Rappel anniversaire" (alarme sur champ `birthday` d'une Personne)
  - "Suivi client à 30 jours" (cron + condition `lastInteraction < 30j`)
  - "Brief du lundi matin" (cron + LLM + email à soi-même)
- Logs d'exécution dans la table `AutomationRun` (succès/échec/payload/durée).
- UI no-code (à la Notion/Make/Zapier) pour créer/éditer.
- Tableau de bord "Routines" pour voir les prochaines exécutions.

### 7.10 Versioning
- isomorphic-git initialise le vault.
- Commits auto debouncés (5 min).
- Branches "scratch" pour brouillons.
- Restore par entité.
- Sync optionnelle avec remote (HTTPS/SSH via signed URL ou key).

### 7.11 IA
- **Embeddings locaux** dès le départ (transformers.js worker).
- **Pont Ollama** : détection auto du daemon local, modèles dispo listés.
- Actions LLM contextuelles : "résumer", "extraire actions", "réécrire", "traduire", "tagger auto", "suggérer entités à mentionner".
- "Ask my notes" RAG.
- Voice notes → transcription whisper.cpp local → markdown.
- OCR (Tesseract.js) sur images collées.

### 7.12 Capture rapide / quotidien
- Raccourci OS global (`globalShortcut`) → modale capture.
- Ligne de commande `supernote new "..."` (CLI bridge sur Unix socket).
- Capture par email (alias local + IMAP poll optionnel, v2).
- Type seed `Daily`, bouton "Aujourd'hui".

### 7.13 Plugins
- Manifest JSON, code JS sandboxé (iframe avec API postMessage typée).
- API plugin : enregistrer block custom, action de slash menu, command palette, view, panneau sidebar, pré/post-hooks de save.
- Permissions explicites (lecture/écriture entités, FS, réseau).
- Marketplace local-first (registry git public à v2).

### 7.14 API & CLI
- HTTP API locale sur `127.0.0.1:port` (port aléatoire, token par session).
- Endpoints REST + WebSocket pour subscribe.
- **MCP server intégré** pour permettre à un LLM externe de manipuler le vault.
- CLI compagnon : `supernote new`, `supernote search`, `supernote query`, `supernote export`.

### 7.15 Sécurité & vie privée
- 100% local par défaut, zéro télémétrie.
- Vault chiffré (age) optionnel par dossier.
- Verrouillage app par mot de passe (vault chiffré).
- Audit log local.

### 7.16 Theming
- CSS variables propres pour tout.
- Themes intégrés (light, dark, custom moods).
- **Import Obsidian themes** (compat partielle, best-effort).

## 8. Data flows critiques

### Édition d'une note
```
User édite (BlockNote) → debounce 500ms → tRPC.entities.save
  → Main : write atomic + update Entity + parse AST
  → reindex Mentions/Tags/FTS, recompute embeddings (worker)
  → recompute formulas/rollups dépendants
  → trigger automations applicables
  → push event renderer
```

### Modif externe (VS Code, Obsidian)
```
chokidar event → Main hash + compare → reparse + update DB
  → resolve conflict UI si fichier ouvert + diff
```

### Création de relation depuis canvas
```
React Flow onConnect → modale "type de relation" filtrée
  → tRPC.relations.create
  → Main crée RelationEdge + maj frontmatter des 2 entités
  → recompute rollups/formulas dépendants
  → refresh canvas + graph view
```

### Automation
```
Event (entité.created) → matcher triggers → eval conditions
  → exécute actions séquentielles dans worker
  → log AutomationRun
```

## 9. Gestion d'erreurs

- IPC = `Result<T, E>` typé (pas d'exceptions à travers le pont).
- Conflit FS → modal diff manuel.
- Schéma cassé sur entité existante → bandeau warning + action "rectifier".
- Logs `pino` structurés dans userData.
- Crash reporter local (pas d'envoi distant).

## 10. Tests

- **Unit** Vitest : parsing, schema engine, formula parser/evaluator, query lang, indexer.
- **Integration** Vitest : pipeline file→DB, automations, sync git.
- **E2E** Playwright Electron : open vault, edit, search, schema editor, canvas, relation creation, automations.
- Fixture : mini-vault de test ~50 entités hétérogènes.

## 11. Structure du dépôt

Monorepo pnpm + Turborepo :

```
supernote/
├── apps/
│   ├── desktop/              # Electron main + preload
│   └── web/                  # Next.js renderer
├── packages/
│   ├── core/                 # parsing, schema, query lang, formulas (pure)
│   ├── db/                   # Prisma schema + migrations
│   ├── ipc/                  # tRPC contracts
│   ├── ui/                   # composants shadcn personnalisés
│   ├── editor/               # extensions BlockNote, blocks custom
│   ├── canvas/               # composants Excalidraw + React Flow
│   ├── automations/          # engine d'automations
│   ├── formulas/             # parser + evaluator formules
│   ├── search/               # FTS + sémantique
│   ├── git/                  # wrappers isomorphic-git
│   ├── plugin-sdk/           # API et types pour plugins
│   ├── tsconfig/
│   └── eslint-config/
├── docs/specs/
└── pnpm-workspace.yaml
```

## 12. Décisions ouvertes (à itérer pendant l'implémentation)

- Nom officiel du produit (working : "Supernote").
- Default vault path à la première ouverture.
- Window chrome custom (titlebar custom Linear-style) vs natif.
- Locale par défaut (FR).
- Auto-update intégré.
- Liste exacte des seed schemas et leurs fields (sera itérée par usage).
- Stratégie de chiffrement : passphrase par vault ou par dossier ?
- Mobile : PWA seule, ou companion natif Capacitor en parallèle ?
