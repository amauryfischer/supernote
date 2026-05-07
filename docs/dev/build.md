# Build et packaging

## Développement

```bash
pnpm dev
```

Turborepo démarre en parallèle :
1. Compile tous les packages en mode watch
2. Lance Next.js renderer sur `http://localhost:3000`
3. Lance Electron en pointant sur `localhost:3000`

Hot-reload renderer : automatique. Hot-reload main process : `Cmd+R` dans Electron.

### Commandes par package

```bash
# Compiler un seul package en watch
pnpm --filter @supernote/core dev

# Lancer les tests en watch
pnpm --filter @supernote/editor test:watch

# Typecheck d'un seul package
pnpm --filter @supernote/db typecheck
```

---

## Build de production

```bash
# Compiler tous les packages
pnpm build

# Order de build (géré par Turborepo via le graph de deps) :
# 1. tsconfig, eslint-config
# 2. core, db
# 3. ipc, formulas, search, git, templates, notifications, ocr, voice
# 4. ai, automations, finance, import, plugin-sdk, api, cli
# 5. ui, editor, canvas, views
# 6. apps/web, apps/desktop
```

### Vérifier le build

```bash
pnpm typecheck   # tsc --noEmit sur tous les packages
pnpm lint        # ESLint sur tous les packages
pnpm test        # Vitest sur tous les packages
```

---

## Packaging Electron

```bash
pnpm build:desktop
```

Ce script (dans `apps/desktop/package.json`) :
1. Build le renderer Next.js en mode `output: 'export'` (HTML/JS/CSS statiques)
2. Copie le build dans `apps/desktop/renderer/`
3. Lance `electron-builder` pour générer les installeurs

### Cibles de packaging

Configurées dans `apps/desktop/electron-builder.config.js` :

| Plateforme | Format | Notes |
|---|---|---|
| macOS | `.dmg` + `.zip` | Universal (x64 + arm64), signé + notarisé |
| Windows | `.exe` (NSIS) | Code signing via certificat EV |
| Linux | `.AppImage` + `.deb` | AppImage = universel, deb = Ubuntu/Debian |

### Configuration electron-builder

```javascript
// apps/desktop/electron-builder.config.js (exemple)
module.exports = {
  appId: 'com.supernote.app',
  productName: 'Supernote',
  directories: {
    output: 'dist',
    buildResources: 'resources',
  },
  files: [
    'main/**/*',
    'preload/**/*',
    'renderer/**/*',
    '!**/*.map',
  ],
  mac: {
    category: 'public.app-category.productivity',
    hardenedRuntime: true,
    entitlements: 'resources/entitlements.mac.plist',
    entitlementsInherit: 'resources/entitlements.mac.plist',
    notarize: { teamId: process.env.APPLE_TEAM_ID },
    target: [
      { target: 'dmg', arch: ['universal'] },
      { target: 'zip', arch: ['universal'] },
    ],
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    certificateSubjectName: process.env.WIN_CERT_SUBJECT,
  },
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Office',
  },
  publish: {
    provider: 'github',
    owner: 'votre-org',
    repo: 'supernote',
  },
};
```

### Variables d'environnement pour le signing

```bash
# macOS notarization
APPLE_ID=xxx
APPLE_ID_PASSWORD=xxx  # app-specific password
APPLE_TEAM_ID=xxx

# Windows signing
WIN_CERT_SUBJECT=xxx
WIN_CERT_PASSWORD=xxx

# GitHub publish (electron-updater)
GH_TOKEN=xxx
```

---

## Auto-update

Supernote utilise **electron-updater** pour les mises à jour automatiques via GitHub Releases.

Comportement :
1. Au lancement, check GitHub Releases (si `updates.autoCheck = true` dans settings)
2. Si une nouvelle version est disponible : notification non-intrusive
3. L'utilisateur choisit d'installer maintenant ou plus tard
4. Le binaire est téléchargé en arrière-plan, installé à la prochaine fermeture

Désactivable dans Settings > Mises à jour.

---

## Bindings natifs

Certains packages contiennent des bindings natifs à recompiler pour la plateforme cible :

- `better-sqlite3` — binding SQLite
- `whisper.cpp` — WASM, pas de recompilation nécessaire
- `@huggingface/transformers` — ONNX Runtime, pré-compilé

Recompilation pour Electron :

```bash
pnpm rebuild
# ou
node_modules/.bin/electron-rebuild -f -w better-sqlite3
```

electron-builder gère ça automatiquement avant le packaging.

---

## Turborepo cache

Turborepo cache les outputs de build dans `.turbo/`. Pour invalider :

```bash
pnpm build --force    # rebuild tout
pnpm turbo clean      # vider le cache local
```

Pour le CI, configure le Turborepo remote cache (Vercel Remote Cache ou self-hosted) pour partager les caches entre les jobs.

---

## Variables d'environnement de build

| Variable | Valeur | Description |
|---|---|---|
| `NODE_ENV` | `development` / `production` | Mode de l'app |
| `NEXT_PUBLIC_APP_VERSION` | semver | Injecté dans le renderer |
| `ELECTRON_ENABLE_LOGGING` | `1` | Active les logs Electron vers stdout |
| `LOG_LEVEL` | `debug` / `info` / `warn` | Niveau de log pino |
| `SUPERNOTE_VAULT_PATH` | path | Override du vault (tests) |
