/**
 * Factory for per-vault Prisma clients.
 *
 * Each vault has its own SQLite database at <rootPath>/.supernote/index.db.
 * We create a fresh PrismaClient per vault open and disconnect on close.
 */

import { createClient } from "@supernote/db";
import type { PrismaClient } from "@supernote/db";
import { logger } from "../logger.js";

export type { PrismaClient };

/**
 * Create a PrismaClient bound to the given absolute DB file path.
 * The caller is responsible for calling `prisma.$disconnect()` on close.
 */
export function createPrismaForVault(dbPath: string): PrismaClient {
  const url = `file:${dbPath}`;
  logger.info("Creating Prisma client", { dbPath });
  return createClient(url);
}

/**
 * Disconnect and free resources for a Prisma client.
 * Safe to call multiple times.
 */
export async function disconnectPrisma(prisma: PrismaClient): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info("Prisma client disconnected");
  } catch (err) {
    logger.error("Failed to disconnect Prisma", { err: String(err) });
  }
}
