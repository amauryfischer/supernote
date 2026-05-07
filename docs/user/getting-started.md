# Premiers pas

## Installation

**Prérequis :** Node.js 20+, pnpm 9+

```bash
git clone https://github.com/votre-org/supernote.git
cd supernote
pnpm install
pnpm dev
```

Pour l'installeur desktop packagé (pas de Node requis pour l'utilisateur final) :

```bash
pnpm build:desktop
```

Les installeurs sont dans `apps/desktop/dist/` : `.dmg` pour macOS, `.exe` (NSIS) pour Windows, `.AppImage`/`.deb` pour Linux.

---

## Premier lancement

Au démarrage, Supernote crée automatiquement un vault dans :

- **macOS** : `~/Documents/Supernote/`
- **Windows** : `C:\Users\<toi>\Documents\Supernote\`
- **Linux** : `~/Documents/Supernote/`

Tu n'as rien à choisir. L'`Inbox/` est le point de départ — toutes les nouvelles notes sans contexte y atterrissent.

```
[screenshot: écran d'accueil Supernote avec bouton "Nouvelle note"]
```

### Que fait Supernote au premier lancement ?

1. Crée le dossier vault avec la structure standard (voir ci-dessous)
2. Initialise un dépôt git local dans `.supernote/.git/` — historique automatique
3. Crée les 4 types d'entité seed : Personne, Organisation, Projet, Interaction
4. Crée les types transverses : Note, Daily, Tag
5. Génère les 4 routines seed dans `.supernote/automations/`
6. Lance l'indexeur (reconstruire FTS + embeddings)
7. Détecte Ollama si le daemon tourne — active l'auto-tagging IA

---

## Structure du vault

```
~/Documents/Supernote/
├── .supernote/
│   ├── schemas/          # définitions des types (JSON)
│   ├── relations/        # types de relations
│   ├── views/            # vues sauvegardées
│   ├── templates/        # templates d'entités
│   ├── automations/      # routines et automations YAML
│   ├── plugins/          # plugins installés
│   ├── themes/           # thèmes CSS
│   ├── settings.json     # configuration
│   ├── index.db          # SQLite — index reconstructible
│   ├── lock.json         # verrou multi-machine
│   └── .git/             # historique git auto
├── _assets/              # images, fichiers binaires
├── Inbox/                # nouvelles notes sans contexte
├── Daily/                # journaux quotidiens (YYYY/MM-DD.md)
├── Contacts/             # fiches Personne
├── Organisations/
├── Projets/
└── Notes/                # zone libre
```

### Multi-vault

Tu peux avoir plusieurs vaults. Dans les Settings (`Cmd+,` puis "Vaults") :

- **Ajouter un vault** : sélectionne un dossier existant ou crée-en un nouveau
- **Changer de vault** : clic sur le nom du vault en haut de la sidebar
- **Vault par défaut** : celui qui s'ouvre au lancement

Chaque vault est totalement indépendant — sa propre base de données, son propre git, ses propres plugins.

---

## Interface

```
[screenshot: interface annotée — sidebar gauche, éditeur central, panneau contextuel droit]
```

**Sidebar gauche**
- Vault switcher en haut
- Navigation : Inbox, Daily, sections par type d'entité
- Tags hiérarchiques
- Vues sauvegardées
- Routines
- Corbeille

**Zone centrale**
- Editeur de la note/entité active
- Onglets pour garder plusieurs entités ouvertes

**Panneau droit (contextuel)**
- Backlinks de l'entité active
- Propriétés (champs du frontmatter)
- Historique git
- IA suggestions

**Barre de commandes**
- `Cmd+K` / `Ctrl+K` : quick switcher (notes, entités, actions, vues)
- `Cmd+Shift+F` / `Ctrl+Shift+F` : recherche full-text avancée

---

## Créer une première note

1. Appuie sur `Cmd+N` (`Ctrl+N` sur Win/Linux) ou clique "Nouvelle note"
2. La note s'ouvre dans l'Inbox
3. Tape ton contenu — le titre de la note est la première ligne `#`
4. La note se sauvegarde automatiquement (debounce 500ms)

Le frontmatter est géré par Supernote. Tu n'as pas besoin de l'écrire à la main, mais tu peux le voir en cliquant sur "..." > "Voir le frontmatter".

---

## Paramètres essentiels

Ouvre les Settings avec `Cmd+,` :

| Paramètre | Description |
|---|---|
| `vault.defaultPath` | Chemin du vault par défaut |
| `ai.autoTag` | Active/désactive l'auto-tagging IA |
| `ai.ollamaUrl` | URL du daemon Ollama (défaut : `http://localhost:11434`) |
| `ai.model` | Modèle Ollama à utiliser |
| `git.autoCommit` | Commits auto debouncés |
| `git.remoteUrl` | Remote git pour sync |
| `finance.livePricing` | Activer les prix live (stocks, crypto) |
| `theme` | Thème UI (light / dark / system) |
| `updates.autoCheck` | Vérifier les mises à jour au lancement |
