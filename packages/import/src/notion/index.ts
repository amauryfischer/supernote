import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import yauzl from "yauzl";
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
import { parseMarkdown, buildMarkdown, sanitizeFilename } from "../utils/markdown.js";
import { logger } from "../utils/logger.js";

/** Extract a ZIP archive to a temp directory, return its path */
async function extractZip(zipPath: string): Promise<string> {
  const tmpDir = path.join(
    path.dirname(zipPath),
    `.notion-import-${Date.now()}`
  );
  await fs.mkdir(tmpDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) { reject(err ?? new Error("Cannot open zip")); return; }
      zip.readEntry();
      zip.on("entry", (entry: yauzl.Entry) => {
        const entryPath = path.join(tmpDir, entry.fileName);
        if (/\/$/.test(entry.fileName)) {
          fs.mkdir(entryPath, { recursive: true }).then(() => zip.readEntry()).catch(reject);
        } else {
          fs.mkdir(path.dirname(entryPath), { recursive: true })
            .then(() => {
              zip.openReadStream(entry, (streamErr, readStream) => {
                if (streamErr || !readStream) { reject(streamErr); return; }
                const ws = createWriteStream(entryPath);
                readStream.pipe(ws);
                ws.on("close", () => zip.readEntry());
                ws.on("error", reject);
              });
            })
            .catch(reject);
        }
      });
      zip.on("end", resolve);
      zip.on("error", reject);
    });
  });

  return tmpDir;
}

/** Convert Notion page title to Supernote-safe filename */
function notionTitleToFilename(title: string): string {
  return sanitizeFilename(title) + ".md";
}

/** Map Notion frontmatter fields to Supernote format */
function mapNotionFrontmatter(
  original: Record<string, unknown>,
  relativePath: string,
  parentTitle?: string
): Record<string, unknown> {
  const id = generateId();
  const now = new Date().toISOString();
  const fm: Record<string, unknown> = {
    id,
    type: "note",
    created: (original["created"] as string | undefined) ?? now,
    updated: (original["updated"] as string | undefined) ?? now,
    source: "notion",
    originalPath: relativePath,
    fields: {},
  };

  if (parentTitle) {
    fm["fields"] = { ...(fm["fields"] as Record<string, unknown>), parent: `[[${parentTitle}]]` };
  }

  const tags: string[] = [];
  const notionTags = original["tags"];
  if (Array.isArray(notionTags)) {
    for (const t of notionTags) {
      if (typeof t === "string") tags.push(t);
    }
  }
  if (tags.length > 0) fm["tags"] = tags;

  return fm;
}

/** Add parent backlink to body if parent exists */
function addParentBacklink(body: string, parentTitle: string): string {
  return `**Source :** [[${parentTitle}]]\n\n${body}`;
}

/** Process a single Notion markdown file */
async function processNotionFile(
  filePath: string,
  relativePath: string,
  opts: ImportOptions,
  parentTitle?: string
): Promise<{ record: NoteRecord; body: string }> {
  const raw = await fs.readFile(filePath, "utf-8");
  const { frontmatter, body } = parseMarkdown(raw);

  let processedBody = body;
  if (parentTitle) {
    processedBody = addParentBacklink(body, parentTitle);
  }

  const fm = mapNotionFrontmatter(frontmatter, relativePath, parentTitle);
  const tags = Array.isArray(fm["tags"]) ? (fm["tags"] as string[]) : [];

  const outputRelPath = opts.preserveHierarchy !== false ? relativePath : path.basename(relativePath);
  const folder = opts.defaultFolder ?? "Imports/Notion/";

  const record: NoteRecord = {
    id: fm["id"] as string,
    filePath: path.join(opts.targetVaultRoot, folder, outputRelPath),
    frontmatter: fm,
    body: processedBody,
    tags,
  };

  return { record, body: buildMarkdown(fm, processedBody) };
}

/** Check if a file is a Notion CSV database export */
function isNotionCsv(filePath: string): boolean {
  return filePath.endsWith(".csv");
}

