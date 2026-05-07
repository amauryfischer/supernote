/**
 * FileIO — atomic file operations with per-path mutex.
 *
 * Write strategy: write to .tmp file then rename (atomic on POSIX).
 * Trash: moves to OS trash via shell.trashItem() (Electron built-in).
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { shell } from "electron";
import matter from "gray-matter";
import { logger } from "../logger.js";

type Lock = Promise<void>;

const locks = new Map<string, Lock>();

/** Run fn exclusively for the given path key. */
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let resolve!: () => void;
  const next = new Promise<void>((res) => {
    resolve = res;
  });
  locks.set(key, next);
  await prev;
  try {
    return await fn();
  } finally {
    resolve();
    if (locks.get(key) === next) locks.delete(key);
  }
}

// ── Public interface ────────────────────────────────────────────────────────

export interface ParsedEntity {
  frontmatter: Record<string, unknown>;
  body: string;
}

/** Compute SHA-256 of file content. Returns hex string. */
export function hashFile(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

/** Parse a markdown file into frontmatter + body. */
export async function readEntity(absPath: string): Promise<ParsedEntity> {
  const raw = await fs.promises.readFile(absPath, "utf-8");
  const { data, content } = matter(raw);
  return { frontmatter: data as Record<string, unknown>, body: content };
}

/** Atomically write a markdown entity file. */
export async function writeEntity(
  absPath: string,
  frontmatter: Record<string, unknown>,
  body: string,
): Promise<void> {
  return withLock(absPath, async () => {
    const content = matter.stringify(body, frontmatter);
    const tmpPath = `${absPath}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmpPath, content, "utf-8");
    await fs.promises.rename(tmpPath, absPath);
    logger.debug("writeEntity", { absPath });
  });
}

/** Delete an entity file, optionally moving to OS trash. */
export async function deleteEntity(absPath: string, moveToTrash = true): Promise<void> {
  if (moveToTrash) {
    const result = await shell.trashItem(absPath);
    if (result !== undefined) {
      // shell.trashItem returns void on success; non-void indicates error object
      logger.warn("trashItem may have failed", { absPath });
    }
  } else {
    await fs.promises.rm(absPath, { force: true });
  }
  logger.debug("deleteEntity", { absPath, moveToTrash });
}

/** Ensure a directory exists (recursive). */
export async function ensureDir(dirPath: string): Promise<void> {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

/** Move a file atomically (rename, with cross-device fallback). */
export async function move(src: string, dest: string): Promise<void> {
  await ensureDir(path.dirname(dest));
  try {
    await fs.promises.rename(src, dest);
  } catch (err: unknown) {
    // EXDEV = cross-device rename, fall back to copy+unlink
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      await fs.promises.copyFile(src, dest);
      await fs.promises.unlink(src);
    } else {
      throw err;
    }
  }
}

/** Copy a file, creating destination directory if needed. */
export async function copy(src: string, dest: string): Promise<void> {
  await ensureDir(path.dirname(dest));
  await fs.promises.copyFile(src, dest);
}

/** Write any file content atomically. */
export async function writeAtomic(absPath: string, content: string): Promise<void> {
  return withLock(absPath, async () => {
    await ensureDir(path.dirname(absPath));
    const tmp = path.join(os.tmpdir(), `sn-${process.pid}-${Date.now()}.tmp`);
    await fs.promises.writeFile(tmp, content, "utf-8");
    await fs.promises.rename(tmp, absPath);
  });
}
