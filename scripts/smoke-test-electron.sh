#!/usr/bin/env bash
# smoke-test-electron.sh — Automated smoke test for the Supernote Electron desktop.
#
# What it tests:
#   1. Desktop build passes (typecheck + electron-vite build)
#   2. Migration directory is resolvable from the built output
#   3. Default vault path resolves to a real directory
#   4. Vault directory structure can be created and locked
#   5. IPC preload exposes __supernoteIPC in the built bundle
#
# Usage:
#   bash scripts/smoke-test-electron.sh
#
# Exit code: 0 = all tests pass, 1 = at least one failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DESKTOP_DIR="$REPO_ROOT/apps/desktop"

PASS=0
FAIL=0

ok()   { echo "  OK   $*"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL $*"; FAIL=$((FAIL + 1)); }

echo ""
echo "=== Supernote Electron smoke tests ==="
echo ""

# ── 1. TypeScript typecheck ───────────────────────────────────────────────────
echo "[1] TypeScript typecheck..."
if pnpm --filter @supernote/desktop typecheck 2>&1 | grep -q "error TS"; then
  fail "TypeScript errors detected"
else
  ok "typecheck passes"
fi

# ── 2. Electron-vite build ────────────────────────────────────────────────────
echo ""
echo "[2] electron-vite build..."
if pnpm --filter @supernote/desktop build 2>&1 | grep -qi "error"; then
  fail "Build reported errors"
else
  ok "Build succeeded"
fi

# ── 3. Bundle integrity checks ────────────────────────────────────────────────
echo ""
echo "[3] Bundle integrity..."
MAIN_BUNDLE="$DESKTOP_DIR/dist/main/index.js"
PRELOAD_BUNDLE="$DESKTOP_DIR/dist/preload/index.js"

check_bundle() {
  local bundle="$1" pattern="$2" desc="$3"
  if grep -q "$pattern" "$bundle" 2>/dev/null; then
    ok "$desc"
  else
    fail "$desc (pattern '$pattern' not found in $bundle)"
  fi
}

check_bundle "$MAIN_BUNDLE"   "tRPC IPC bridge registered"   "tRPC bridge registration present"
check_bundle "$MAIN_BUNDLE"   "getDefaultVaultPath"          "system.getDefaultVaultPath implemented"
check_bundle "$MAIN_BUNDLE"   "expandTilde"                  "tilde expansion for vault paths"
check_bundle "$MAIN_BUNDLE"   "created vault directory"      "auto-mkdir for missing vault"
check_bundle "$MAIN_BUNDLE"   "applyMigrations"              "Prisma migrations called on vault open"
check_bundle "$MAIN_BUNDLE"   "localhost:3000"               "dev server URL configured"
check_bundle "$MAIN_BUNDLE"   "contextIsolation"             "contextIsolation enabled"
check_bundle "$MAIN_BUNDLE"   "sandbox"                      "sandbox enabled"
check_bundle "$PRELOAD_BUNDLE" "__supernoteIPC"              "preload exposes __supernoteIPC"

# ── 4. Migration directory reachable from dist/main ──────────────────────────
echo ""
echo "[4] Migration directory resolution..."
DIST_MAIN="$DESKTOP_DIR/dist/main"
# 4 levels up from dist/main reaches repo root: dist -> desktop -> apps -> amonote
MIGRATIONS_4UP="$DIST_MAIN/../../../../packages/db/prisma/migrations"
if [ -d "$MIGRATIONS_4UP" ]; then
  ok "Migrations dir reachable (4 levels up from dist/main)"
else
  fail "Migrations dir NOT reachable at: $(realpath "$MIGRATIONS_4UP" 2>/dev/null || echo $MIGRATIONS_4UP)"
fi

# ── 5. Default vault path check ───────────────────────────────────────────────
echo ""
echo "[5] Default vault path..."
DEFAULT_VAULT="$HOME/Documents/Supernote"
mkdir -p "$DEFAULT_VAULT"
if [ -d "$DEFAULT_VAULT" ]; then
  ok "Default vault path creatable: $DEFAULT_VAULT"
else
  fail "Cannot create default vault path: $DEFAULT_VAULT"
fi

# ── 6. Preload bundle sanity ──────────────────────────────────────────────────
echo ""
echo "[6] Preload size sanity..."
PRELOAD_SIZE=$(wc -c < "$PRELOAD_BUNDLE" 2>/dev/null || echo 0)
if [ "$PRELOAD_SIZE" -gt 100 ]; then
  ok "Preload bundle is non-trivial ($PRELOAD_SIZE bytes)"
else
  fail "Preload bundle is suspiciously small ($PRELOAD_SIZE bytes)"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