/** Convert Notion CSV to a basic EntityType suggestion note */
async function processCsvAsEntityType(
  filePath: string,
  relativePath: string,
  opts: ImportOptions
): Promise<NoteRecord> {
  const raw = await fs.readFile(filePath, "utf-8");
  const lines = raw.split("\n");
  const headers = lines[0]?.split(",").map((h) => h.trim().replace(/^"|"$/g, "")) ?? [];

  const id = generateId();
  const folder = opts.defaultFolder ?? "Imports/Notion/";
  const baseName = path.basename(relativePath, ".csv");

  const fm: Record<string, unknown> = {
    id,
    type: "note",
    source: "notion-csv",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    fields: { csvColumns: headers, suggestedEntityType: baseName },
  };

  const body = [
    `# ${baseName} (Notion Database Import)`,
    "",
    `> This file was imported from a Notion CSV export. Consider creating a custom EntityType for it.`,
    "",
    `## Columns`,
    headers.map((h) => `- \`${h}\``).join("\n"),
    "",
    `## Raw data (first 5 rows)`,
    "```csv",
    lines.slice(0, 6).join("\n"),
    "```",
  ].join("\n");

  return {
    id,
    filePath: path.join(opts.targetVaultRoot, folder, path.dirname(relativePath), `${baseName}.md`),
    frontmatter: fm,
    body,
    tags: ["notion-database"],
  };
}

/** Walk a directory recursively and collect file paths */
async function walkDir(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

/** Main Notion importer */
export async function importNotion(
  zipPath: string,
  opts: ImportOptions
): Promise<ImportResult> {
  logger.info({ zipPath }, "Starting Notion import");
  let result = emptyResult();
  let tmpDir: string | undefined;

  try {
    tmpDir = await extractZip(zipPath);
    const allFiles = await walkDir(tmpDir);

    for (const filePath of allFiles) {
      const relativePath = path.relative(tmpDir, filePath);
      const ext = path.extname(filePath).toLowerCase();

      try {
        if (ext === ".md") {
          const parts = relativePath.split(path.sep);
          const parentTitle = parts.length > 1 ? parts[parts.length - 2] : undefined;

          const { record, body } = await processNotionFile(
            filePath,
            relativePath,
            opts,
            parentTitle
          );

          if (!opts.dryRun) {
            await fs.mkdir(path.dirname(record.filePath), { recursive: true });
            await fs.writeFile(record.filePath, body, "utf-8");
            await opts.resolvers.writeNote?.(record);
          }
          result = incNotes(result);
          logger.debug({ path: record.filePath }, "Imported Notion note");
        } else if (ext === ".csv") {
          const record = await processCsvAsEntityType(filePath, relativePath, opts);

          if (!opts.dryRun) {
            await fs.mkdir(path.dirname(record.filePath), { recursive: true });
            await fs.writeFile(record.filePath, buildMarkdown(record.frontmatter, record.body), "utf-8");
            await opts.resolvers.writeNote?.(record);
          }
          result = incNotes(result);
          result = addWarning(result, `CSV database '${relativePath}' imported as note — consider creating a custom EntityType.`);
        } else if ([".png", ".jpg", ".jpeg", ".gif", ".pdf", ".webp", ".svg"].includes(ext)) {
          const destFolder = opts.defaultFolder ?? "Imports/Notion/";
          const destPath = path.join(opts.targetVaultRoot, destFolder, "_assets", path.basename(filePath));

          if (!opts.dryRun) {
            await fs.mkdir(path.dirname(destPath), { recursive: true });
            const content = await fs.readFile(filePath);
            await fs.writeFile(destPath, content);
            await opts.resolvers.writeAsset?.(destPath, content);
          }
          result = incAssets(result);
        } else {
          result = incSkipped(result);
        }
      } catch (err) {
        logger.error({ err, filePath }, "Error processing Notion file");
        result = addError(result, relativePath, String(err), err);
      }
    }
  } catch (err) {
    logger.error({ err, zipPath }, "Fatal error during Notion import");
    result = addError(result, zipPath, String(err), err);
  } finally {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  logger.info({ result }, "Notion import complete");
  return result;
}
