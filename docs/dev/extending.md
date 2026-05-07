# Etendre Supernote

## Ajouter un type d'entité

### Via l'interface (pour les utilisateurs)

Settings > Schémas > "Nouveau type" — c'est la voie recommandée pour les types utilisateur.

### Via le code (seeds ou types système)

Ajoute un fichier dans `packages/core/src/seeds/` :

```typescript
// packages/core/src/seeds/entity-types/book.ts
import { type EntityTypeSeed } from '../types.js';

export const bookSeed: EntityTypeSeed = {
  name: 'book',
  plural: 'books',
  icon: 'book-open',
  color: '#8B5CF6',
  defaultPath: 'Bibliothèque/',
  fileNamePattern: '{{title}}.md',
  defaultView: 'gallery',
  fields: [
    { name: 'title', label: 'Titre', type: 'text', required: true },
    { name: 'author', label: 'Auteur', type: 'relation', targetType: 'personne' },
    { name: 'isbn', label: 'ISBN', type: 'text' },
    { name: 'status', label: 'Statut', type: 'status' },
    { name: 'rating', label: 'Note', type: 'rating' },
    { name: 'read_at', label: 'Lu le', type: 'date' },
  ],
};
```

Puis enregistre dans `packages/core/src/seeds/index.ts` :

```typescript
export const ENTITY_TYPE_SEEDS = [
  personSeed,
  organizationSeed,
  // ... seeds existants
  bookSeed,  // ton nouveau type
];
```

Les seeds sont appliqués au premier lancement du vault (et non réappliqués sur les vaults existants sauf migration explicite).

---

## Ajouter un bloc custom à l'éditeur

1. Crée le composant dans `packages/editor/src/blocks/` :

```typescript
// packages/editor/src/blocks/rating-block.tsx
import { createReactBlockSpec } from '@blocknote/react';
import { z } from 'zod';

const RatingBlockSchema = z.object({
  value: z.number().min(0).max(5).default(0),
});

export const RatingBlock = createReactBlockSpec(
  {
    type: 'rating',
    propSchema: {
      value: { default: 0, type: 'number' },
    },
    content: 'none',
  },
  {
    render: ({ block, editor }) => (
      <div className="rating-block">
        {[1, 2, 3, 4, 5].map((star) => (
          <StarIcon
            key={star}
            filled={star <= block.props.value}
            onClick={() =>
              editor.updateBlock(block, { props: { value: star } })
            }
          />
        ))}
      </div>
    ),
    toExternalHTML: ({ block }) =>
      `<span class="rating">${'★'.repeat(block.props.value)}</span>`,
    parse: (element) => {
      // parse depuis HTML/markdown
    },
  },
);
```

2. Enregistre dans `packages/editor/src/editor-config.ts` :

```typescript
import { RatingBlock } from './blocks/rating-block.js';

export const CUSTOM_BLOCKS = [
  // blocs existants...
  RatingBlock,
];
```

3. Ajoute l'entrée dans le slash menu (`packages/editor/src/slash-menu.ts`) :

```typescript
{
  title: 'Note / Rating',
  group: 'Avancé',
  icon: <StarIcon />,
  onItemClick: (editor) => editor.insertBlocks([{ type: 'rating' }], ...),
  aliases: ['star', 'rating', 'note'],
}
```

4. Sérialisation markdown — assure-toi que `toMarkdown` et `fromMarkdown` sont implémentés pour un round-trip fidèle.

---

## Ajouter une action de routine

Les actions sont définies dans `packages/automations/src/actions/` :

```typescript
// packages/automations/src/actions/send-webhook.ts
import { z } from 'zod';
import { type ActionDefinition } from '../types.js';

const SendWebhookConfig = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT']).default('POST'),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),  // template avec {{variables}}
});

export const sendWebhookAction: ActionDefinition = {
  type: 'send_webhook',
  label: 'Appeler un webhook',
  icon: 'webhook',
  configSchema: SendWebhookConfig,
  
  async execute(config, context) {
    const { url, method, headers, body } = config;
    const resolvedBody = resolveTemplate(body, context.entity);
    
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: resolvedBody,
    });
    
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }
    
    return { success: true };
  },
};
```

Enregistre dans `packages/automations/src/action-registry.ts` :

```typescript
export const ACTION_REGISTRY: Record<string, ActionDefinition> = {
  // actions existantes...
  send_webhook: sendWebhookAction,
};
```

L'action apparaît automatiquement dans l'UI no-code de création de routines.

---

## Ajouter une procédure IPC

Voir [IPC](ipc.md) pour le guide complet. En bref :

1. Ajoute la procédure dans le router approprié (`packages/ipc/src/routers/`)
2. Implémente le handler dans `apps/desktop/src/ipc/handlers/`
3. Utilise via `trpc.entities.myNewProcedure.query(...)` dans le renderer

---

## Ajouter un plugin (externe)

Voir [plugins](../user/plugins.md) pour la documentation utilisateur du plugin SDK.

Des plugins d'exemple complets sont disponibles dans [`examples/plugins/`](../../examples/plugins/) :

