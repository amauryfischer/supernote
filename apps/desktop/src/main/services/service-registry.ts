/**
 * Service registry — module-level singleton container.
 *
 * Provides access to VaultManager and the current PrismaClient without
 * needing to thread services through tRPC context (which has its own
 * generic constraints from @supernote/ipc).
 *
 * Initialized once in index.ts before the tRPC bridge is registered.
 */

import type { VaultManager } from "./vault-manager.js";
import type { PrismaClient } from "@supernote/db";

let _vaultManager: VaultManager | null = null;

export function setVaultManager(vm: VaultManager): void {
  _vaultManager = vm;
}

export function getVaultManager(): VaultManager {
  if (!_vaultManager) throw new Error("VaultManager not initialized");
  return _vaultManager;
}

export function getCurrentPrisma(): PrismaClient | null {
  return _vaultManager?.getCurrentPrisma() ?? null;
}
