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

// Default: empty — the app starts with no canvas.
// Use demo-fixtures.ts for demo data.
export const CANVAS_LIST: CanvasMeta[] = [];

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
