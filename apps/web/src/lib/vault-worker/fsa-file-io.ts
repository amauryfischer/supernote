/**
 * fsa-file-io — read/write markdown files via File System Access API.
 *
 * Browser equivalent of apps/desktop/src/main/services/file-io.ts.
 * Uses FileSystemDirectoryHandle for vault root access.
 */

const EXCLUDE_DIRS = new Set([".supernote", "node_modules", ".git"]);
const MARKDOWN_EXTS = new Set([".md", ".markdown"]);
const EXCALIDRAW_EXT = ".excalidraw";

// Whitelist of extensions surfaced as attachment entities (virtual notes whose
// `fields.attachmentFile` points back at the on-disk file). Restricted to
// formats we know how to render — adding random extensions would clutter the
// sidebar with files the user has no in-app way to open.
const ATTACHMENT_EXTS = new Set([
  // Images
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp",
  // Documents
  ".pdf", ".html", ".htm",
  // Office
  ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt",
  // Data
  ".csv", ".tsv",
  // Google Workspace pointer files
  ".gdoc", ".gsheet", ".gslides",
]);

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

/** Parse gray-matter frontmatter without importing gray-matter (no Node dep). */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  if (!content.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }
  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    return { frontmatter: {}, body: content };
  }
  const fmRaw = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n/, "");
  const frontmatter: Record<string, unknown> = {};
  for (const line of fmRaw.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (!key) continue;
    frontmatter[key] = parseYamlValue(val);
  }
  return { frontmatter, body };
}

/**
 * Repeatedly unescape a string that has accumulated layers of JSON-string
 * encoding from a prior round-trip bug (each save wrapped the value in
 * `JSON.stringify` again, doubling backslashes). Stops as soon as parsing
 * yields a non-string (the canonical object) or stops being a string-of-JSON.
 * Bounded to avoid pathological inputs.
 */
function deepUnescapeJson(s: string, maxIter = 5): string {
  let cur = s;
  for (let i = 0; i < maxIter; i++) {
    if (!cur.startsWith("{") && !cur.startsWith("[")) break;
    try {
      const parsed = JSON.parse(cur);
      if (typeof parsed === "string") {
        cur = parsed;
        continue;
      }
      // It's an object/array — re-stringify back to canonical form.
      return JSON.stringify(parsed);
    } catch {
      break;
    }
  }
  return cur;
}

function parseYamlValue(val: string): unknown {
  if (val === "true") return true;
  if (val === "false") return false;
  if (val === "null" || val === "~") return null;
  const num = Number(val);
  if (!isNaN(num) && val !== "") return num;
  if (
    (val.startsWith("[") && val.endsWith("]")) ||
    (val.startsWith("{") && val.endsWith("}"))
  ) {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  // Double-quoted: parse as JSON string so escapes (\", \\, \n, ...) are
  // properly decoded. Naive slice(1, -1) leaves `\"` as 2 literal chars,
  // which then gets re-escaped on the next emitScalar/JSON.stringify pass,
  // doubling backslashes every round-trip.
  if (val.startsWith('"') && val.endsWith('"')) {
    let unquoted: string;
    try {
      const parsed = JSON.parse(val);
      unquoted = typeof parsed === "string" ? parsed : val.slice(1, -1);
    } catch {
      unquoted = val.slice(1, -1);
    }
    // Migration: pre-fix vaults may contain canvas/JSON-like strings that
    // were over-escaped by the prior bug. If the result still looks like a
    // stringified JSON value with leftover escapes, peel the layers.
    if (
      (unquoted.startsWith("{") || unquoted.startsWith("[")) &&
      unquoted.includes("\\")
    ) {
      return deepUnescapeJson(unquoted);
    }
    return unquoted;
  }
  // Single-quoted: emitScalar always uses double quotes, so we'd only see
  // single quotes from hand-edited files. Naive strip is fine.
  if (val.startsWith("'") && val.endsWith("'")) {
    return val.slice(1, -1);
  }
  return val;
}

/**
 * A string is safe to emit unquoted only when it can't be confused with
 * another YAML scalar type and won't break our naive line-based parser.
 * Anything risky (newlines, leading/trailing whitespace, looks like a
 * number/bool/null, starts with `[`/`{`/`"`/`'`/`#`) goes through
 * JSON.stringify so the value round-trips losslessly.
 */
function needsQuoting(s: string): boolean {
  if (s === "") return true;
  if (/[\n\r]/.test(s)) return true;
  if (s !== s.trim()) return true;
  if (s === "true" || s === "false" || s === "null" || s === "~") return true;
  if (!isNaN(Number(s))) return true;
  const c = s[0];
  if (c === "[" || c === "{" || c === '"' || c === "'" || c === "#" || c === "&" || c === "*" || c === "!" || c === "|" || c === ">") return true;
  return false;
}

function emitScalar(v: string | number | boolean): string {
  if (typeof v !== "string") return String(v);
  return needsQuoting(v) ? JSON.stringify(v) : v;
}

/** Serialize frontmatter + body back to markdown string. */
export function serializeFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (v === null || v === undefined) {
      lines.push(`${k}: null`);
    } else if (typeof v === "object") {
      // Inline JSON for arrays/objects. parseYamlValue handles `{...}` and
      // `[...]` via JSON.parse on the round-trip.
      lines.push(`${k}: ${JSON.stringify(v)}`);
    } else {
      lines.push(`${k}: ${emitScalar(v as string | number | boolean)}`);
    }
  }
  lines.push("---");
  lines.push("");
  lines.push(body);
  return lines.join("\n");
}

