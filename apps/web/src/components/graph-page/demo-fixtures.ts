/**
 * Demo fixtures for graph — used by the "Charger des exemples (démo)" button in Settings > Backup.
 * These are NOT loaded by default. The app starts empty.
 */
import type { GraphNode, GraphEdge } from "./fixtures";

export const DEMO_GRAPH_NODES: GraphNode[] = [
  { id: "p1", label: "Alice Martin", type: "contact", tags: ["product"], date: "2026-01-15", degree: 3 },
  { id: "p2", label: "Baptiste Leroy", type: "contact", tags: ["design"], date: "2026-02-10", degree: 2 },
  { id: "o1", label: "Acme Corp", type: "organisation", tags: ["tech"], date: "2025-06-01", degree: 4 },
  { id: "n1", label: "Architecture Supernote", type: "note", tags: ["dev"], date: "2026-05-07", degree: 3, path: "/notes/5" },
  { id: "n2", label: "Veille IA — Mai 2026", type: "note", tags: ["IA"], date: "2026-05-07", degree: 2, path: "/notes/10" },
];

export const DEMO_GRAPH_EDGES: GraphEdge[] = [
  { source: "p1", target: "o1", label: "travaille chez" },
  { source: "p2", target: "o1", label: "partenaire" },
  { source: "p1", target: "n1", label: "documente" },
];
