# Release

## Versioning

Supernote suit [Semantic Versioning](https://semver.org/) :

- `MAJOR.MINOR.PATCH`
- `0.x.y` = alpha/beta — API publique et formats non stables
- `1.0.0` = première version production-ready (voir [Roadmap](../ROADMAP.md))

Exemples :
- `0.1.0` → `0.1.1` : bug fix (no migration needed)
- `0.1.0` → `0.2.0` : nouvelles features, breaking changes possibles dans l'API IPC
- `0.1.0` → `1.0.0` : production-ready milestone

---

## Changelog

Supernote utilise le format [Keep a Changelog](https://keepachangelog.com/) dans `CHANGELOG.md` à la racine.

Sections par version :
- `Added` — nouvelles features
- `Changed` — changements de comportement existant
- `Deprecated` — features qui seront supprimées
- `Removed` — features supprimées
- `Fixed` — bug fixes
- `Security` — corrections de sécurité

---

## Processus de release

### 1. Préparer la release

```bash
# Depuis la branche dev, créer une branche release
git checkout -b release/v0.2.0

# Bump la version dans tous les package.json
pnpm version 0.2.0 --recursive

# Mettre à jour CHANGELOG.md
# → Déplacer "Unreleased" vers "v0.2.0 - YYYY-MM-DD"
# → Ajouter les entries de la release

# Commit
git add -A
git commit -m "chore: prepare release v0.2.0"
```

### 2. Vérifications pre-release

```bash
pnpm typecheck      # doit passer sans erreur
pnpm lint           # doit passer
pnpm test           # doit passer
pnpm build          # doit produire un build propre
pnpm build:desktop  # doit générer les installeurs
```

Teste manuellement sur macOS, Windows, et Linux si possible :
- Premier lancement (nouveau vault)
- Ouverture d'un vault existant
- Import Obsidian
- Auto-update (test sur un installeur précédent)

### 3. Merge et tag

```bash
git checkout main
git merge release/v0.2.0 --no-ff
git tag v0.2.0 -m "Release v0.2.0"
git push origin main --tags
```

### 4. GitHub Release

Le push du tag déclenche la CI GitHub Actions qui :

1. Build les installeurs pour macOS (universal), Windows (x64), Linux (AppImage + deb)
2. Signe les binaires (macOS : notarisation Apple, Windows : code signing)
3. Crée la GitHub Release avec les installeurs en assets
4. electron-updater distribue la mise à jour aux utilisateurs existants

```yaml
# .github/workflows/release.yml (extrait)
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - pnpm install
      - pnpm build:desktop
      - electron-builder publish always
```

---

## Auto-update

Supernote utilise `electron-updater` qui pointe sur GitHub Releases.

**Côté utilisateur :**
1. Au lancement, Supernote vérifie `https://github.com/votre-org/supernote/releases/latest` (si `updates.autoCheck = true`)
2. Si une nouvelle version est disponible : notification en bas de la sidebar
3. "Télécharger et installer" → download en background + install au prochain quit
4. "Plus tard" → re-notifié au prochain lancement

**Côté release :**
electron-builder génère automatiquement les fichiers `latest.yml`, `latest-mac.yml`, `latest-linux.yml` qui sont uploadés comme assets de la GitHub Release. electron-updater les lit pour savoir si une update est disponible.

---

## Migration de schéma DB

Quand la structure de `index.db` change entre deux versions :

1. Incrémente `EXPECTED_DB_VERSION` dans `packages/db/src/version.ts`
2. Ajoute une migration dans `packages/db/src/migrations/v<N>.ts`
3. Le `MigrationRunner` détecte la version via `PRAGMA user_version` et applique les migrations séquentiellement

```typescript
// packages/db/src/migrations/v2.ts
export async function migrateToV2(db: Database): Promise<void> {
  // Exemple : ajouter une colonne
  db.exec(`ALTER TABLE Entity ADD COLUMN lastEditedBy TEXT`);
  db.pragma('user_version = 2');
}
```

Les migrations sont **toujours additives** (pas de DROP en migration automatique — utilise une migration manuelle documentée si vraiment nécessaire).

---

## Rollback

Si une release est défectueuse :

1. Crée une GitHub Release de la version précédente avec le flag "latest" (dans les release settings de GitHub)
2. electron-updater va proposer la version précédente aux utilisateurs (downgrade automatique)
3. Supernote ouvre un vault avec `PRAGMA user_version` supérieur à `EXPECTED_DB_VERSION` → affiche un warning et refuse d'ouvrir pour éviter la corruption

C'est pourquoi les migrations DB sont toujours additives : elles n'empêchent pas une version antérieure de lire les données (les nouvelles colonnes sont ignorées par les vieilles versions).

---

## Code signing & notarization

### Certificat macOS — Apple Developer Program

1. Rejoindre l'**Apple Developer Program** sur https://developer.apple.com/programs/ (~99 $/an).
2. Dans Xcode → Preferences → Accounts : ajouter ton Apple ID et télécharger le certificat
   **Developer ID Application** (valable 5 ans, pour distribuer hors Mac App Store).
3. Exporter le certificat depuis Keychain Access → `.p12` (avec un mot de passe fort).
4. Pour CI/CD, encoder en base64 : `base64 -i cert.p12 | pbcopy` puis coller dans GitHub Secrets.

Variables d'environnement attendues dans la CI :
- `MAC_CSC_LINK` — chemin local ou base64 du `.p12` (electron-builder le détecte automatiquement)
- `MAC_CSC_KEY_PASSWORD` — mot de passe du `.p12`
- `APPLE_ID` — ton Apple ID (ex. `amaury.fischer@numerisk.fr`)
- `APPLE_APP_SPECIFIC_PASSWORD` — mot de passe spécifique à l'app généré sur https://appleid.apple.com
- `APPLE_TEAM_ID` — identifiant d'équipe à 10 caractères (visible sur developer.apple.com → Membership)

Dans `electron-builder.yml` (section `mac`), décommenter et remplir :
```yaml
identity: "Developer ID Application: Numerisk (<TeamID>)"
notarize: false   # passer à true
afterSign: scripts/notarize.js
```

### Certificat Windows — Code Signing

1. Obtenir un certificat **Extended Validation (EV)** ou **OV** auprès d'une autorité de certification reconnue :
   - **Sectigo / Comodo** — ~300 $/an (OV), ~500 $/an (EV recommandé pour éviter SmartScreen)
   - **DigiCert**, **GlobalSign** — alternatives similaires
2. Recevoir le `.pfx` (certificat + clé privée) et le protéger avec un mot de passe fort.
3. Pour CI/CD, encoder en base64 : `base64 -w 0 cert.pfx` puis coller dans GitHub Secrets.

Variables d'environnement attendues :
- `WIN_CSC_LINK` — chemin local ou base64 du `.pfx`
- `WIN_CSC_KEY_PASSWORD` — mot de passe du `.pfx`

Dans `electron-builder.yml` (section `win`), décommenter :
```yaml
certificateFile: ${env.WIN_CSC_LINK}
certificatePassword: ${env.WIN_CSC_KEY_PASSWORD}
signingHashAlgorithms: [sha256]
```

### Configuration des GitHub Secrets

Dans les paramètres du repo GitHub → **Settings → Secrets and variables → Actions**, ajouter :

| Secret | Description |
|--------|-------------|
| `MAC_CSC_LINK` | Certificat macOS (.p12) encodé en base64 |
| `MAC_CSC_KEY_PASSWORD` | Mot de passe du .p12 macOS |
| `WIN_CSC_LINK` | Certificat Windows (.pfx) encodé en base64 |
| `WIN_CSC_KEY_PASSWORD` | Mot de passe du .pfx Windows |
| `APPLE_ID` | Apple ID pour la notarisation |
| `APPLE_APP_SPECIFIC_PASSWORD` | Mot de passe spécifique app Apple |
| `APPLE_TEAM_ID` | Team ID Apple (10 caractères) |
| `GH_TOKEN` | GitHub token avec permission `write:packages` pour publier les releases |

### Script de notarization macOS

Le fichier `scripts/notarize.js` est appelé automatiquement par electron-builder après la signature
(via `afterSign` dans `electron-builder.yml`). Il requiert `@electron/notarize` :

```bash
pnpm --filter @supernote/desktop add -D @electron/notarize
```

Le script est non-bloquant : si les variables d'env ne sont pas définies ou si la notarisation
échoue, il logue un avertissement sans faire échouer le build. Cela permet de faire des builds
de développement non-signés sans modifier la config.
