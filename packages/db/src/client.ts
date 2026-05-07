import { PrismaClient } from "./generated/prisma/index.js";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";

export type { PrismaClient };

/**
 * Creates a typed Prisma client connected to the SQLite database at the
 * given absolute file path.
 *
 * Only call this from the Electron main process — never from the renderer.
 *
 * @param databaseUrl - File URL, e.g. "file:/absolute/path/to/index.db"
 */
export function createClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaBetterSQLite3({ url: databaseUrl });
  return new PrismaClient({
    adapter,
    log:
      process.env["NODE_ENV"] === "development"
        ? ["query", "warn", "error"]
        : ["warn", "error"],
  } as ConstructorParameters<typeof PrismaClient>[0]);
}
