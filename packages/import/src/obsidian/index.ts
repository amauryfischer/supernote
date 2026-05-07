import fs from "node:fs/promises";
import path from "node:path";
import type { ImportOptions, ImportResult, NoteRecord } from "../types.js";
import {
  emptyResult,
  addError,
  addWarning,
  incNotes,
  incAssets,
  incSkipped,
} from "../utils/result.js";
import { generateId } from "../utils/id.js";
import { parseMarkdown, buildMarkdown, extractHashtags } from "../utils/markdown.js";
import { logger } from "../utils/logger.js";

const ASSET_DIRS = new Set(["_assets", "attachments", "assets", "files"]);
const ASSET_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf", ".mp3", ".mp4", ".wav"]);

/** Map Obsidian frontmatter keys to Supernote equivalents */
function mapObsidianFrontmatter(
  original: Record<string, unknown>,
  relativePath: string
): Record<string, unknown> {
  const id = generateId();
  const now = new Date().toISOString();

  const created =
    (original["created"] as string | undefined) ??
    (original["date"] as string | undefined) ??
    (original["dateCreated"] as string | undefined) ??
    now;

  const updated =
    (original["updated"] as string | undefined) ??
    (original["modified"] as string | undefined) ??
    (original["dateModified"] as string | undefined) ??
    now;

  const fm: Record<string, unknown> = {
    id,
    type: (original["type"] as string | undefined) ?? "note",
    created,
    updated,
    source: "obsidian",
    originalPath: relativePath,
    fields: {},
  };

  // Pass through common Obsidian fields into fields map
  const passthrough = ["aliases", "cssclass", "publish", "template", "status", "priority"];
  const fields: Record<string, unknown> = {};
  for (const key of passthrough) {
    if (key in original) fields[key] = original[key];
  }
  if (Object.keys(fields).length > 0) fm["fields"] = fields;

  // Collect tags from both frontmatter tags and inline #tags
  const fmTags = original["tags"];
  let tags: string[] = [];
  if (Array.isArray(fmTags)) {
    tags = fmTags.filter((t): t is string => typeof t === "string");
  } else if (typeof fmTags === "string") {
    tags = [fmTags];
  }
  if (tags.length > 0) fm["tags"] = tags;

  return fm;
}

/** Detect if a path is inside an asset directory */
function isAssetPath(relativePath: string): boolean {
  const parts = relativePath.split(path.sep);
  return parts.some((p) => ASSET_DIRS.has(p.toLowerCase()));
}

/** Detect if file is an asset by extension */
function isAssetFile(filePath: string): boolean {
  return ASSET_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/** Walk directory, skipping hidden dirs except .obsidian for metadata */
async function walkVault(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // skip .obsidian, .git, etc.
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkVault(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

/** Process a single Obsidian markdown file */
async function processObsidianFile(
  filePath: string,
  relativePath: string,
  opts: ImportOptions
): Promise<NoteRecord> {
  const raw = await fs.readFile(filePath, "utf-8");
  const { frontmatter, body } = parseMarkdown(raw);

  const fm = mapObsidianFrontmatter(frontmatter, relativePath);

  // Merge hashtag-style tags found in the body
  const inlineTags = extractHashtags(body);
  if (inlineTags.length > 0) {
    const existing = Array.isArray(fm["tags"]) ? (fm["tags"] as string[]) : [];
    fm["tags"] = [...new Set([...existing, ...inlineTags])];
  }

  const tags = Array.isArray(fm["tags"]) ? (fm["tags"] as string[]) : [];
  const folder = opts.defaultFolder ?? "Imports/Obsidian/";
  const outputRelPath = opts.preserveHierarchy !== false ? relativePath : path.basename(relativePath);

  return {
    id: fm["id"] as string,
    filePath: path.join(opts.targetVaultRoot, folder, outputRelPath),
    frontmatter: fm,
    body,
    tags,
  };
}

/** Main Obsidian vault importer */
export async function importObsidian(
  vaultPath: string,
  opts: ImportOptions
): Promise<ImportResult> {
  logger.info({ vaultPath }, "Starting Obsidian import");
  let result = emptyResult();

  let allFiles: string[];
  try {
    allFiles = await walkVault(vaultPath);
  } catch (err) {
    return addError(emptyResult(), vaultPath, `Cannot read vault: ${String(err)}`, err);
  }

  const folder = opts.defaultFolder ?? "Imports/Obsidian/";

  for (const filePath of allFiles) {
    const relativePath = path.relative(vaultPath, filePath);
    const ext = path.extname(filePath).toLowerCase();

    try {
      if (ext === ".md") {
        const record = await processObsidianFile(filePath, relativePath, opts);

        if (!opts.dryRun) {
          await fs.mkdir(path.dirname(record.filePath), { recursive: true });
          const content = buildMarkdown(record.frontmatter, record.body);
          await fs.writeFile(record.filePath, content, "utf-8");
          await opts.resolvers.writeNote?.(record);
        }
        result = incNotes(result);
        logger.debug({ path: record.filePath }, "Imported Obsidian note");
      } else if (ext === ".canvas") {
        // Canvas files are already Obsidian-compatible, copy as-is
        const destPath = path.join(opts.targetVaultRoot, folder, relativePath);

        if (!opts.dryRun) {
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          const content = await fs.readFile(filePath);
          await fs.writeFile(destPath, content);
        }
        result = incNotes(result);
        logger.debug({ path: relativePath }, "Copied Obsidian canvas");
      } else if (isAssetPath(relativePath) || isAssetFile(filePath)) {
        const destPath = path.join(opts.targetVaultRoot, folder, "_assets", path.basename(filePath));

        if (!opts.dryRun) {
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          const content = await fs.readFile(filePath);
          await fs.writeFile(destPath, content);
          await opts.resolvers.writeAsset?.(destPath, content);
        }
        result = incAssets(result);
      } else {
        result = incSkipped(result);
        result = addWarning(result, `Skipped unknown file type: ${relativePath}`);
      }
    } catch (err) {
      logger.error({ err, filePath }, "Error processing Obsidian file");
      result = addError(result, relativePath, String(err), err);
    }
  }

  logger.info({ result }, "Obsidian import complete");
  return result;
}
