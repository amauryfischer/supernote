# Supernote — Installation Windows (PowerShell)
# Usage : Clic droit sur ce fichier > "Exécuter avec PowerShell"
#         OU dans un terminal PowerShell :
#         Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#         .\scripts\install-windows.ps1

$ErrorActionPreference = "Stop"

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Host ""
Write-Host "=== Supernote — Installation Windows ===" -ForegroundColor Magenta
Write-Host ""

# 1. Vérifie Node 22+
Write-Host "1. Vérification de Node.js..." -ForegroundColor Cyan
if (-not (Test-Command node)) {
  Write-Host "   ❌ Node.js n'est pas installé." -ForegroundColor Red
  Write-Host "   Télécharge Node 22 LTS sur https://nodejs.org puis relance ce script."
  exit 1
}
$nodeVersion = (node --version) -replace 'v', ''
$major = [int]($nodeVersion.Split('.')[0])
if ($major -lt 22) {
  Write-Host "   ⚠️  Node $nodeVersion détecté. Recommandé : Node 22 LTS." -ForegroundColor Yellow
}
Write-Host "   ✅ Node $nodeVersion" -ForegroundColor Green

# 2. Active corepack + pnpm
Write-Host ""
Write-Host "2. Activation de pnpm via corepack..." -ForegroundColor Cyan
corepack enable | Out-Null
if (-not (Test-Command pnpm)) {
  Write-Host "   ❌ pnpm n'a pas pu être activé via corepack." -ForegroundColor Red
  Write-Host "   Essaie : npm install -g pnpm@11"
  exit 1
}
$pnpmVersion = pnpm --version
Write-Host "   ✅ pnpm $pnpmVersion" -ForegroundColor Green

# 3. Vérifie qu'on est à la racine du repo
if (-not (Test-Path "package.json")) {
  Write-Host ""
  Write-Host "❌ Ce script doit être lancé depuis la racine du repo Supernote." -ForegroundColor Red
  Write-Host "   cd C:\chemin\vers\supernote"
  exit 1
}

# 4. pnpm install
Write-Host ""
Write-Host "3. Installation des dépendances (peut prendre 2-5 min)..." -ForegroundColor Cyan
pnpm install
if ($LASTEXITCODE -ne 0) { Write-Host "❌ pnpm install a échoué." -ForegroundColor Red; exit 1 }
Write-Host "   ✅ Dépendances installées" -ForegroundColor Green

# 5. Build des packages internes
Write-Host ""
Write-Host "4. Build des packages internes (1-2 min)..." -ForegroundColor Cyan
pnpm build:packages
if ($LASTEXITCODE -ne 0) { Write-Host "❌ build:packages a échoué." -ForegroundColor Red; exit 1 }
Write-Host "   ✅ Packages buildés" -ForegroundColor Green

# 6. Prisma client
Write-Host ""
Write-Host "5. Génération du client Prisma..." -ForegroundColor Cyan
pnpm --filter "@supernote/db" db:generate
if ($LASTEXITCODE -ne 0) { Write-Host "⚠️  Prisma generate a échoué — pas bloquant." -ForegroundColor Yellow }

Write-Host ""
Write-Host "=== Installation terminée ===" -ForegroundColor Magenta
Write-Host ""
Write-Host "Pour lancer Supernote en mode développement :"
Write-Host "   pnpm dev" -ForegroundColor Yellow
Write-Host ""
Write-Host "Cela démarre :"
Write-Host "   • Le renderer Next.js sur http://localhost:3000"
Write-Host "   • La fenêtre Electron qui charge le renderer"
Write-Host ""
Write-Host "Pour build un installeur .exe :"
Write-Host "   pnpm build:installer" -ForegroundColor Yellow
Write-Host ""
Write-Host "L'installeur sera dans : apps\desktop\release\"
Write-Host ""
