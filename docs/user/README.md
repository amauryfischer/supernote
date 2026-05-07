# Documentation utilisateur Supernote

Bienvenue. Cette documentation couvre tout ce qu'il faut savoir pour utiliser Supernote au quotidien.

---

## Sections

| Section | Contenu |
|---|---|
| [Premiers pas](getting-started.md) | Installation, premier lancement, vault, interface |
| [Ecrire](writing.md) | Editeur, blocs, slash menu, raccourcis, sync |
| [Organiser](organizing.md) | Dossiers, tags, vues, recherche |
| [CRM](crm.md) | Contacts, organisations, projets, interactions, timeline |
| [Finance](finance.md) | Comptes, actifs, prêts, snapshots, objectifs |
| [Routines](routines.md) | Automations, cron, alarmes, templates seed |
| [Canvas et graphe](canvas-graph.md) | Canvas spatial, knowledge graph |
| [Intelligence artificielle](ai.md) | Auto-tagging, suggestions, RAG, Ollama |
| [Import / Export](import-export.md) | Notion, Obsidian, vCard, OFX |
| [Sync](sync.md) | Filesystem-first, git, Syncthing, Drive/Dropbox |
| [Plugins](plugins.md) | Marketplace, sandbox, écrire un plugin |
| [Raccourcis clavier](keyboard-shortcuts.md) | Tableau complet |
| [FAQ](faq.md) | Questions fréquentes |

---

## Concept central

Supernote stocke tout dans des fichiers `.md` sur ton disque. La base de données SQLite (`~/.supernote/index.db`) est un index reconstruit depuis les fichiers — jamais la source de vérité. Si quelque chose va de travers, tu peux supprimer la DB et Supernote recrée tout depuis tes fichiers.

Tout est une **entité typée** : tes notes, tes contacts, tes projets, tes finances. Chaque entité a un frontmatter YAML + un corps markdown. Tu peux les ouvrir avec VS Code, Obsidian, ou n'importe quel éditeur texte.

---

## Raccourci rapide

Depuis n'importe quelle app sur ton bureau :

- **macOS** : `Cmd+Shift+Space` — capture rapide
- **Windows/Linux** : `Ctrl+Shift+Space` — capture rapide

La note atterrit dans ton `Inbox/`.
