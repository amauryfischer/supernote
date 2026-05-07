import type { CanvasDocument } from "@supernote/canvas";

export interface CanvasMeta {
  id: string;
  title: string;
  updatedAt: string;
  nodeCount: number;
  edgeCount: number;
  thumbnail?: string;
  tags: string[];
}

export const CANVAS_LIST: CanvasMeta[] = [
  {
    id: "c1",
    title: "Architecture Supernote",
    updatedAt: "2026-05-07T10:00:00Z",
    nodeCount: 12,
    edgeCount: 8,
    tags: ["dev", "architecture"],
  },
  {
    id: "c2",
    title: "Roadmap Q2 — Produit",
    updatedAt: "2026-05-06T16:30:00Z",
    nodeCount: 7,
    edgeCount: 4,
    tags: ["produit", "Q2"],
  },
  {
    id: "c3",
    title: "Réseau contacts investisseurs",
    updatedAt: "2026-05-05T14:00:00Z",
    nodeCount: 18,
    edgeCount: 22,
    tags: ["contacts", "finance"],
  },
  {
    id: "c4",
    title: "Design system — Tokens",
    updatedAt: "2026-05-04T11:00:00Z",
    nodeCount: 9,
    edgeCount: 5,
    tags: ["design"],
  },
  {
    id: "c5",
    title: "Brainstorm : PKM features",
    updatedAt: "2026-05-03T09:30:00Z",
    nodeCount: 24,
    edgeCount: 14,
    tags: ["idées", "produit"],
  },
  {
    id: "c6",
    title: "Projet Falcon — Brief",
    updatedAt: "2026-05-02T15:00:00Z",
    nodeCount: 6,
    edgeCount: 3,
    tags: ["projet"],
  },
  {
    id: "c7",
    title: "Veille concurrentielle IA",
    updatedAt: "2026-04-30T17:00:00Z",
    nodeCount: 15,
    edgeCount: 9,
    tags: ["IA", "veille"],
  },
  {
    id: "c8",
    title: "Organisation personnelle",
    updatedAt: "2026-04-28T10:00:00Z",
    nodeCount: 5,
    edgeCount: 2,
    tags: ["perso"],
  },
];

/** A fixture canvas document used by the editor */
export const FIXTURE_CANVAS_DOCUMENT: CanvasDocument = {
  nodes: [
    {
      id: "n1",
      type: "text",
      x: 100,
      y: 100,
      width: 220,
      height: 80,
      text: "## Architecture Supernote\nMonorepo Turborepo avec Next.js + Electron.",
    },
    {
      id: "n2",
      type: "text",
      x: 400,
      y: 80,
      width: 200,
      height: 80,
      text: "**Apps**\n- web (Next.js 15)\n- desktop (Electron)",
    },
    {
      id: "n3",
      type: "text",
      x: 400,
      y: 220,
      width: 200,
      height: 80,
      text: "**Packages**\n- editor, canvas, core\n- ipc, finance, search",
    },
    {
      id: "n4",
      type: "crm",
      x: 100,
      y: 250,
      width: 220,
      height: 100,
      entityId: "entity-1",
      display: "card",
    },
    {
      id: "n5",
      type: "query",
      x: 680,
      y: 150,
      width: 240,
      height: 100,
      query: "type:Contact tag:dev",
      viewMode: "list",
    },
  ],
  edges: [
    { id: "e1", fromNode: "n1", toNode: "n2", label: "contient" },
    { id: "e2", fromNode: "n1", toNode: "n3", label: "contient" },
    { id: "e3", fromNode: "n1", toNode: "n4" },
  ],
  metadata: {
    version: "1",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-07T10:00:00Z",
  },
};

export function getCanvasById(id: string): CanvasMeta | undefined {
  return CANVAS_LIST.find((c) => c.id === id);
}
