import type {
  CanvasDocument,
  CanvasExcalidrawElement,
} from "../types/canvas.js";
import type { ExcalidrawFile } from "./types.js";

/**
 * Parse an Excalidraw v2 file back into a CanvasDocument.
 *
 * The reverse of `toExcalidraw`: every element becomes part of
 * `excalidrawElements`. The Supernote-specific conventions
 * (`customData.kind === "entity-ref"`, `link: supernote-entity://…`)
 * are carried along as opaque element data — the canvas rendering
 * layer knows how to interpret them.
 *
 * Defensive: returns an empty document rather than throwing on
 * malformed input so a corrupt sibling never blocks the editor.
 */
export function fromExcalidraw(file: ExcalidrawFile | unknown): CanvasDocument {
  if (!file || typeof file !== "object") return { nodes: [], edges: [] };
  const raw = (file as { elements?: unknown }).elements;
  if (!Array.isArray(raw)) return { nodes: [], edges: [] };

  const elements: CanvasExcalidrawElement[] = raw.filter(
    (e): e is CanvasExcalidrawElement =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as Record<string, unknown>)["id"] === "string" &&
      typeof (e as Record<string, unknown>)["type"] === "string",
  );

  return {
    nodes: [],
    edges: [],
    ...(elements.length ? { excalidrawElements: elements } : {}),
  };
}
