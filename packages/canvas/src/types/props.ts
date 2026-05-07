// ============================================================
// Public component props for SupernoteCanvas
// ============================================================

import type { CanvasDocument } from "./canvas.js";

/** Reference to an entity for node rendering */
export interface EntityRef {
  readonly id: string;
  readonly typeId: string;
  readonly typeName: string;
  readonly typeIcon?: string;
  readonly typeColor?: string;
  readonly name: string;
  readonly fields?: Record<string, unknown>;
}

/** Result after a relation is created between two CRM nodes */
export interface RelationCreationResult {
  readonly success: boolean;
  readonly relationEdgeId?: string;
  readonly relationTypeId?: string;
  readonly error?: string;
}

/** Canvas display mode: draw (Excalidraw) or nodes (React Flow) */
export type CanvasMode = "draw" | "nodes";

export interface SupernoteCanvasProps {
  initialData?: CanvasDocument;
  onChange?: (data: CanvasDocument) => void;
  onSave?: (data: CanvasDocument) => void;

  /** Async resolver for CRM entity nodes */
  resolveEntity?: (id: string) => Promise<EntityRef | null>;
  /** Entity search for the command palette / node picker */
  searchEntities?: (q: string) => Promise<EntityRef[]>;

  /**
   * Called when two CRM nodes are connected via React Flow edge.
   * Returns details about the newly created relation.
   */
  onCreateRelation?: (
    sourceId: string,
    targetId: string
  ) => Promise<RelationCreationResult>;

  readOnly?: boolean;
  className?: string;
}
