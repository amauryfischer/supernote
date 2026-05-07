// ============================================================
// Canvas document types — Obsidian-compatible + Supernote extensions
// ============================================================

export type CanvasNodeSide = "top" | "right" | "bottom" | "left";

/** Standard Obsidian node types */
export interface CanvasTextNode {
  readonly id: string;
  readonly type: "text";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
}

export interface CanvasFileNode {
  readonly id: string;
  readonly type: "file";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly file: string;
  readonly subpath?: string;
}

export interface CanvasLinkNode {
  readonly id: string;
  readonly type: "link";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly url: string;
}

export interface CanvasGroupNode {
  readonly id: string;
  readonly type: "group";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label?: string;
  readonly background?: string;
}

/** Supernote extension: CRM entity card node */
export interface CanvasCrmNode {
  readonly id: string;
  readonly type: "crm";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly entityId: string;
  readonly display?: "card" | "compact";
}

/** Supernote extension: query result node */
export interface CanvasQueryNode {
  readonly id: string;
  readonly type: "query";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly query: string;
  readonly viewMode: "list" | "table";
}

export type CanvasNode =
  | CanvasTextNode
  | CanvasFileNode
  | CanvasLinkNode
  | CanvasGroupNode
  | CanvasCrmNode
  | CanvasQueryNode;

export interface CanvasEdge {
  readonly id: string;
  readonly fromNode: string;
  readonly toNode: string;
  readonly fromSide?: CanvasNodeSide;
  readonly toSide?: CanvasNodeSide;
  readonly label?: string;
  readonly color?: string;
  /** Supernote extension: links edge to a persisted RelationEdge */
  readonly relationTypeId?: string;
}

export interface CanvasMetadata {
  readonly version: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CanvasDocument {
  readonly nodes: CanvasNode[];
  readonly edges: CanvasEdge[];
  readonly metadata?: CanvasMetadata;
}
