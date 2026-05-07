// Knowledge graph fixtures — 50 nodes / 80 edges

export type NodeType =
  | "contact"
  | "organisation"
  | "note"
  | "projet"
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

export const GRAPH_NODES: GraphNode[] = [
  // Contacts (10)
  { id: "p1", label: "Pierre Martin", type: "contact", tags: ["finance"], date: "2026-01-15", degree: 8 },
  { id: "p2", label: "Sophie Durand", type: "contact", tags: ["design"], date: "2026-02-10", degree: 6 },
  { id: "p3", label: "Thomas Leclerc", type: "contact", tags: ["dev"], date: "2026-01-20", degree: 5 },
  { id: "p4", label: "Marie Lefebvre", type: "contact", tags: ["marketing"], date: "2026-03-05", degree: 4 },
  { id: "p5", label: "Lucas Bernard", type: "contact", tags: ["dev"], date: "2026-02-28", degree: 7 },
  { id: "p6", label: "Emma Petit", type: "contact", tags: ["design", "produit"], date: "2026-04-12", degree: 3 },
  { id: "p7", label: "Hugo Simon", type: "contact", tags: ["finance"], date: "2026-01-08", degree: 5 },
  { id: "p8", label: "Alice Moreau", type: "contact", tags: ["recherche"], date: "2026-03-18", degree: 4 },
  { id: "p9", label: "Nathan Garnier", type: "contact", tags: ["dev"], date: "2026-04-01", degree: 3 },
  { id: "p10", label: "Camille Roux", type: "contact", tags: ["marketing"], date: "2026-05-02", degree: 2 },

  // Organisations (6)
  { id: "o1", label: "Numerisk", type: "organisation", tags: ["tech"], date: "2025-06-01", degree: 10 },
  { id: "o2", label: "StudioCraft", type: "organisation", tags: ["design"], date: "2025-09-15", degree: 6 },
  { id: "o3", label: "CapitalNord", type: "organisation", tags: ["finance"], date: "2025-11-01", degree: 5 },
  { id: "o4", label: "OpenLabs", type: "organisation", tags: ["recherche", "IA"], date: "2026-01-10", degree: 4 },
  { id: "o5", label: "Falcon Inc", type: "organisation", tags: ["produit"], date: "2026-03-01", degree: 7 },
  { id: "o6", label: "DataFlow", type: "organisation", tags: ["data"], date: "2026-02-20", degree: 3 },

  // Notes (12)
  { id: "n1", label: "Architecture Supernote", type: "note", tags: ["dev"], date: "2026-05-07", degree: 7, path: "/notes/5" },
  { id: "n2", label: "Réunion Q2", type: "note", tags: ["réunion"], date: "2026-05-07", degree: 4, path: "/notes/1" },
  { id: "n3", label: "Brief Falcon", type: "note", tags: ["projet"], date: "2026-05-07", degree: 5, path: "/notes/7" },
  { id: "n4", label: "Design system tokens", type: "note", tags: ["design"], date: "2026-05-05", degree: 3, path: "/notes/8" },
  { id: "n5", label: "Deep Work — notes", type: "note", tags: ["lecture"], date: "2026-05-05", degree: 2, path: "/notes/4" },
  { id: "n6", label: "Veille IA Mai 2026", type: "note", tags: ["IA"], date: "2026-05-07", degree: 4, path: "/notes/10" },
  { id: "n7", label: "Ressources TypeScript", type: "note", tags: ["dev"], date: "2026-05-06", degree: 3, path: "/notes/6" },
  { id: "n8", label: "Notes conf LocalFirst", type: "note", tags: ["conf"], date: "2026-04-28", degree: 2, path: "/notes/20" },
  { id: "n9", label: "Daily 2026-05-07", type: "note", tags: ["daily"], date: "2026-05-07", degree: 2, path: "/notes/11" },
  { id: "n10", label: "Shortcodes Tailwind v4", type: "note", tags: ["dev"], date: "2026-05-03", degree: 2, path: "/notes/16" },
  { id: "n11", label: "Raccourcis clavier", type: "note", tags: ["productivity"], date: "2026-05-01", degree: 1, path: "/notes/18" },
  { id: "n12", label: "Contacts à relancer", type: "note", tags: ["contacts"], date: "2026-05-02", degree: 3, path: "/notes/17" },

  // Projets (6)
  { id: "pr1", label: "Supernote PKM", type: "projet", tags: ["dev", "produit"], date: "2025-12-01", degree: 12 },
  { id: "pr2", label: "Falcon v2", type: "projet", tags: ["produit"], date: "2026-02-01", degree: 8 },
  { id: "pr3", label: "Design System v3", type: "projet", tags: ["design"], date: "2026-03-01", degree: 5 },
  { id: "pr4", label: "Intégration IA", type: "projet", tags: ["IA"], date: "2026-04-01", degree: 6 },
  { id: "pr5", label: "Mobile MVP", type: "projet", tags: ["produit"], date: "2026-05-01", degree: 3 },
  { id: "pr6", label: "Data Pipeline", type: "projet", tags: ["data"], date: "2026-04-15", degree: 4 },

  // Tags (8)
  { id: "t1", label: "#dev", type: "tag", tags: [], date: "2025-01-01", degree: 9 },
  { id: "t2", label: "#design", type: "tag", tags: [], date: "2025-01-01", degree: 6 },
  { id: "t3", label: "#IA", type: "tag", tags: [], date: "2025-06-01", degree: 5 },
  { id: "t4", label: "#finance", type: "tag", tags: [], date: "2025-01-01", degree: 4 },
  { id: "t5", label: "#produit", type: "tag", tags: [], date: "2025-01-01", degree: 7 },
  { id: "t6", label: "#lecture", type: "tag", tags: [], date: "2026-01-01", degree: 2 },
  { id: "t7", label: "#conf", type: "tag", tags: [], date: "2026-01-01", degree: 2 },
  { id: "t8", label: "#daily", type: "tag", tags: [], date: "2026-01-01", degree: 5 },

  // Concepts (8)
  { id: "con1", label: "Local-first", type: "concept", tags: ["architecture"], date: "2025-09-01", degree: 6 },
  { id: "con2", label: "PKM", type: "concept", tags: ["productivity"], date: "2025-01-01", degree: 8 },
  { id: "con3", label: "CRDT", type: "concept", tags: ["architecture"], date: "2026-01-01", degree: 4 },
  { id: "con4", label: "Second cerveau", type: "concept", tags: ["productivity"], date: "2026-02-01", degree: 5 },
  { id: "con5", label: "Deep Work", type: "concept", tags: ["productivity"], date: "2026-05-01", degree: 3 },
  { id: "con6", label: "Monorepo", type: "concept", tags: ["dev"], date: "2025-12-01", degree: 4 },
  { id: "con7", label: "Knowledge Graph", type: "concept", tags: ["IA"], date: "2026-03-01", degree: 5 },
  { id: "con8", label: "Atomic Notes", type: "concept", tags: ["PKM"], date: "2026-04-01", degree: 3 },
];

