# Architecture

## Vue d'ensemble des couches

```
┌──────────────────────────────────────────────────────────┐
│  RENDERER  (Next.js 15 App Router + React 19)            │
│                                                          │
│  ┌────────────┐  ┌──────────┐  ┌──────────┐             │
│  │  Editor    │  │  Views   │  │  Canvas  │             │
│  │ (BlockNote)│  │ (Table,  │  │(Excali + │             │
│  │            │  │  Kanban, │  │ ReactFlow│             │
│  │            │  │  Graph…) │  │          │             │
│  └────────────┘  └──────────┘  └──────────┘             │
│                                                          │
│  ┌────────────┐  ┌──────────┐  ┌──────────┐             │
│  │ Schema Ed. │  │ Routines │  │ Finance  │             │
│  │            │  │ Dashboard│  │ Dashboard│             │
│  └────────────┘  └──────────┘  └──────────┘             │
│                                                          │
│  Plugin host (iframe sandbox × n)                        │
│  Zustand stores · TanStack Query · React Hook Form       │
└──────────────────────┬───────────────────────────────────┘
                       │
             tRPC over Electron IPC
             (type-safe, Result<T,E>)
                       │
┌──────────────────────▼───────────────────────────────────┐
│  MAIN  (Electron + Node.js)                              │
│                                                          │
│  ┌────────────┐  ┌──────────┐  ┌──────────┐             │
│  │VaultManager│  │ Indexer  │  │  Schema  │             │
│  │FileIO      │  │ (worker) │  │  Engine  │             │
│  │FileWatcher │  │          │  │          │             │
│  └────────────┘  └──────────┘  └──────────┘             │
│                                                          │
│  ┌────────────┐  ┌──────────┐  ┌──────────┐             │
│  │  Git       │  │Automations│ │  Search  │             │
│  │ (iso-git)  │  │ Engine   │  │FTS+Embed │             │
│  └────────────┘  └──────────┘  └──────────┘             │
│                                                          │
│  ┌────────────┐  ┌──────────┐  ┌──────────┐             │
│  │ LLM Bridge │  │Local HTTP│  │  CLI     │             │
│  │  (Ollama)  │  │API + MCP │  │ Bridge   │             │
│  └────────────┘  └──────────┘  └──────────┘             │
│                                                          │
│  Plugin Loader (VM2 trusted / iframe untrusted)          │
└──────────────┬───────────────────────────────────────────┘
               │
        ┌──────┴──────┐
     ┌──▼──┐        ┌─▼──────┐
     │Disk │        │SQLite  │
     │ .md │        │index.db│
     │.canvas       │ FTS5   │
     │_assets/      │ Embed. │
     └─────┘        └────────┘
```

---

## Filesystem = source de vérité

C'est le principe central. Toutes les données "réelles" sont dans les fichiers `.md` et `.canvas` du vault. SQLite est un **index** :

- Si `index.db` est supprimé → Supernote reindex depuis les fichiers au prochain lancement
- Si un fichier est modifié par un éditeur externe → chokidar le détecte, la DB est mise à jour
- La portabilité du vault est totale : copie le dossier, ouvre-le sur une autre machine

La base SQLite contient :
- Index FTS5 des contenus (pour la recherche rapide)
- Embeddings sémantiques (vecteurs ONNX)
- Cache d'AST parsed (évite de re-parser à chaque requête)
- Mentions et backlinks extraits
- Résultats de formules (cache invalidé à chaque save)
- Vues sauvegardées, schémas, settings (miroir des fichiers JSON dans `.supernote/`)

---

## Post-save pipeline

Après chaque `prisma.entity.upsert`, un pipeline s'exécute dans un **worker thread dédié** :

