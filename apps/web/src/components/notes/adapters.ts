/**
 * Adapters: convert tRPC EntitySummary / Entity → local Note / Folder types.
 * Also exposes helpers to derive a Folder hierarchy from a flat list of paths.
 */

import type { EntitySummary, Entity } from "@supernote/ipc";
import type { Note, Folder } from "./fixtures";

export function entitySummaryToNote(e: EntitySummary): Note {
  const title =
    typeof e.fields["title"] === "string"
      ? e.fields["title"]
      : e.filePath.split("/").pop()?.replace(/\.md$/, "") ?? "Sans titre";
  return {
    id: e.id,
    title,
    body: "",
    folderPath: folderFromFilePath(e.filePath),
    updatedAt: e.updatedAt,
    tags: e.tags,
  };
}

export function entityToNote(e: Entity): Note {
  const title =
    typeof e.fields["title"] === "string"
      ? e.fields["title"]
      : e.filePath.split("/").pop()?.replace(/\.md$/, "") ?? "Sans titre";
  return {
    id: e.id,
    title,
    body: e.body,
    folderPath: folderFromFilePath(e.filePath),
    updatedAt: e.updatedAt,
    tags: e.tags,
  };
}

/** Derive the folder path from a file path (everything except the filename). */
export function folderFromFilePath(filePath: string): string {
  const parts = filePath.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "Inbox";
}

/** Build a slug from a title (lowercase, dashes, no special chars). */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

/** Build a filePath from a folder and a title. */
export function noteFilePath(folderPath: string, title: string): string {
  return `${folderPath}/${slugify(title) || "sans-titre"}.md`;
}

/**
 * Derive a Folder hierarchy from a flat list of folder paths.
 * Paths use "/" as separator (e.g. "Notes/Projets").
 */
export function foldersFromPaths(paths: string[]): Folder[] {
  const unique = Array.from(new Set(paths)).sort();
  const root: Folder[] = [];

  for (const path of unique) {
    insertPath(root, path.split("/"), path);
  }
  return root;
}

function insertPath(nodes: Folder[], segments: string[], fullPath: string): void {
  if (segments.length === 0) return;
  const [head, ...rest] = segments;
  if (!head) return;

  let node = nodes.find((n) => n.name === head);
  if (!node) {
    const pathParts = fullPath.split("/");
    const depth = pathParts.length - rest.length;
    const nodePath = pathParts.slice(0, depth).join("/");
    const newNode: Folder = { name: head, path: nodePath };
    nodes.push(newNode);
    node = newNode;
  }

  if (rest.length > 0) {
    if (!node.children) node.children = [];
    insertPath(node.children, rest, fullPath);
  }
}
