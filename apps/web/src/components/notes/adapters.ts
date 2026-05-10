/**
 * Adapters: convert tRPC EntitySummary / Entity → local Note / Folder types.
 * Also exposes helpers to derive a Folder hierarchy from a flat list of paths.
 */

import type { EntitySummary, Entity } from "@supernote/ipc";
import type { Note, Folder } from "./fixtures";

/** Pull the `archivedAt` ISO string out of a fields bag, or null. Tolerates
 *  legacy `false` / empty-string values (early bug where the field was
 *  cleared instead of removed) so a note isn't accidentally treated as
 *  archived because of a stale falsy value. */
function readArchivedAt(fields: Record<string, unknown> | undefined): string | null {
  const v = fields?.["archivedAt"];
  return typeof v === "string" && v.length > 0 ? v : null;
}

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
    filePath: e.filePath,
    updatedAt: e.updatedAt,
    tags: e.tags,
    fields: e.fields,
    archivedAt: readArchivedAt(e.fields),
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
    filePath: e.filePath,
    updatedAt: e.updatedAt,
    tags: e.tags,
    fields: e.fields,
    archivedAt: readArchivedAt(e.fields),
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
 * Per-folder presentation metadata persisted server-side and threaded
 * through the FileTree. Mirrors `FolderSchema` from @supernote/ipc but
 * defined locally so this module stays free of an IPC import (called
 * from fallback/demo paths too).
 */
export interface FolderMeta {
  path: string;
  color?: string;
  icon?: string;
  sortOrder?: number;
}

/**
 * Derive a Folder hierarchy from a flat list of folder entries. Accepts
 * either bare paths (legacy callers / fallback fixtures) or full
 * `{path, color?, icon?}` entries from the IPC layer. Per-folder color
 * and icon are attached to the matching node so the FileTree can pick
 * them up without a second lookup.
 *
 * Paths use "/" as separator (e.g. "Notes/Projets"); intermediate
 * ancestor nodes are auto-created without metadata.
 */
export function foldersFromPaths(entries: Array<string | FolderMeta>): Folder[] {
  // Normalize → object form, dedupe by path (last write wins so an
  // explicit metadata entry overrides a bare-path one), then sort for
  // a stable render order.
  const byPath = new Map<string, FolderMeta>();
  for (const e of entries) {
    if (typeof e === "string") {
      if (!byPath.has(e)) byPath.set(e, { path: e });
    } else if (e && typeof e.path === "string") {
      const meta: FolderMeta = { path: e.path };
      if (typeof e.color === "string") meta.color = e.color;
      if (typeof e.icon === "string") meta.icon = e.icon;
      if (typeof (e as { sortOrder?: unknown }).sortOrder === "number") meta.sortOrder = (e as { sortOrder: number }).sortOrder;
      byPath.set(e.path, meta);
    }
  }
  const sorted = Array.from(byPath.values()).sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  const root: Folder[] = [];
  for (const entry of sorted) {
    insertPath(root, entry.path.split("/"), entry);
  }
  return root;
}

function insertPath(
  nodes: Folder[],
  segments: string[],
  entry: FolderMeta,
): void {
  if (segments.length === 0) return;
  const [head, ...rest] = segments;
  if (!head) return;

  let node = nodes.find((n) => n.name === head);
  if (!node) {
    const pathParts = entry.path.split("/");
    const depth = pathParts.length - rest.length;
    const nodePath = pathParts.slice(0, depth).join("/");
    const newNode: Folder = { name: head, path: nodePath };
    nodes.push(newNode);
    node = newNode;
  }

  // Attach color/icon only to the leaf node (the one whose full path
  // matches the entry). Intermediate ancestors stay un-themed unless
  // they have their own entry — otherwise customizing "a/b" would also
  // tint "a", which is surprising.
  if (rest.length === 0) {
    if (entry.color !== undefined) node.color = entry.color;
    if (entry.icon !== undefined) node.icon = entry.icon;
    if (entry.sortOrder !== undefined) node.sortOrder = entry.sortOrder;
  }

  if (rest.length > 0) {
    if (!node.children) node.children = [];
    insertPath(node.children, rest, entry);
  }
}
