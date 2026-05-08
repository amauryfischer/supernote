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

/**
 * Result after a relation is created between two CRM nodes.
 *
 * Kept for backward-compat: the React Flow "nodes" mode used to surface a
 * dialog whose confirm callback returned this shape. The current
 * Excalidraw-only canvas doesn't open such a dialog, but the type is
 * preserved so consumers that imported it keep typechecking.
 */
export interface RelationCreationResult {
  readonly success: boolean;
  readonly relationEdgeId?: string;
  readonly relationTypeId?: string;
  readonly error?: string;
}

export interface SupernoteCanvasProps {
  initialData?: CanvasDocument;
  onChange?: (data: CanvasDocument) => void;
  onSave?: (data: CanvasDocument) => void;

  /** Async resolver for entity references (used to fill the rectangle label). */
  resolveEntity?: (id: string) => Promise<EntityRef | null>;
  /** Entity search for the command palette / picker. */
  searchEntities?: (q: string) => Promise<EntityRef[]>;

  /**
   * Called when the user clicks one of the typed "Lier ..." buttons in the
   * toolbar. The host is expected to open a picker (e.g. tRPC-backed search),
   * let the user choose, then invoke `addEntityNode(entityId)` to insert an
   * entity-ref Excalidraw element onto the canvas. When omitted the buttons
   * are hidden.
   *
   * `typeFilter` (when provided) is the entity-type id (e.g. "personne",
   * "note", "projet") the user pre-selected via the toolbar. The host should
   * narrow the picker's search to that type. Omit/undefined means the legacy
   * "any type" flow.
   *
   * The canvas resolves the entity (via `resolveEntity`) right after
   * `addEntityNode` is called so the inserted Excalidraw rectangle shows
   * the correct name/type. The host no longer has to do the lookup.
   */
  onLinkEntity?: (
    addEntityNode: (entityId: string) => void,
    typeFilter?: string,
  ) => void;

  /**
   * Called when the user clicks the link icon on an entity-ref Excalidraw
   * element. The host should navigate to the entity's detail page (route
   * depends on `entityType`). When omitted, link clicks are no-op.
   */
  onEntityNavigate?: (entityId: string, entityType: string) => void;

  readOnly?: boolean;
  className?: string;
}
