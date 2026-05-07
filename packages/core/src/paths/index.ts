import { posix, relative, isAbsolute } from "node:path";
import type { Entity, EntityType } from "../types/index.js";

/** Slugify a display name for use in filenames */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Return path relative to vault root (always POSIX separators) */
export function vaultRelative(absPath: string, vaultRoot: string): string {
  if (!isAbsolute(absPath)) return absPath;
  const rel = relative(vaultRoot, absPath);
  return rel.split("\\").join("/"); // normalise on Windows-like paths in WSL
}

/**
 * Resolve a file path for an entity according to the EntityType's
 * `defaultPath` and `fileNamePattern`.
 *
 * Supported tokens in fileNamePattern: {id}, {name}, {slug}, {date}
 */
export function entityFilePath(
  entity: Entity,
  entityType: EntityType,
  vaultRoot: string,
): string {
  const name = String(entity.fields["name"] ?? entity.id);
  const date = new Date(entity.createdAt).toISOString().slice(0, 10);

  const fileName = entityType.fileNamePattern
    .replace("{id}", entity.id)
    .replace("{name}", slugify(name))
    .replace("{slug}", slugify(name))
    .replace("{date}", date);

  const filePath = posix.join(vaultRoot, entityType.defaultPath, `${fileName}.md`);
  return filePath;
}
