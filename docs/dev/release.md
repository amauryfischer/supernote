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