/** Read a file from the vault by relative path segments. */
export async function readVaultFile(
  vaultHandle: FileSystemDirectoryHandle,
  pathSegments: string[],
): Promise<string> {
  let current: FileSystemDirectoryHandle = vaultHandle;
  for (const seg of pathSegments.slice(0, -1)) {
    current = await current.getDirectoryHandle(seg);
  }
  const fileName = pathSegments[pathSegments.length - 1]!;
  const fileHandle = await current.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return file.text();
}

/**
 * Read a file as raw bytes. Used by attachment viewers (PDF, image, XLSX, …)
 * that need binary input. Returns the `ArrayBuffer` so it can be transferred
 * across the worker boundary via `postMessage` without a copy.
 */
export async function readVaultFileBinary(
  vaultHandle: FileSystemDirectoryHandle,
  pathSegments: string[],
): Promise<ArrayBuffer> {
  let current: FileSystemDirectoryHandle = vaultHandle;
  for (const seg of pathSegments.slice(0, -1)) {
    current = await current.getDirectoryHandle(seg);
  }
  const fileName = pathSegments[pathSegments.length - 1]!;
  const fileHandle = await current.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return file.arrayBuffer();
}

/**
 * Write raw bytes to a vault file. Used by attachment editors (CSV, XLSX)
 * to save edited content back to the original binary file. Creates parent
 * directories if missing (mirrors `writeVaultFile`).
 */
export async function writeVaultFileBinary(
  vaultHandle: FileSystemDirectoryHandle,
  pathSegments: string[],
  bytes: ArrayBuffer | Uint8Array,
): Promise<void> {
  let current: FileSystemDirectoryHandle = vaultHandle;
  for (const seg of pathSegments.slice(0, -1)) {
    current = await current.getDirectoryHandle(seg, { create: true });
  }
  const fileName = pathSegments[pathSegments.length - 1]!;
  const fileHandle = await current.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  // `write` expects a BufferSource / Blob / string. `Uint8Array` is a
  // valid BufferSource at runtime but TS narrows it weirdly — cast to
  // `BufferSource` to satisfy the overload.
  await writable.write(bytes as BufferSource);
  await writable.close();
}

