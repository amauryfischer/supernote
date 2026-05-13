// ============================================================
// @supernote/canvas — public API
//
// The canvas is now Excalidraw-only: entity references are first-class
// Excalidraw elements (see `DrawLayer.ts` for the customData/link encoding).
// Legacy CanvasNode / CanvasEdge types are still exported because the
// CanvasDocument shape must round-trip docs that were saved before the
// nodes/edges UI was removed. Existing typed-node content is migrated to
// Excalidraw elements on first load (see SupernoteCanvas.tsx).
// ============================================================

// Main component
export { SupernoteCanvas } from "./components/SupernoteCanvas.js";

// Sub-components (for advanced consumers)
export {
  DrawLayer,
  ENTITY_LINK_SCHEME,
  entityRefLink,
  parseEntityRefLink,
} from "./components/DrawLayer.js";
export type {
  DrawLayerHandle,
  DrawLayerProps,
  EntityRefCustomData,
  ExcalidrawElementLike,
} from "./components/DrawLayer.js";

// Serializer
export { parseCanvas, serializeCanvas } from "./serializer/index.js";

// Types — CanvasNode/Edge are kept so on-disk documents remain typed even
// though the UI no longer renders them directly.
export type {
  CanvasDocument,
  CanvasNode,
  CanvasTextNode,
  CanvasFileNode,
  CanvasLinkNode,
  CanvasGroupNode,
  CanvasCrmNode,
  CanvasQueryNode,
  CanvasEdge,
  CanvasMetadata,
  CanvasNodeSide,
  CanvasExcalidrawElement,
} from "./types/canvas.js";

export type {
  SupernoteCanvasProps,
  EntityRef,
  RelationCreationResult,
} from "./types/props.js";

// Store (for testing / advanced usage)
export { createCanvasStore } from "./store/index.js";
export type { CanvasState, CanvasStore } from "./store/index.js";

// Excalidraw bridge — read/write CanvasDocument as a standalone
// `.excalidraw` file (openable on excalidraw.com).
export * from "./excalidraw/index.js";
