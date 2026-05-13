import type {
  CanvasDocument,
  CanvasExcalidrawElement,
} from "../types/canvas.js";
import {
  EXCALIDRAW_SOURCE,
  type ExcalidrawElement,
  type ExcalidrawFile,
} from "./types.js";

/**
 * Convert a Supernote CanvasDocument into a valid Excalidraw v2 file.
 *
 * The runtime canvas is Excalidraw-only since May 2026: every drawing,
 * shape, and entity reference lives in `doc.excalidrawElements`. The
 * legacy `nodes`/`edges` arrays only appear on documents that have not
 * yet been opened by the post-migration editor. We deliberately drop
 * those here — `SupernoteCanvas` migrates them to Excalidraw elements
 * on first load, so persisting them in the `.excalidraw` would just
 * duplicate work and risk drift.
 */
export function toExcalidraw(doc: CanvasDocument): ExcalidrawFile {
  const elements = (doc.excalidrawElements ?? []) as readonly CanvasExcalidrawElement[];
  return {
    type: "excalidraw",
    version: 2,
    source: EXCALIDRAW_SOURCE,
    elements: elements as readonly ExcalidrawElement[],
    appState: { viewBackgroundColor: "#ffffff", gridSize: null },
    files: {},
  };
}
