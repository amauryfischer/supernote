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
2. **Filesystem = source de vérité.** SQLite = index reconstructible **dans le vault** (`.supernote/index.db`). Le vault entier est portable (Drive, Dropbox, USB) — sur une autre machine, on ouvre le dossier et tout est là (notes, contacts, schémas, vues, embeddings, historique git). Si la DB corrompt → reindex auto depuis les `.md`. Lock multi-machine pour prévenir l'édition concurrente.
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
| Sync inter-appareils | **git** (commits + remote) ou **Syncthing** (au choix de l'user) | Pas de CRDT/Yjs (YAGNI desktop-only). Sync passe par le filesystem. |
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
│   ├── index.db                  # SQLite — TOUJOURS dans le vault (portable Drive)
│   ├── lock.json                 # lock multi-machine (pid/host/timestamp)
│   └── .git/                     # historique git auto (isomorphic-git)
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

### 7.11 IA — agent Ollama assistant

L'agent Ollama est **actif dès le départ** (si daemon détecté) et fait du travail proactif **sans demander à l'utilisateur**, en background, à chaque sauvegarde de note.

**Comportements proactifs (background)** :
- **Auto-tagging** : à chaque save d'une note, l'agent reçoit (a) le contenu de la note, (b) la liste des tags existants dans le vault avec leurs descriptions/historique d'usage. Il propose 0 à 5 tags pertinents — d'abord parmi ceux qui existent (matching sémantique : tag "perso" → note qui parle de famille/loisirs → applique "perso"), créé un nouveau tag uniquement si gap évident. Les tags suggérés sont **appliqués automatiquement** mais marqués `source: ai-suggested` (visuels distincts en pill, l'utilisateur peut les retirer en 1 clic, ou les valider d'un toggle "garder cette suggestion").
- **Auto-classification** : suggère le type d'entité ("ce note est en réalité une fiche de réunion → la transformer en `Interaction` ?") via une bannière non-intrusive.
- **Détection de mentions implicites** : repère les noms de personnes/orgs dans le texte qui matchent des entités existantes du CRM, propose de les wrapper en mention `@X`.
- **Extraction d'actions** : à la sauvegarde d'une note de réunion, scanne pour des phrases du type "je dois", "TODO", "à faire" et propose de créer des entrées dans une liste de tâches liée.
- **Liaison automatique aux entités** : si la note mentionne "réunion avec Jean", propose de lier la note à la personne Jean.

**Embeddings locaux** dès le départ (transformers.js worker, `Xenova/all-MiniLM-L6-v2`) — utilisés à la fois par la recherche sémantique ET par l'auto-tagging (similarité avec embeddings des tags existants).

**Pont Ollama** : détection auto du daemon local, sélection de modèle dans settings. Si Ollama non disponible : fallback **silencieux** sur des heuristiques basiques (regex sur mots-clés, embeddings cosine pour les tags) — l'auto-tagging continue de marcher en mode dégradé.

**Actions LLM contextuelles** (sur demande, dans le menu d'une note) : "résumer", "extraire actions", "réécrire", "traduire", "tagger auto" (re-trigger), "suggérer entités à mentionner".

**Confidentialité** : tout est local, rien ne sort vers le cloud. L'utilisateur peut désactiver l'auto-tagging dans les settings (`settings.ai.autoTag = true|false`).

**"Ask my notes" RAG** : recherche sémantique + injection des top-k chunks dans un prompt Ollama pour répondre.

**Voice notes** → transcription whisper.cpp local → markdown.
**OCR** (Tesseract.js) sur images collées.

### 7.12 Capture rapide / quotidien
- Raccourci OS global (`globalShortcut`) → modale capture.
- Ligne de commande `supernote new "..."` (CLI bridge sur Unix socket).
- Capture par email (alias local + IMAP poll optionnel, v2).
- Type seed `Daily`, bouton "Aujourd'hui".

### 7.13 Finance personnelle

Module premier-class pour la gestion patrimoniale.

**Entity types seed dédiés :**

- **Account** (compte bancaire/courant/épargne)
  - `name`, `kind` (select: courant/épargne/livret/PEA/CTO/assurance-vie/crypto/autre)
  - `institution` (relation→Organisation), `currency` (select EUR/USD/CHF/...), `iban` (text), `current_balance` (currency)
  - `last_synced_at` (datetime), tags, body

- **Asset** (catégorie générique d'actif détenu)
  - Discriminé par `category` : `real_estate | stock | crypto | bond | fund | cash | other`
  - Champs communs : `name`, `category`, `acquisition_date`, `acquisition_value`, `current_value` (formula ou manuelle), `account` (relation→Account), tags, body
  - **Conditionnels par catégorie** :
    - `real_estate` : `address`, `surface_sqm`, `loan` (relation→Loan optional), `valuation_method` (select: manuelle/index/expert), `last_valuation_at`
    - `stock` : `ticker` (text, ex AAPL), `shares` (number), `currency`, **prix live pulled** via lib gratuite Yahoo Finance (`yahoo-finance2` npm)
    - `crypto` : `symbol` (BTC, ETH...), `quantity`, prix live via CoinGecko gratuit
    - `bond` / `fund` : `isin`, `units`, prix manuel ou via Yahoo

- **Loan** (prêt avec amortissement)
  - `name`, `principal` (currency required), `rate_annual` (percent), `term_months` (number), `start_date` (date), `monthly_payment` (formula auto), `remaining_principal` (formula sur date courante), `end_date` (formula), `kind` (select: immobilier/conso/perso/auto/etudiant/autre), `lender` (relation→Organisation)
  - **Calcul auto** : table d'amortissement générée par formule, exposée comme query block "voir l'amortissement" sur la fiche du loan

- **Snapshot** (état patrimonial à un instant T)
  - `name` (text), `taken_at` (datetime), `total_net_worth` (currency, calculé), `breakdown` (longtext JSON par catégorie), `notes`
  - Action "Prendre un snapshot maintenant" qui freeze toutes les valeurs courantes
  - Vue dashboard "Évolution" qui plot net worth dans le temps (chart) et compare aux **objectifs**

- **Goal** (objectif financier)
  - `name`, `target_amount` (currency), `target_date` (date), `category` (select: épargne/investissement/dette/patrimoine), `current_progress` (formula = somme actifs filtrés)
  - Vue progress bar + ETA basée sur trend (régression linéaire sur snapshots)

**Engine de pricing (`packages/finance` ou intégré dans `packages/automations`) :**

- **Stocks** : `yahoo-finance2` (npm, MIT, gratuit, scrape Yahoo Finance API publique)
- **Crypto** : `coingecko-api-v3` (free tier, no key) ou raw fetch CoinGecko
- **Forex** : `currency.exchangerate-api.com` (free tier) pour conversion multi-devises
- Tous les pulling sont **opt-in** (le user active dans settings, accepte d'aller chercher des prix sur internet — sinon valeurs manuelles)
- Caché localement avec TTL 15min (cours intraday) à 24h (cours quotidien)
- Routine seed "Refresh patrimoine" : cron 1×/jour à 18h, refresh tous les Asset avec ticker, recalcule current_value

**Vues dédiées :**

- Dashboard "Patrimoine" : metric cards (net worth, total cash, total assets, total debt) + chart évolution + table par catégorie
- Vue "Comptes" — table de tous les Account avec totaux
- Vue "Actifs" — kanban groupé par catégorie
- Vue "Loans" — timeline des remboursements + chart amortissement
- Vue "Snapshots" — timeline avec diff entre snapshots
- Vue "Goals" — progress bars + ETA

**Confidentialité** : module finance peut être placé dans un dossier vault dédié (`/Finance/`) si l'user veut isoler. Les prix pullés sont des cours publics, pas de credentials bancaires.

**Pas de scraping bancaire** (Bridge / Powens / Plaid) — trop intrusif et payant. Mise à jour manuelle des soldes Account ou import OFX/CSV.

### 7.14 Plugins
- Manifest JSON, code JS sandboxé (iframe avec API postMessage typée).
- API plugin : enregistrer block custom, action de slash menu, command palette, view, panneau sidebar, pré/post-hooks de save.
- Permissions explicites (lecture/écriture entités, FS, réseau).
- Marketplace local-first (registry git public à v2).

### 7.15 API & CLI
- HTTP API locale sur `127.0.0.1:port` (port aléatoire, token par session).
- Endpoints REST + WebSocket pour subscribe.
- **MCP server intégré** pour permettre à un LLM externe de manipuler le vault.
- CLI compagnon : `supernote new`, `supernote search`, `supernote query`, `supernote export`.

### 7.16 Sécurité & vie privée
- 100% local par défaut, zéro télémétrie.
- Vault chiffré (age) optionnel par dossier.
- Verrouillage app par mot de passe (vault chiffré).
- Audit log local.

### 7.17 Theming
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

## 12. Décisions itératives (validées 2026-05-07)

- **Nom** : Supernote.
- **Esthétique** : **light élégant minimal** (Notion/Craft) par défaut, avec dark mode propre. Beaucoup d'espace blanc, typographie generous, look "document". Pas générique IA.
- **Mobile** : repoussé, focus 100% desktop pour la version finale. Mobile = projet ultérieur.
- **Emails (routines)** : **drafts uniquement** dans la version finale. Les routines créent des brouillons dans le client mail OS (via `mailto:` ou intégration `Apple Mail` / `Outlook` / `Thunderbird`) que l'utilisateur valide avant envoi. Pas de SMTP natif ni d'API tierce. Plus safe et zéro dépendance externe.
- **Routines seed dès le départ** :
  - Email hebdo à un contact (drafts paramétrables avec template + variables)
  - Rappel d'anniversaire (notification OS la veille, suggestion de message)
  - Suivi "à relancer" (détecte personnes sans interaction depuis X jours)
  - Brief quotidien LLM (matin, via Ollama si dispo, fallback sur template statique)

- **Window chrome** : titlebar custom Linear/Notion-style (logo + breadcrumb + boutons fenêtre custom). Hybride : `hiddenInset` sur macOS, drag-region full custom sur Win/Linux.
- **Sync collab** : pas de Yjs/CRDT. Sync inter-appareils via git ou Syncthing au niveau du filesystem.
- **Seed entity types** : Personne, Organisation, Projet, Interaction (les 4 types). Notes, Daily, Tag = aussi en seed (transverses).

### Champs par défaut des seeds CRM

**Personne** — `name` (text required), `photo` (image), `emails` (email[] multi), `phones` (phone[] multi), `birthday` (date), `organization` (relation→Organisation, n↔1), `role` (text), `relationship_type` (select: ami/famille/collègue/client/prospect/fournisseur/autre), `social_links` (longtext JSON ou champs URL spécialisés `linkedin`/`twitter`/`github`), `tags` (tag[]), body markdown libre.

**Organisation** — `name` (text required), `logo` (image), `website` (url), `industry` (select), `address` (longtext), `members` (relation→Personne, 1↔n inverse de `organization`), `tags`, body.

**Projet** — `name` (text required), `status` (workflow: idea/active/blocked/done/archived), `description` (longtext), `start_date` (date), `due_date` (date), `members` (relation→Personne, n↔n), `organizations` (relation→Organisation, n↔n), `tags`, body.

**Interaction** — `kind` (select: appel/réunion/email/café/visio/autre), `date` (datetime required), `duration_minutes` (number), `participants` (relation→Personne, n↔n required), `organization` (relation→Organisation, n↔1 optional), `project` (relation→Projet, n↔1 optional), `location` (text), `summary` (longtext), body.

- **Code & commentaires** : **anglais partout** (identifiers, commentaires internes, messages d'erreur tech). UI en français (i18n séparée à venir).
- **Auto-update** : **electron-updater + auto-check au lancement**. Endpoint = GitHub Releases (repo perso). Toggle dans settings.
- **Chiffrement** : **pas de chiffrement applicatif**. Le vault est en filesystem clair, le chiffrement passe par l'OS si besoin (FileVault, BitLocker, LUKS).
- **Timeline** : 2 ans en mode agile autonome — itérations IA × humain, vérification à chaque étape, qualité avant vitesse.

- **Onboarding vault** : **pas d'OS picker au premier lancement**. Supernote crée automatiquement un vault par défaut dans `~/Documents/Supernote/` (ou équivalent OS). Le dossier `Inbox/` est le **fourre-tout** par défaut où atterrissent toutes les nouvelles notes créées sans contexte. L'utilisateur peut déplacer le vault ou en ajouter d'autres dans les settings, mais il n'a pas à choisir au premier lancement. **CTA principale homepage = "Nouvelle note"** (pas "Ouvrir un vault").

### Encore à trancher (à itérer)
- Locale par défaut (FR) + i18n générique pour anglais.