export const GRAPH_EDGES: GraphEdge[] = [
  // Contact → Organisation
  { source: "p1", target: "o3", label: "travaille chez" },
  { source: "p2", target: "o2", label: "travaille chez" },
  { source: "p3", target: "o1", label: "travaille chez" },
  { source: "p4", target: "o5", label: "travaille chez" },
  { source: "p5", target: "o1", label: "travaille chez" },
  { source: "p6", target: "o2", label: "travaille chez" },
  { source: "p7", target: "o3", label: "travaille chez" },
  { source: "p8", target: "o4", label: "travaille chez" },
  { source: "p9", target: "o1", label: "travaille chez" },
  { source: "p10", target: "o5", label: "travaille chez" },

  // Contact → Projet
  { source: "p1", target: "pr2", label: "investit dans" },
  { source: "p2", target: "pr3", label: "contribue à" },
  { source: "p3", target: "pr1", label: "développe" },
  { source: "p5", target: "pr1", label: "développe" },
  { source: "p4", target: "pr2", label: "marketing" },
  { source: "p8", target: "pr4", label: "recherche" },
  { source: "p9", target: "pr6", label: "développe" },

  // Note → Contact (mentions)
  { source: "n2", target: "p1", label: "mentionne" },
  { source: "n12", target: "p2", label: "mentionne" },
  { source: "n12", target: "p3", label: "mentionne" },
  { source: "n3", target: "p4", label: "mentionne" },

  // Note → Projet (wikilinks)
  { source: "n1", target: "pr1", label: "lié à" },
  { source: "n3", target: "pr2", label: "documente" },
  { source: "n6", target: "pr4", label: "lié à" },
  { source: "n4", target: "pr3", label: "documente" },

  // Note → Organisation
  { source: "n3", target: "o5", label: "concerne" },
  { source: "n1", target: "o1", label: "concerne" },

  // Note → Concept (wikilinks)
  { source: "n1", target: "con6", label: "mentionne" },
  { source: "n8", target: "con3", label: "mentionne" },
  { source: "n8", target: "con1", label: "mentionne" },
  { source: "n5", target: "con5", label: "mentionne" },
  { source: "n6", target: "con7", label: "mentionne" },
  { source: "n7", target: "t1", label: "tagué" },
  { source: "n10", target: "t1", label: "tagué" },

  // Note → Tag
  { source: "n9", target: "t8", label: "tagué" },
  { source: "n6", target: "t3", label: "tagué" },
  { source: "n4", target: "t2", label: "tagué" },
  { source: "n2", target: "t5", label: "tagué" },

  // Projet → Concept
  { source: "pr1", target: "con1", label: "implémente" },
  { source: "pr1", target: "con2", label: "sert" },
  { source: "pr1", target: "con6", label: "utilise" },
  { source: "pr4", target: "con7", label: "utilise" },
  { source: "pr6", target: "con3", label: "utilise" },

  // Projet → Tag
  { source: "pr1", target: "t1", label: "tagué" },
  { source: "pr1", target: "t5", label: "tagué" },
  { source: "pr2", target: "t5", label: "tagué" },
  { source: "pr3", target: "t2", label: "tagué" },
  { source: "pr4", target: "t3", label: "tagué" },
  { source: "pr4", target: "t5", label: "tagué" },

  // Concept → Concept
  { source: "con2", target: "con4", label: "inclut" },
  { source: "con2", target: "con8", label: "inclut" },
  { source: "con1", target: "con3", label: "utilise" },
  { source: "con5", target: "con2", label: "lié à" },
  { source: "con7", target: "con2", label: "lié à" },

  // Organisation → Projet
  { source: "o1", target: "pr1", label: "porte" },
  { source: "o5", target: "pr2", label: "porte" },
  { source: "o4", target: "pr4", label: "soutient" },
  { source: "o6", target: "pr6", label: "fournit" },

  // Contact → Contact (relations)
  { source: "p1", target: "p7", label: "connait" },
  { source: "p2", target: "p6", label: "collabore avec" },
  { source: "p3", target: "p5", label: "collabore avec" },
  { source: "p3", target: "p9", label: "mentor de" },

  // Tag → Concept
  { source: "t3", target: "con7", label: "regroupe" },
  { source: "t5", target: "con2", label: "regroupe" },

  // Daily → Notes cross-refs
  { source: "n9", target: "n2", label: "référence" },
  { source: "n9", target: "n1", label: "référence" },
];

/** All distinct node types */
export const ALL_NODE_TYPES: NodeType[] = [
  "contact",
  "organisation",
  "note",
  "projet",
  "tag",
  "concept",
];

/** Color palette per type */
export const NODE_TYPE_COLORS: Record<NodeType, string> = {
  contact: "#6366F1",
  organisation: "#0EA5E9",
  note: "#10B981",
  projet: "#F59E0B",
  tag: "#8B5CF6",
  concept: "#EC4899",
};

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  contact: "Contacts",
  organisation: "Organisations",
  note: "Notes",
  projet: "Projets",
  tag: "Tags",
  concept: "Concepts",
};
