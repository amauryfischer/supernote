# Supernote

**Le système de connaissance + CRM personnel local-first.**

Tes notes, tes contacts, tes projets, tes finances — tout sur ton disque, tout connecté, tout requêtable. Sans abonnement, sans cloud, sans compromis.

---

> Tolaria (filesystem-first) x Notion (blocs, bases de données) x Salesforce (CRM puissant) x Obsidian (backlinks, canvas, graphe) — sur ton bureau, pour toujours.

---

## Captures d'écran

```
[screenshot: éditeur principal avec blocs et wikilinks]
[screenshot: dashboard finance — net worth, actifs, prêts]
[screenshot: vue CRM contacts avec timeline d'interactions]
[screenshot: canvas Excalidraw + entités typées reliées]
```

---

## Installation rapide

**Prérequis :** Node.js 20+, pnpm 9+

```bash
git clone https://github.com/votre-org/supernote.git
cd supernote
pnpm install
pnpm dev
```

Au premier lancement, Supernote crée un vault par défaut dans `~/Documents/Supernote/`. Aucune configuration requise.

Pour packager l'app desktop :

```bash
pnpm build          # compile tous les packages
pnpm build:desktop  # génère l'installeur Electron (Mac/Win/Linux)
```

---

## Ce que Supernote fait

### Editeur
- Blocs riches : texte, titres, listes, code (syntax highlight), tableaux, callouts, toggles
- Wikilinks `[[note]]`, mentions `@personne`, tags `#topic`, transclusion d'entités
- Blocs avancés : Mermaid, KaTeX, Excalidraw inline, canvas inline, Query block, Formula block, Button block
- Slash command `/` avec recherche, drag-and-drop de blocs
- Synced blocks : un bloc édité en un endroit, reflété partout
- Notes vocales auto-transcrites (whisper.cpp local), images OCR (Tesseract.js)
- Raccourci OS global pour capture rapide depuis n'importe quelle app

### CRM
- 4 types seed : Personne, Organisation, Projet, Interaction
- Champs riches : emails, téléphones, anniversaire, liens sociaux, photo, rôle, type de relation
- Relations typées avec labels directs et inverses (Jean `travaille chez` Acme, Acme `emploie` Jean)
- Timeline d'interactions par contact, vue "à relancer depuis X jours"
- Mentions `@Jean` dans n'importe quelle note → lien bidirectionnel automatique

### Finance
- Comptes (courant, épargne, PEA, CTO, assurance-vie, crypto)
- Actifs avec prix live opt-in : actions (Yahoo Finance), crypto (CoinGecko), immobilier manuel
- Prêts avec tableau d'amortissement calculé automatiquement
- Snapshots de patrimoine, évolution graphique dans le temps
- Objectifs financiers avec barre de progression et ETA

### Automations et routines
- 4 routines prêtes : email hebdo à un contact, rappel anniversaire, suivi "à relancer", brief du lundi
- Triggers : cron, alarme sur champ date, event entité, webhook
- Actions : notification OS, note dans Inbox, draft email, prompt LLM, script JS
- Interface no-code pour créer ses propres routines

### IA locale
- Auto-tagging proactif à chaque sauvegarde (Ollama + fallback embeddings ONNX)
- Suggestions d'entités à mentionner, détection d'actions dans les notes de réunion
- "Ask my notes" : RAG local avec Ollama
- Recherche hybride FTS5 + sémantique (vecteurs `all-MiniLM-L6-v2`, 100% local)
- Tout reste sur ta machine. Zero télémétrie.

### Sync et versioning
- Filesystem = source de vérité. Tes notes sont des fichiers `.md` lisibles partout.
- Historique git automatique dans le vault (commits debouncés, restauration par entité)
- Sync inter-appareils : git remote ou Syncthing (au choix), pas de CRDT
- Vault portable : copie le dossier sur Drive/Dropbox/USB, ouvre-le sur une autre machine

### Vues
- Table, Kanban, Galerie, Calendrier, Timeline/Gantt, Graphe, Map, Dashboard
- Sur n'importe quel type d'entité ou résultat de requête
- Filtres composés, tris, groupements, formules — vues sauvegardées dans le vault