| Plugin | Description |
|---|---|
| [`pomodoro`](../../examples/plugins/pomodoro/) | Timer 25/5 min dans le panneau lateral |
| [`word-counter`](../../examples/plugins/word-counter/) | Compteur de mots via hook `afterSave` |
| [`daily-inspiration`](../../examples/plugins/daily-inspiration/) | Citation aleatoire inseree via palette ⌘K |

### Guide pas-a-pas : creer son propre plugin

#### 1. Structure minimale

```
my-plugin/
├── manifest.json   ← declaration du plugin (valide par Zod)
├── index.js        ← point d'entree (ou index.ts compile vers dist/)
├── package.json    ← dev uniquement (build, types)
└── README.md
```

#### 2. Ecrire le manifest

Le manifest est valide par le schema Zod de `@supernote/plugin-sdk`
(`packages/plugin-sdk/src/manifest/schema.ts`).

```json
{
  "id": "com.example.my-plugin",
  "name": "Mon Plugin",
  "version": "1.0.0",
  "entry": "index.js",
  "permissions": ["notifications:show"],
  "contributes": {
    "commands": [
      { "id": "my-plugin.hello", "label": "Dire bonjour" }
    ]
  }
}
```

Contraintes :
- `id` : notation reverse-domain (`com.example.my-plugin`)
- `version` : semver strict (`1.0.0`)
- `permissions` : valeurs autorisees → `entities:read`, `entities:write`,
  `fs:read`, `fs:write`, `network:fetch`, `notifications:show`, `commands:register`
- `contributes.sidebarPanels[].label` (non `title`) — voir le schema pour les noms exacts

#### 3. Ecrire le code (API)

Le plugin recoit une instance `SupernoteAPI` via la fonction `activate` :

```js
function activate(api) {
  // Enregistrer une commande
  api.ui.registerCommand({ id: "my-plugin.hello", label: "Dire bonjour" });

  // Afficher une notification
  api.ui.showNotification({ title: "Hello", body: "Monde !", level: "info" });

  // Lire des entites
  api.entities.list({ limit: 10 }).then(entities => console.log(entities));

  // Ecouter un hook
  api.hooks.on("afterSave", (payload) => {
    console.log("Note sauvegardee :", payload.entityId);
  });

  // Stockage persistant
  api.storage.set("ma-cle", { valeur: 42 });
}

// Point d'entree attendu par le runtime
window.activate = activate;
```

API disponible :

| Namespace | Methodes |
|---|---|
| `api.entities` | `list()`, `get()`, `create()`, `update()`, `delete()` |
| `api.schemas` | `list()`, `get()` |
| `api.search` | `query()` |
| `api.ui` | `registerCommand()`, `registerBlock()`, `registerSlashItem()`, `showNotification()`, `addSidebarPanel()` |
| `api.storage` | `get()`, `set()` |
| `api.hooks` | `on(event, handler)` |
| `api.fetch` | Wrapper `fetch` natif (permission `network:fetch` requise) |

Hooks disponibles : `beforeSave`, `afterSave`, `onCreate`, `onDelete`.

#### 4. Sandbox et securite

Chaque plugin s'execute dans un iframe isole. Les appels API passent par
postMessage (protocole `@supernote/plugin-sdk`). Le host valide chaque
requete contre les permissions declarees dans le manifest ; toute tentative
d'acces non autorisee retourne une erreur `PERMISSION_DENIED`.

#### 5. Build (TypeScript)

Si vous utilisez TypeScript :

```bash
pnpm add -D typescript @supernote/plugin-sdk
# tsconfig.json minimal
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "strict": true
  },
  "include": ["index.ts"]
}
pnpm tsc
# → dist/index.js
```

#### 6. Installer un plugin local

Copiez le dossier du plugin (contenant `manifest.json` et `index.js`) dans :

```
<vault>/.supernote/plugins/<plugin-id>/
```

Exemple :

```bash
cp -r examples/plugins/pomodoro/ \
  ~/Documents/MonVault/.supernote/plugins/com.supernote.pomodoro/
```

Puis rechargez Supernote : **Settings > Plugins > Actualiser**.

Le plugin apparait dans la liste avec son nom, sa version et ses permissions.

---

## Ajouter un importeur

Dans `packages/import/src/importers/` :

```typescript
// packages/import/src/importers/csv-contacts.ts
import { z } from 'zod';
import { type Importer, type ImportResult } from '../types.js';

export const csvContactsImporter: Importer = {
  id: 'csv-contacts',
  name: 'Contacts CSV',
  description: 'Importe des contacts depuis un fichier CSV',
  accepts: ['.csv'],
  
  async import(filePath, options): Promise<ImportResult> {
    // parse CSV, map colonnes, créer entités Personne
    const entities = [];
    // ...
    return { created: entities.length, updated: 0, errors: [] };
  },
};
```

---

## Ajouter une vue

Dans `packages/views/src/views/` :

```typescript
// packages/views/src/views/timeline-view.tsx
import { type ViewProps } from '../types.js';

export function TimelineView({ entities, config }: ViewProps) {
  // implémentation
}
```

Enregistre dans `packages/views/src/view-registry.ts` et dans le sélecteur de vues de l'UI.
