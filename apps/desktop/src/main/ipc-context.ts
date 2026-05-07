/**
 * Extended IPC context used by the desktop main process.
 *
 * Augments the base IpcContext from @supernote/ipc with runtime services
 * (VaultManager, PrismaClient) that resolvers need to do their work.
 *
 * The appRouterImpl uses this richer context internally; the shape exposed
 * to the renderer remains the same narrow contract (vaultPath: string|null).
 */

import type { PrismaClient } from "@supernote/db";
import type { VaultManager } from "./services/vault-manager.js";

export interface DesktopContext {
  /** Absolute path of the currently open vault, or null. (mirrors IpcContext) */
  vaultPath: string | null;
  /** Live VaultManager instance — always present. */
  vaultManager: VaultManager;
  /** Prisma client for the current vault, or null if no vault is open. */
  prisma: PrismaClient | null;
}
