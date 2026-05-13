// Knowledge graph fixtures — 50 nodes / 80 edges

export type NodeType =
  | "contact"
  | "organisation"
  | "note"
  | "tag"
  | "concept";

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  tags: string[];
  /** Used as "created / occurred" date for temporal filtering */
  date: string;
  /** Edge count, for sizing */
  degree: number;
  path?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  label: string;
}

// Default: empty — graph populates from real user data.
// Use demo-fixtures.ts for demo data.
export const GRAPH_NODES: GraphNode[] = [];

export const GRAPH_EDGES: GraphEdge[] = [];

/** All distinct node types */
export const ALL_NODE_TYPES: NodeType[] = [
  "contact",
  "organisation",
  "note",
  "tag",
  "concept",
];

/** Color palette per type */
export const NODE_TYPE_COLORS: Record<NodeType, string> = {
  contact: "#6366F1",
  organisation: "#0EA5E9",
  note: "#10B981",
  tag: "#8B5CF6",
  concept: "#EC4899",
};

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  contact: "Contacts",
  organisation: "Organisations",
  note: "Notes",
  tag: "Tags",
  concept: "Concepts",
};
