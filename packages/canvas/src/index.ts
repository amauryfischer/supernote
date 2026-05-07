// ============================================================
// @supernote/canvas — public API
// ============================================================

// Main component
export { SupernoteCanvas } from "./components/SupernoteCanvas.js";

// Sub-components (for advanced consumers)
export { DrawLayer } from "./components/DrawLayer.js";
export { NodesLayer } from "./components/NodesLayer.js";
export { ModeToggle } from "./components/ModeToggle.js";
export { RelationDialog } from "./components/RelationDialog.js";

// Node components
export {
  EntityCardNode,
  NoteEmbedNode,
  QueryNode,
  TextNode,
} from "./nodes/index.js";

export type {
  EntityCardNodeData,
  NoteEmbedNodeData,
  QueryNodeData,
  TextNodeData,
} from "./nodes/index.js";

// Serializer
export { parseCanvas, serializeCanvas } from "./serializer/index.js";

// Types
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
} from "./types/canvas.js";

export type {
  SupernoteCanvasProps,
  EntityRef,
  RelationCreationResult,
  CanvasMode,
} from "./types/props.js";

// Store (for testing / advanced usage)
export { createCanvasStore } from "./store/index.js";
export type { CanvasState, CanvasStore } from "./store/index.js";