/** Write a file to the vault by relative path segments. */
export async function writeVaultFile(
  vaultHandle: FileSystemDirectoryHandle,
  pathSegments: string[],
  content: string,
): Promise<void> {
  let current: FileSystemDirectoryHandle = vaultHandle;
  for (const seg of pathSegments.slice(0, -1)) {
    current = await current.getDirectoryHandle(seg, { create: true });
  }
  const fileName = pathSegments[pathSegments.length - 1]!;
  const fileHandle = await current.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

/** Delete a file from the vault. */
export async function deleteVaultFile(
  vaultHandle: FileSystemDirectoryHandle,
  pathSegments: string[],
): Promise<void> {
  let current: FileSystemDirectoryHandle = vaultHandle;
  for (const seg of pathSegments.slice(0, -1)) {
    current = await current.getDirectoryHandle(seg);
  }
  const fileName = pathSegments[pathSegments.length - 1]!;
  await current.removeEntry(fileName);
}

/**
 * Recursively delete a directory and all its contents from the vault.
 * Silently ignores `NotFoundError` so callers can use this idempotently
 * (the DB-level cascade may have already removed the only files inside).
 */
export async function deleteVaultDirectory(
  vaultHandle: FileSystemDirectoryHandle,
  pathSegments: string[],
): Promise<void> {
  if (pathSegments.length === 0) return;
  let parent: FileSystemDirectoryHandle = vaultHandle;
  for (const seg of pathSegments.slice(0, -1)) {
    try {
      parent = await parent.getDirectoryHandle(seg);
    } catch {
      // Ancestor missing — nothing to delete.
      return;
    }
  }
  const dirName = pathSegments[pathSegments.length - 1]!;
  try {
    // `recursive: true` is supported in Chromium-based browsers (the only
    // ones that ship the File System Access API today, which is the same
    // gate the rest of the worker already requires).
    await parent.removeEntry(dirName, { recursive: true });
  } catch (err) {
    // Already gone — fine. Anything else, surface it.
    if ((err as DOMException)?.name !== "NotFoundError") throw err;
  }
}

export interface MarkdownFile {
  name: string;
  /** Path relative to vault root, using "/" separator */
  relativePath: string;
  content: string;
}

/** Walk all markdown files in the vault directory recursively. */
export async function walkMarkdownFiles(
  dir: FileSystemDirectoryHandle,
  prefix = "",
): Promise<MarkdownFile[]> {
  const results: MarkdownFile[] = [];
  for await (const [name, entry] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (entry.kind === "directory") {
      if (EXCLUDE_DIRS.has(name)) continue;
      const subDir = entry as FileSystemDirectoryHandle;
      const subResults = await walkMarkdownFiles(subDir, prefix ? `${prefix}/${name}` : name);
      results.push(...subResults);
    } else if (entry.kind === "file" && MARKDOWN_EXTS.has(getExtension(name))) {
      const fileHandle = entry as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const content = await file.text();
      results.push({
        name,
        relativePath: prefix ? `${prefix}/${name}` : name,
        content,
      });
    }
  }
  return results;
}

export interface DiscoveredFile {
  name: string;
  /** Path relative to vault root, using "/" separator */
  relativePath: string;
  /** Lowercased file extension including the dot ("" if none). */
  ext: string;
  /** Lazy reader so callers can skip large/binary content when not needed. */
  read: () => Promise<string>;
}

/**
 * Walk every file in the vault (excluding hidden/system dirs). Unlike
 * `walkMarkdownFiles`, this does NOT pre-load file content — callers invoke
 * `read()` only for files they care about. Used by the auto-import path to
 * surface arbitrary user-supplied files (orphaned `.md`, `.excalidraw`, etc.)
 * that were dropped into the folder before Supernote ever touched it.
 */
export async function walkAllFiles(
  dir: FileSystemDirectoryHandle,
  prefix = "",
): Promise<DiscoveredFile[]> {
  const results: DiscoveredFile[] = [];
  for await (const [name, entry] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (entry.kind === "directory") {
      if (EXCLUDE_DIRS.has(name)) continue;
      const subDir = entry as FileSystemDirectoryHandle;
      const subResults = await walkAllFiles(subDir, prefix ? `${prefix}/${name}` : name);
      results.push(...subResults);
    } else if (entry.kind === "file") {
      const fileHandle = entry as FileSystemFileHandle;
      results.push({
        name,
        relativePath: prefix ? `${prefix}/${name}` : name,
        ext: getExtension(name),
        read: async () => {
          const file = await fileHandle.getFile();
          return file.text();
        },
      });
    }
  }
  return results;
}

export function isMarkdownExt(ext: string): boolean {
  return MARKDOWN_EXTS.has(ext);
}

export function isExcalidrawExt(ext: string): boolean {
  return ext === EXCALIDRAW_EXT;
}

/** True for extensions we surface as attachment entities. */
export function isAttachmentExt(ext: string): boolean {
  return ATTACHMENT_EXTS.has(ext);
}

/**
 * Coarse content-type for an attachment extension. Used by viewer dispatch
 * and by the worker's `readFile` route to decide whether to also return the
 * decoded text (text formats) or just the binary bytes (everything else).
 */
export function attachmentCategory(
  ext: string,
): "image" | "pdf" | "office" | "csv" | "gdoc" | null {
  if (!ATTACHMENT_EXTS.has(ext)) return null;
  if (ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".gif" || ext === ".webp" || ext === ".svg" || ext === ".avif" || ext === ".bmp") {
    return "image";
  }
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx" || ext === ".doc" || ext === ".xlsx" || ext === ".xls" || ext === ".pptx" || ext === ".ppt") {
    return "office";
  }
  if (ext === ".csv" || ext === ".tsv") return "csv";
  if (ext === ".gdoc" || ext === ".gsheet" || ext === ".gslides") return "gdoc";
  return null;
}

/** True if the attachment's content is human-readable text (CSV, GDoc pointer). */
export function isTextAttachmentExt(ext: string): boolean {
  return ext === ".csv" || ext === ".tsv" || ext === ".gdoc" || ext === ".gsheet" || ext === ".gslides" || ext === ".svg";
}

/** Hash content using Web Crypto API (SHA-256). */
export async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Generate a ULID-like unique ID (timestamp + random, URL-safe). */
export function generateId(): string {
  const t = Date.now().toString(36).toUpperCase().padStart(10, "0");
  const r = Math.random().toString(36).slice(2, 12).toUpperCase().padStart(10, "0");
  return `${t}${r}`;
}
