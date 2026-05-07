# Installation Supernote sur Windows

## Prérequis (à installer une seule fois)

1. **Node.js 22 LTS** — https://nodejs.org (clic "Recommended For Most Users")
2. **Git** — https://git-scm.com (si pas déjà installé)

C'est tout. `pnpm` sera activé automatiquement par le script d'install.

---

## Setup en 4 commandes

Ouvre PowerShell (`Win + R` → `powershell`) et :

```powershell
# 1. Clone le repo
git clone <ton-url-git> C:\Supernote
cd C:\Supernote

# 2. Autorise l'exécution des scripts pour cette session uniquement
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

# 3. Lance le script d'install
.\scripts\install-windows.ps1

# 4. Démarre Supernote
pnpm dev
```

Une fenêtre Electron s'ouvre, l'app démarre. Tes données sont stockées dans :

```
C:\Users\<ton-user>\Documents\Supernote\
```

---

## Build d'un installeur `.exe`

Quand tu veux générer un vrai installeur Windows :

```powershell
pnpm build:installer
```

L'installeur apparaît dans `apps\desktop\release\Supernote-0.0.0-Setup-x64.exe`. Double-clic pour l'installer comme une vraie app.

> Windows SmartScreen va probablement râler ("publisher inconnu") car on n'a pas signé l'app pour l'instant. Clic "Plus d'infos" → "Exécuter quand même". Pour signer l'app proprement il faut un certificat code-signing (~$300/an), à voir plus tard.

---

## Update vers une nouvelle version

```powershell
cd C:\Supernote
git pull
pnpm install
pnpm build:packages
pnpm dev
```

---

## Désinstallation

Si tu as juste cloné : `rm -rf C:\Supernote` (PowerShell : `Remove-Item -Recurse C:\Supernote`).

Si tu as installé via `.exe` : Panneau de configuration → Programmes → Supernote → Désinstaller.

Tes notes restent dans `C:\Users\<user>\Documents\Supernote\` (pas supprimées par la désinstallation — pour les supprimer, supprime ce dossier manuellement).

---

## Si ça plante au premier lancement

1. Vérifie que Node 22+ : `node --version` (doit dire `v22.x.x`)
2. Vérifie que pnpm est bien actif : `pnpm --version` (doit dire `11.x`)
3. Re-build les packages : `pnpm build:packages`
4. Si problème de port 3000 (déjà utilisé) : ferme l'app qui occupe le port, ou modifie `apps/web/package.json` pour utiliser un autre port (3100 par ex), et `package.json` racine pour `wait-on http://localhost:3100`.
5. Crée une issue avec le screenshot de l'erreur.

---

## Architecture une fois lancé

- **Renderer Next.js** (UI) tourne sur `http://localhost:3000`
- **Electron** charge cette URL et expose le filesystem + DB Prisma au renderer via tRPC over IPC
- Tout ton vault est dans `C:\Users\<user>\Documents\Supernote\` (notes en `.md`, DB SQLite dans `.supernote/index.db`)
- Tu peux ouvrir ton dossier `Supernote` dans VS Code/Obsidian/Finder en parallèle, les changements sont synchronisés
