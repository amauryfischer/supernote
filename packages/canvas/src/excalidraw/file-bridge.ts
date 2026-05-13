import type { CanvasDocument } from "../types/canvas.js";
import { toExcalidraw } from "./to-excalidraw.js";
import { fromExcalidraw } from "./from-excalidraw.js";

/**
 * Given a vault-relative `.md` path, return the path of its `.excalidraw`
 * sibling (same directory, same basename). Returns null when the input
 * is not a `.md` path.
 */
export function excalidrawSiblingPath(mdPath: string): string | null {
  if (!mdPath.endsWith(".md")) return null;
  return `${mdPath.slice(0, -3)}.excalidraw`;
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

export interface FileBridgeOutput {
  readonly excalidrawPath: string;
  readonly excalidrawContent: string;
  readonly canvasFileFrontmatter: string;
}

/**
 * Compute everything needed to persist a CanvasDocument as an
 * `.excalidraw` sibling of an existing `.md` file. Pure: caller is
 * responsible for the actual FSA write.
 */
export function canvasToFileBridge(args: {
  mdPath: string;
  doc: CanvasDocument;
}): FileBridgeOutput | null {
  const excalidrawPath = excalidrawSiblingPath(args.mdPath);
  if (!excalidrawPath) return null;
  const file = toExcalidraw(args.doc);
  return {
    excalidrawPath,
    excalidrawContent: JSON.stringify(file, null, 2),
    canvasFileFrontmatter: basename(excalidrawPath),
  };
}

/**
 * Parse the raw text of an `.excalidraw` file into a CanvasDocument.
 * Defensive: returns an empty document on malformed JSON.
 */
export function parseExcalidrawFileContent(content: string): CanvasDocument {
  try {
    const parsed = JSON.parse(content);
    return fromExcalidraw(parsed);
  } catch {
    return { nodes: [], edges: [] };
  }
}