### Plugins
- Sandbox iframe + API postMessage typée
- API plugin : blocs custom, commandes, panneaux sidebar, hooks pre/post-save
- Permissions explicites (lecture/écriture par type d'entité, réseau)
- Marketplace local-first (registry git, v2)

### Confidentialité
- 100% local par défaut. Aucun serveur requis.
- Vault en markdown lisible par VS Code, Obsidian, n'importe quel éditeur
- Import Obsidian themes (compat partielle)
- Chiffrement via OS (FileVault, BitLocker, LUKS) — pas de chiffrement applicatif supplémentaire

---

## Stack technique

| Couche | Technologie |
|---|---|
| Desktop | Electron 33 |
| App | Next.js 15 + React 19 + TypeScript strict |
| Base de données | SQLite (better-sqlite3) + Prisma 6 + FTS5 trigram |
| Validation | Zod 4 |
| Editeur | BlockNote (Tiptap/ProseMirror) + extensions custom |
| Canvas | Excalidraw + React Flow |
| Graphe | react-force-graph-2d |
| Tableaux | TanStack Table + AG Grid Community |
| UI | HeroUI v3 + Tailwind v4 + Lucide |
| Animations | Motion (ex Framer Motion) |
| State | Zustand + TanStack Query |
| Forms | React Hook Form + Zod |
| IPC | tRPC over Electron IPC |
| File watcher | chokidar |
| Markdown | remark/unified + gray-matter |
| Recherche FTS | SQLite FTS5 (trigram tokenizer) |
| Recherche sémantique | transformers.js + ONNX `all-MiniLM-L6-v2` |
| IA générative | Ollama (optionnel, détection auto) |
| Voice / OCR | whisper.cpp WASM + Tesseract.js |
| Versioning | isomorphic-git |
| Plugins | iframe sandbox + postMessage |
| Formules | Lezer + parser custom |
| Automations | node-cron + EventEmitter + DSL YAML |
| Tests | Vitest + Playwright Electron |
| Build | electron-builder + Turborepo + pnpm |
| Logs | pino |

---

## Structure du monorepo

```
supernote/
├── apps/
│   ├── desktop/         # Electron main + preload
│   └── web/             # Next.js renderer
├── packages/
│   ├── core/            # Types, schema engine, parsing (pur, sans deps Electron)
│   ├── db/              # Prisma schema + migrations + client typé
│   ├── ipc/             # Contrats tRPC renderer ↔ main
│   ├── ui/              # Tokens design + wrappers HeroUI
│   ├── editor/          # Extensions BlockNote, blocs custom
│   ├── canvas/          # Excalidraw + React Flow
│   ├── views/           # Table, Kanban, Galerie, Calendrier, Timeline, Graph
│   ├── ai/              # Bridge Ollama, auto-tagging, classifieur
│   ├── search/          # FTS5 + sémantique + langage de requête
│   ├── automations/     # Engine de routines et automations
│   ├── formulas/        # Parser + évaluateur de formules Coda-like
│   ├── finance/         # Module finance — prix live, amortissement, snapshots
│   ├── git/             # Wrappers isomorphic-git
│   ├── import/          # Importeurs Notion, Obsidian, vCard, OFX
│   ├── notifications/   # Notifications OS + in-app
│   ├── templates/       # Engine de templates + seeds
│   ├── plugin-sdk/      # API et types pour plugins tiers
│   ├── api/             # Serveur HTTP local + MCP server
│   ├── cli/             # CLI compagnon `supernote`
│   ├── ocr/             # OCR Tesseract.js
│   ├── voice/           # Transcription whisper.cpp
│   ├── tsconfig/        # Config TypeScript partagée
│   └── eslint-config/   # Config ESLint partagée
└── docs/
    ├── user/            # Documentation utilisateur
    ├── dev/             # Documentation développeur
    └── ROADMAP.md
```

---

## Documentation

- [Documentation utilisateur](docs/user/README.md) — premiers pas, éditeur, CRM, finance, IA, sync
- [Documentation dev](docs/dev/README.md) — architecture, packages, contributing, data model
- [Roadmap](docs/ROADMAP.md) — ce qui est fait, ce qui vient, v1.0
- [Contribuer](docs/dev/contributing.md) — setup repo, conventions, PRs

---

## Licence

MIT — voir [LICENSE](LICENSE).

Supernote est un projet indépendant. Aucune affiliation avec Rocketbook ou tout autre produit du même nom.
