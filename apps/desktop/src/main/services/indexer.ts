/**
 * Indexer — builds and maintains the SQLite index for a vault.
 *
 * reindexVault: full scan of all markdown files in the vault root.
 * reindexFile: incremental update for a single file.
 *
 * Uses @supernote/core for markdown parsing.
 * Runs synchronously in the main process (Worker thread upgrade is a TODO).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { PrismaClient } from "@supernote/db";
import { parseMarkdownFile } from "@supernote/core";
import { logger } from "../logger.js";

const MARKDOWN_EXT = new Set([".md", ".markdown"]);
const EXCLUDE_DIRS = new Set([".supernote", "node_modules", ".git"]);

function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

function walkMarkdown(dir: string): string[] {
  const result: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name)) {
        result.push(...walkMarkdown(path.join(dir, entry.name)));
      }
    } else if (entry.isFile() && MARKDOWN_EXT.has(path.extname(entry.name).toLowerCase())) {
      result.push(path.join(dir, entry.name));
    }
  }
  return result;
}

export async function reindexFile(
  prisma: PrismaClient,
  vaultId: string,
  vaultRoot: string,
  absPath: string,
): Promise<void> {
  let content: string;
  try {
    content = fs.readFileSync(absPath, "utf-8");
  } catch {
    // File deleted — remove from index
    await prisma.entity.deleteMany({ where: { vaultId, filePath: absPath } });
    logger.debug("reindexFile: removed deleted file", { absPath });
    return;
  }

  const hash = hashContent(content);
  const parsed = parseMarkdownFile(content);
  const fm = parsed.frontmatter;

  const entityId = typeof fm["id"] === "string" ? fm["id"] : null;
  if (!entityId) {
    logger.debug("reindexFile: skipping file without id in frontmatter", { absPath });
    return;
  }

  const typeId = typeof fm["type"] === "string" ? fm["type"] : null;

  // Find or resolve typeId by name
  let resolvedTypeId: string | null = null;
  if (typeId) {
    const et = await prisma.entityType.findFirst({
      where: { vaultId, name: typeId },
      select: { id: true },
    });
    resolvedTypeId = et?.id ?? null;
  }

  if (!resolvedTypeId) {
    logger.debug("reindexFile: unknown entity type, skipping", { absPath, typeId });
    return;
  }

  const fields = typeof fm["fields"] === "object" && fm["fields"] !== null
    ? (fm["fields"] as Record<string, unknown>)
    : {};
  const body = parsed.body.trim();

  await prisma.entity.upsert({
    where: { id: entityId },
    update: {
      filePath: absPath,
      typeId: resolvedTypeId,
      fields: JSON.stringify(fields),
      body,
      fileHash: hash,
      updatedAt: new Date(),
    },
    create: {
      id: entityId,
      vaultId,
      typeId: resolvedTypeId,
      filePath: absPath,
      fields: JSON.stringify(fields),
      body,
      fileHash: hash,
    },
  });

  logger.debug("reindexFile: upserted entity", { entityId, absPath });
}

export async function reindexVault(
  prisma: PrismaClient,
  vaultId: string,
  vaultRoot: string,
): Promise<void> {
  logger.info("reindexVault started", { vaultId, vaultRoot });
  const files = walkMarkdown(vaultRoot);
  let count = 0;
  for (const file of files) {
    try {
      await reindexFile(prisma, vaultId, vaultRoot, file);
      count++;
    } catch (err) {
      logger.warn("reindexVault: error on file", { file, err: String(err) });
    }
  }
  logger.info("reindexVault complete", { vaultId, count });
}
