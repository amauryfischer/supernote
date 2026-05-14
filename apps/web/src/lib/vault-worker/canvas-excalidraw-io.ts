// ============================================================
// canvas-excalidraw-io — FSA wrapper around the canvas excalidraw bridge.
//
// Every typed-canvas entity (canvas standalone + notes with a canvas view)
// is mirrored on disk as a sibling `.excalidraw` file: same directory,
// same basename, openable directly on excalidraw.com.
//
// This module is the ONLY place that combines the pure conversion
// library with File System Access I/O. Worker-router calls these helpers
// at the entity create/update/rename/read seams.
// ============================================================

import {
  canvasToFileBridge,
  excalidrawSiblingPath,
  parseExcalidrawFileContent,
} from "@supernote/canvas/excalidraw";
import type { CanvasDocument } from "@supernote/canvas";
import {
  readVaultFile,
  writeVaultFile,
  deleteVaultFile,
} from "./fsa-file-io.js";

/**
 * Write a `.excalidraw` sibling next to `mdPath` for the given document.
 * Returns the basename to store in the `.md` frontmatter `canvasFile`
 * field, or `null` if the path is not a `.md`.
 */
export async function writeExcalidrawSibling(
  vaultHandle: FileSystemDirectoryHandle,
  mdPath: string,
  doc: CanvasDocument,
): Promise<string | null> {
  const bridge = canvasToFileBridge({ mdPath, doc });
  if (!bridge) return null;
  await writeVaultFile(
    vaultHandle,
    bridge.excalidrawPath.split("/"),
    bridge.excalidrawContent,
  );
  return bridge.canvasFileFrontmatter;
}

/**
 * Read the `.excalidraw` sibling of `mdPath` and parse it into a
 * CanvasDocument. Returns null when the sibling is missing.
 * Malformed siblings parse to an empty document (defensive).
 */
export async function readExcalidrawSibling(
  vaultHandle: FileSystemDirectoryHandle,
  mdPath: string,
): Promise<CanvasDocument | null> {
  const siblingPath = excalidrawSiblingPath(mdPath);
  if (!siblingPath) return null;
  try {
    const content = await readVaultFile(vaultHandle, siblingPath.split("/"));
    return parseExcalidrawFileContent(content);
  } catch {
    return null;
  }
}

/**
 * Move the `.excalidraw` sibling alongside a renamed `.md`. Best-effort:
 * if the source sibling is missing the entity simply doesn't have a
 * canvas yet, which is fine.
 */
export async function moveExcalidrawSibling(
  vaultHandle: FileSystemDirectoryHandle,
  oldMdPath: string,
  newMdPath: string,
): Promise<void> {
  const oldSib = excalidrawSiblingPath(oldMdPath);
  const newSib = excalidrawSiblingPath(newMdPath);
  if (!oldSib || !newSib || oldSib === newSib) return;
  try {
    const content = await readVaultFile(vaultHandle, oldSib.split("/"));
    await writeVaultFile(vaultHandle, newSib.split("/"), content);
    await deleteVaultFile(vaultHandle, oldSib.split("/"));
  } catch {
    // No sibling to move — fine.
  }
}

/**
 * Delete the `.excalidraw` sibling if present. No-op on missing file.
 */
export async function deleteExcalidrawSibling(
  vaultHandle: FileSystemDirectoryHandle,
  mdPath: string,
): Promise<void> {
  const siblingPath = excalidrawSiblingPath(mdPath);
  if (!siblingPath) return;
  try {
    await deleteVaultFile(vaultHandle, siblingPath.split("/"));
  } catch {
    // best-effort: missing sibling is OK
  }
}
