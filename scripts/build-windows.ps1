# Supernote — Build de l'installeur Windows .exe (PowerShell)
# Utilise Next.js output:standalone + Electron Builder portable
#
# Usage depuis la racine du repo :
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
#   .\scripts\build-windows.ps1
#
# Prérequis : Node >= 22, pnpm >= 11

$ErrorActionPreference = "Stop"

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Write-Step {
  param([string]$Num, [string]$Msg)
  Write-Host ""
  Write-Host "[$Num] $Msg" -ForegroundColor Cyan
}

function Write-OK { param([string]$Msg); Write-Host "    OK: $Msg" -ForegroundColor Green }
function Write-Fail { param([string]$Msg); Write-Host "    FAIL: $Msg" -ForegroundColor Red }

Write-Host ""
Write-Host "================================================" -ForegroundColor Magenta
Write-Host "  Supernote - Build installeur Windows (.exe)   " -ForegroundColor Magenta
Write-Host "  Mode: Next.js standalone + Electron Builder   " -ForegroundColor Magenta
Write-Host "================================================" -ForegroundColor Magenta
Write-Host ""

# 0. Verif racine repo
if (-not (Test-Path "package.json")) {
  Write-Fail "Ce script doit etre lance depuis la racine du repo."
  Write-Host "  cd C:\chemin\vers\supernote"
  exit 1
}

# 1. Node 22+
Write-Step "1" "Verification Node.js..."
if (-not (Test-Command node)) {
  Write-Fail "Node.js n'est pas installe. Telecharge Node 22 LTS : https://nodejs.org"
  exit 1
}
$nodeVer = (node --version) -replace 'v', ''
$nodeMajor = [int]($nodeVer.Split('.')[0])
if ($nodeMajor -lt 22) {
  Write-Host "  AVERTISSEMENT: Node $nodeVer detecte, recommande Node >= 22 LTS" -ForegroundColor Yellow
} else {
  Write-OK "Node $nodeVer"
}

# 2. pnpm
Write-Step "2" "Verification pnpm..."
if (-not (Test-Command pnpm)) {
  Write-Host "  pnpm absent, tentative d'activation via corepack..." -ForegroundColor Yellow
  corepack enable
  if (-not (Test-Command pnpm)) {
    Write-Host "  Ou installe via : npm install -g pnpm@11" -ForegroundColor Yellow
    Write-Fail "pnpm introuvable"
    exit 1
  }
}
Write-OK "pnpm $(pnpm --version)"

# 3. Install deps
Write-Step "3" "Installation des dependances (pnpm install)..."
pnpm install
if ($LASTEXITCODE -ne 0) { Write-Fail "pnpm install echoue"; exit 1 }
Write-OK "Dependances installees"

# 4. Build packages internes
Write-Step "4" "Build packages internes (pnpm build:packages)..."
pnpm build:packages
if ($LASTEXITCODE -ne 0) { Write-Fail "build:packages echoue"; exit 1 }
Write-OK "Packages buildes"

# 5. Patch dist files — inject "use client" into @supernote/* dist files
Write-Step "5" "Patch dist — injection 'use client' dans les packages UI..."
node scripts/patch-ui-dist.mjs
if ($LASTEXITCODE -ne 0) { Write-Fail "patch-ui-dist echoue"; exit 1 }
Write-OK "Dist files patches"

# 6. Build Next.js standalone
Write-Step "6" "Build Next.js standalone (NEXT_BUILD_MODE=production)..."
$env:NEXT_BUILD_MODE = "production"
pnpm --filter "@supernote/web" build
if ($LASTEXITCODE -ne 0) { Write-Fail "Next.js build echoue"; exit 1 }
# In pnpm monorepo, standalone mirrors workspace path: apps/web/.next/standalone/apps/web/server.js
$serverPath = "apps\web\.next\standalone\apps\web\server.js"
if (-not (Test-Path $serverPath)) {
  Write-Fail "$serverPath introuvable apres le build"
  exit 1
}
Write-OK "Next.js standalone genere"

# 7. Resoudre les symlinks pnpm pour electron-builder
# Sur Windows, pnpm cree des junctions/symlinks — on utilise robocopy pour tout copier.
Write-Step "7" "Resolution des symlinks pnpm (robocopy)..."
$standaloneDir = "apps\web\.next\standalone"
$resolvedDir = "apps\web\.next\standalone-resolved"
if (Test-Path $resolvedDir) { Remove-Item -Recurse -Force $resolvedDir }
# /E: tous sous-dossiers y compris vides, /SL: suivre les symlinks, /COPYALL: tous attributs
# Robocopy renvoie 0-7 en cas de succes (>= 8 = erreur)
robocopy $standaloneDir $resolvedDir /E /SL /COPYALL /NFL /NDL /NJH /NJS
$rcExit = $LASTEXITCODE
if ($rcExit -ge 8) {
  Write-Fail "robocopy echoue (code $rcExit)"
  exit 1
}
Write-OK "standalone-resolved cree"

# 8. Build desktop (electron-vite)
Write-Step "8" "Build electron-vite (main + preload)..."
pnpm --filter "@supernote/desktop" build
if ($LASTEXITCODE -ne 0) { Write-Fail "build desktop echoue"; exit 1 }
Write-OK "Electron main + preload buildes"

# 9. Package Windows portable
Write-Step "9" "Package electron-builder portable (--win x64)..."
pnpm --filter "@supernote/desktop" package:win
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) { Write-Fail "electron-builder echoue (code $exitCode)"; exit 1 }

# 10. Localise le .exe
Write-Step "10" "Recherche du .exe..."
$exeFiles = Get-ChildItem -Path "apps\desktop\release" -Filter "*portable*.exe" -Recurse -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "================================================" -ForegroundColor Magenta
Write-Host "  BUILD TERMINE AVEC SUCCES" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Magenta
Write-Host ""

if ($exeFiles) {
  foreach ($f in $exeFiles) {
    $sizeMB = [math]::Round($f.Length / 1MB, 1)
    Write-Host "  Installeur : $($f.FullName)" -ForegroundColor Yellow
    Write-Host "  Taille     : $sizeMB MB" -ForegroundColor Yellow
  }
} else {
  Write-Host "  .exe genere dans : apps\desktop\release\" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Pour lancer :"
Write-Host "  Double-cliquez sur le .exe"
Write-Host "  Si Windows SmartScreen s'affiche : 'Informations complementaires' > 'Executer quand meme'"
Write-Host "  (pas de signature de code - comportement normal pour build local)"
Write-Host ""
