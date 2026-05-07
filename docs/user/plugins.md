# Plugins

Les plugins permettent d'étendre Supernote : nouveaux blocs, nouvelles vues, intégrations avec des services tiers.

---

## Installer un plugin

### Depuis le Marketplace (v2)

Sidebar > Plugins > "Marketplace" (disponible en v2, nécessite une connexion internet pour récupérer le registre).

### Manuellement

1. Télécharge le dossier du plugin (doit contenir `manifest.json` et `index.js`)
2. Copie-le dans `.supernote/plugins/<plugin-id>/`
3. Redémarre Supernote ou recharge les plugins (Settings > Plugins > "Recharger")

---

## Gérer les plugins installés

Settings > Plugins :

- Liste des plugins installés avec statut actif/inactif
- Permissions accordées à chaque plugin
- Version et compatibilité
- Désinstaller un plugin

---

## Architecture sandbox

Chaque plugin tourne dans une **iframe isolée** avec l'attribut `sandbox`. Il ne peut pas accéder directement au DOM de Supernote ni à Node.js.

Communication via `postMessage` :
```
Plugin (iframe) → postMessage → Supernote host → action → réponse → Plugin
```

Supernote filtre toutes les requêtes selon les **permissions déclarées** dans le manifest du plugin.

---

## Manifest d'un plugin

```json
{
  "id": "my-plugin",
  "name": "Mon Plugin",
  "version": "1.0.0",
  "description": "Ce que fait mon plugin",
  "author": "Ton nom",
  "minSupernoteVersion": "0.2.0",
  "permissions": [
    "entities:read:Personne",
    "entities:write:Note",
    "network:https://api.example.com"
  ],
  "entrypoint": "index.js"
}
```

### Permissions disponibles

| Permission | Accès accordé |
|---|---|
| `entities:read:<Type>` | Lire les entités du type indiqué |
| `entities:write:<Type>` | Créer/modifier des entités |
| `entities:read:*` | Lire toutes les entités |
| `vault:read` | Lire des fichiers du vault |
| `vault:write` | Écrire des fichiers |
| `network:<url>` | Appels HTTP vers cette URL (CORS) |
| `notifications` | Envoyer des notifications |

---

## Ecrire un plugin

### Structure minimale

```
my-plugin/
├── manifest.json
├── index.js       # code du plugin (vanilla JS ou bundle)
└── styles.css     # optionnel
```

### API plugin

Dans ton `index.js`, tu as accès à l'objet `supernote` injecté par le SDK :

```javascript
// Enregistrer un bloc custom
supernote.registerBlock({
  type: 'my-custom-block',
  name: 'Mon Bloc',
  icon: 'star',
  render: (props) => { /* retourne du HTML */ },
  serialize: (data) => { /* retourne une string markdown */ },
});

// Enregistrer une commande dans la palette
supernote.registerCommand({
  id: 'my-plugin:do-something',
  name: 'Faire quelque chose',
  hotkey: 'Ctrl+Shift+M',
  handler: async () => {
    const entities = await supernote.entities.query({
      type: 'Personne',
      filter: { relationship_type: 'client' },
    });
    // ...
  },
});

// Enregistrer un panneau sidebar
supernote.registerSidebarPanel({
  id: 'my-plugin:panel',
  name: 'Mon Panneau',
  icon: 'layout-sidebar',
  render: () => { /* retourne du HTML */ },
});

// Hooks de sauvegarde
supernote.onBeforeSave(async (entity) => {
  // Modifier l'entité avant sauvegarde
  return entity;
});

supernote.onAfterSave(async (entity) => {
  // Réagir après sauvegarde
});

// Nettoyage automatique à la désactivation
supernote.registerDisposable(() => {
  // cleanup
});
```

### Accès aux entités

```javascript
// Lire des entités
const people = await supernote.entities.query({
  type: 'Personne',
  filter: { tags: ['client'] },
  sort: { field: 'name', direction: 'asc' },
  limit: 50,
});

// Créer une entité
const note = await supernote.entities.create({
  type: 'Note',
  fields: { title: 'Ma note' },
  body: '# Ma note\n\nContenu...',
  path: 'Inbox/Ma note.md',
});

// Mettre à jour
await supernote.entities.update(entity.id, {
  fields: { status: 'done' },
});
```

### Données persistantes du plugin

```javascript
// Sauvegarder les settings du plugin
await supernote.storage.set('api_key', 'xxx');

// Lire
const key = await supernote.storage.get('api_key');
```

Les données sont stockées dans `.supernote/plugins/<id>/data.json`.

---

## Cycle de vie du plugin

```javascript
// Appelé quand le plugin est activé
export function onload(supernote) {
  // setup
  supernote.registerCommand({ ... });
}

// Appelé quand le plugin est désactivé
export function onunload() {
  // cleanup automatique via registerDisposable
}
```

Supernote appelle `onunload()` automatiquement et nettoie tous les events/timers enregistrés via `registerDisposable`, `registerInterval`, `registerEvent`.

---

## Exemples de plugins

| Plugin | Ce qu'il fait |
|---|---|
| Pomodoro | Timer Pomodoro dans la sidebar |
| Readwise | Sync des highlights Readwise vers des notes |
| Cal.com | Affiche les réunions Cal.com comme Interactions |
| Excalidraw+ | Templates Excalidraw additionnels |
| Finance Pro | Graphiques additionnels pour le module finance |