```
Entity sauvée
     │
     ├─ 1. Parse AST (remark/unified)
     │       └─ extraire mentions, wikilinks, tags, block refs
     ├─ 2. Upsert table Mention + backlinks
     ├─ 3. Sync FTS5 (DELETE old / INSERT new via triggers SQL)
     ├─ 4. Recompute embeddings (si hash contenu changé)
     ├─ 5. Recompute formula fields et rollups dépendants
     └─ 6. Fire automations (triggers "entity.saved")
```

Chaque étape est idempotente. Si l'étape 4 échoue (ONNX non chargé), les étapes 5 et 6 continuent.

---

## IPC : tRPC over Electron IPC

```
Renderer                         Main
  │                                │
  ├─ trpc.entities.save(data) ────►├─ handler reçoit data Zod-validée
  │                                │   └─ writeAtomic() + pipeline
  ◄── Result<Entity, SaveError> ───┤
  │                                │
  ├─ trpc.entities.query(filter) ─►├─ requête SQLite + relations
  ◄── Result<Entity[], QueryError>─┤
```

Toutes les procédures retournent `Result<T, E>`. Le renderer ne voit jamais d'exception brute traverser l'IPC. Voir [IPC](ipc.md).

---

## Gestion des erreurs

| Situation | Comportement |
|---|---|
| IPC error | `Result.err(typed)` — le renderer affiche un message contextuel |
| Conflit FS | Modal diff côte à côte, choix utilisateur |
| Schema cassé sur entité | Bandeau warning + bouton "Rectifier" |
| DB corrompue | Supernote détecte à l'ouverture, supprime et reindex |
| Lock périmé | Avertissement + choix d'ouvrir quand même |
| Plugin crash | Erreur contenue dans l'iframe — Supernote inchangé |

---

## Threads et workers

| Thread | Responsabilité |
|---|---|
| Electron main thread | FileIO, orchestration, IPC handlers |
| Indexer worker | Parse AST, FTS sync, embeddings ONNX, formules |
| Automations worker | Évaluation et exécution des routines |
| Plugin threads | Un iframe par plugin (renderer) |

Le **worker de l'indexeur** n'importe jamais de modules React ou Electron renderer. Seules des dépendances Node.js pures sont autorisées.

---

## Flux data critiques

### Edition d'une note (renderer → disk → DB)

```
User tape dans BlockNote
  → debounce 500ms
  → trpc.entities.save(serialized)
  → Main: writeAtomic(filePath, content)
  → update prisma.entity (fields, body, fileHash)
  → post-save pipeline (worker)
  → push event → renderer (backlinks, tags mis à jour)
```

### Modification externe (VS Code, Obsidian)

```
chokidar 'change' event
  → Main: hash comparison (si même hash: ignore)
  → reparse frontmatter + body
  → update prisma.entity
  → post-save pipeline
  → si fichier ouvert dans éditeur: push "external_change" → bannière diff
```

### Création d'une relation depuis le canvas

```
React Flow onConnect (node A → node B)
  → modale "type de relation" (filtré par types source/target)
  → trpc.relations.create({ sourceId, targetId, relationTypeId })
  → Main: crée RelationEdge en DB
  → met à jour frontmatter des 2 entités (champ relation)
  → recompute rollups/formulas dépendants
  → push refresh canvas + graph view
```

### Exécution d'une automation

```
Trigger event (entity.created, cron, alarm)
  → matcher: find automations dont trigger correspond
  → eval conditions (formula engine)
  → exécute actions séquentiellement (worker)
  → log AutomationRun (success/failure/payload/duration)
```

---

## Versioning SQLite

Supernote stocke la version du schéma d'indexation dans `PRAGMA user_version` de `index.db`.

À l'ouverture du vault :
```
PRAGMA user_version = ? (lecture)
  Si < EXPECTED_VERSION  → migrations + rebuild partiel
  Si > EXPECTED_VERSION  → warning "version d'app trop ancienne" + refus d'ouvrir
  Si = EXPECTED_VERSION  → OK, continuer
```

Cela garantit la cohérence après une mise à jour de l'app.
