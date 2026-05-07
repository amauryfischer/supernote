/**
 * fsa-file-io — read/write markdown files via File System Access API.
 *
 * Browser equivalent of apps/desktop/src/main/services/file-io.ts.
 * Uses FileSystemDirectoryHandle for vault root access.
 */

const EXCLUDE_DIRS = new Set([".supernote", "node_modules", ".git"]);
const MARKDOWN_EXTS = new Set([".md", ".markdown"]);

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

function parseYamlValue(val: string): unknown {
  if (val === "true") return true;
  if (val === "false") return false;
  if (val === "null" || val === "~") return null;
  const num = Number(val);
  if (!isNaN(num) && val !== "") return num;
  if (val.startsWith("[") && val.endsWith("]")) {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  // Strip surrounding quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
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
      lines.push(`${k}: ${JSON.stringify(v)}`);
    } else {
      lines.push(`${k}: ${String(v)}`);
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
