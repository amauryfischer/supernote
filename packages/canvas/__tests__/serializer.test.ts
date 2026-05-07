// ============================================================
// Serializer tests — round-trip safety for all node/edge types
// ============================================================

import { describe, it, expect } from "vitest";
import { parseCanvas, serializeCanvas } from "../src/serializer/index.js";
import type {
  CanvasDocument,
  CanvasTextNode,
  CanvasFileNode,
  CanvasLinkNode,
  CanvasGroupNode,
  CanvasCrmNode,
  CanvasQueryNode,
  CanvasEdge,
} from "../src/types/canvas.js";

// ----- Fixtures ---------------------------------------------------

const TEXT_NODE: CanvasTextNode = {
  id: "n1",
  type: "text",
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  text: "Hello world",
};

const FILE_NODE: CanvasFileNode = {
  id: "n2",
  type: "file",
  x: 250,
  y: 0,
  width: 200,
  height: 100,
  file: "Notes/My Note.md",
  subpath: "#Introduction",
};

const FILE_NODE_NO_SUBPATH: CanvasFileNode = {
  id: "n2b",
  type: "file",
  x: 250,
  y: 0,
  width: 200,
  height: 100,
  file: "Notes/My Note.md",
};

const LINK_NODE: CanvasLinkNode = {
  id: "n3",
  type: "link",
  x: 500,
  y: 0,
  width: 200,
  height: 100,
  url: "https://example.com",
};

const GROUP_NODE: CanvasGroupNode = {
  id: "n4",
  type: "group",
  x: 0,
  y: 200,
  width: 600,
  height: 400,
  label: "My Group",
  background: "#f0f4ff",
};

const GROUP_NODE_MINIMAL: CanvasGroupNode = {
  id: "n4b",
  type: "group",
  x: 0,
  y: 200,
  width: 600,
  height: 400,
};

const CRM_NODE: CanvasCrmNode = {
  id: "n5",
  type: "crm",
  x: 100,
  y: 100,
  width: 240,
  height: 120,
  entityId: "01HX2KABC123",
  display: "card",
};

const CRM_NODE_COMPACT: CanvasCrmNode = {
  id: "n5b",
  type: "crm",
  x: 100,
  y: 100,
  width: 160,
  height: 60,
  entityId: "01HX2KABC456",
  display: "compact",
};

const CRM_NODE_NO_DISPLAY: CanvasCrmNode = {
  id: "n5c",
  type: "crm",
  x: 100,
  y: 100,
  width: 160,
  height: 60,
  entityId: "01HX2KABC789",
};

const QUERY_NODE: CanvasQueryNode = {
  id: "n6",
  type: "query",
  x: 400,
  y: 300,
  width: 300,
  height: 200,
  query: "type:Personne tag:client",
  viewMode: "table",
};

const QUERY_NODE_LIST: CanvasQueryNode = {
  id: "n6b",
  type: "query",
  x: 400,
  y: 300,
  width: 300,
  height: 200,
  query: "type:Projet status:active",
  viewMode: "list",
};

const EDGE_BASIC: CanvasEdge = {
  id: "e1",
  fromNode: "n1",
  toNode: "n2",
};

const EDGE_FULL: CanvasEdge = {
  id: "e2",
  fromNode: "n5",
  toNode: "n5b",
  fromSide: "right",
  toSide: "left",
  label: "works at",
  color: "#6366f1",
  relationTypeId: "rel-type-001",
};

// ----- Helpers ---------------------------------------------------

function roundTrip(doc: CanvasDocument): CanvasDocument {
  return parseCanvas(serializeCanvas(doc));
}

// ----- Tests -----------------------------------------------------

describe("parseCanvas", () => {
  it("parses an empty document", () => {
    const result = parseCanvas('{"nodes":[],"edges":[]}');
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("returns empty doc on invalid JSON", () => {
    const result = parseCanvas("not json {{{}");
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("returns empty doc on empty input", () => {
    const result = parseCanvas("{}");
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("skips unknown node types gracefully", () => {
    const json = JSON.stringify({
      nodes: [
        { id: "x1", type: "canvas", x: 0, y: 0, width: 100, height: 100 },
        TEXT_NODE,
      ],
      edges: [],
    });
    const result = parseCanvas(json);
    // Unknown "canvas" type is skipped; "text" is kept
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.type).toBe("text");
  });

  it("skips malformed nodes (missing id)", () => {
    const json = JSON.stringify({
      nodes: [{ type: "text", x: 0, y: 0, width: 100, height: 100, text: "hi" }],
      edges: [],
    });
    const result = parseCanvas(json);
    expect(result.nodes).toHaveLength(0);
  });

  it("skips malformed edges (missing fromNode)", () => {
    const json = JSON.stringify({
      nodes: [TEXT_NODE],
      edges: [{ id: "e1", toNode: "n1" }],
    });
    const result = parseCanvas(json);
    expect(result.edges).toHaveLength(0);
  });

  it("preserves metadata when present", () => {
    const doc: CanvasDocument = {
      nodes: [],
      edges: [],
      metadata: {
        version: "2",
        createdAt: "2026-05-07T00:00:00Z",
        updatedAt: "2026-05-07T12:00:00Z",
      },
    };
    const result = parseCanvas(serializeCanvas(doc));
    expect(result.metadata?.version).toBe("2");
    expect(result.metadata?.createdAt).toBe("2026-05-07T00:00:00Z");
  });

  it("accepts object input (not just strings)", () => {
    const raw = { nodes: [TEXT_NODE], edges: [] };
    const result = parseCanvas(raw);
    expect(result.nodes).toHaveLength(1);
  });
});

describe("Round-trip: all node types", () => {
  it("text node round-trips", () => {
    const doc: CanvasDocument = { nodes: [TEXT_NODE], edges: [] };
    const result = roundTrip(doc);
    expect(result.nodes[0]).toEqual(TEXT_NODE);
  });

  it("file node with subpath round-trips", () => {
    const doc: CanvasDocument = { nodes: [FILE_NODE], edges: [] };
    const result = roundTrip(doc);
    expect(result.nodes[0]).toEqual(FILE_NODE);
  });

  it("file node without subpath round-trips", () => {
    const doc: CanvasDocument = { nodes: [FILE_NODE_NO_SUBPATH], edges: [] };
    const result = roundTrip(doc);
    expect((result.nodes[0] as CanvasFileNode).subpath).toBeUndefined();
    expect((result.nodes[0] as CanvasFileNode).file).toBe("Notes/My Note.md");
  });

  it("link node round-trips", () => {
    const doc: CanvasDocument = { nodes: [LINK_NODE], edges: [] };
    const result = roundTrip(doc);
    expect(result.nodes[0]).toEqual(LINK_NODE);
  });

  it("group node with label and background round-trips", () => {
    const doc: CanvasDocument = { nodes: [GROUP_NODE], edges: [] };
    const result = roundTrip(doc);
    expect(result.nodes[0]).toEqual(GROUP_NODE);
  });

  it("group node without optional fields round-trips", () => {
    const doc: CanvasDocument = { nodes: [GROUP_NODE_MINIMAL], edges: [] };
    const result = roundTrip(doc);
    expect((result.nodes[0] as CanvasGroupNode).label).toBeUndefined();
    expect((result.nodes[0] as CanvasGroupNode).background).toBeUndefined();
  });

  it("crm node with display:card round-trips", () => {
    const doc: CanvasDocument = { nodes: [CRM_NODE], edges: [] };
    const result = roundTrip(doc);
    expect(result.nodes[0]).toEqual(CRM_NODE);
  });

  it("crm node with display:compact round-trips", () => {
    const doc: CanvasDocument = { nodes: [CRM_NODE_COMPACT], edges: [] };
    const result = roundTrip(doc);
    expect((result.nodes[0] as CanvasCrmNode).display).toBe("compact");
  });

  it("crm node without display round-trips", () => {
    const doc: CanvasDocument = { nodes: [CRM_NODE_NO_DISPLAY], edges: [] };
    const result = roundTrip(doc);
    expect((result.nodes[0] as CanvasCrmNode).display).toBeUndefined();
  });

  it("query node with viewMode:table round-trips", () => {
    const doc: CanvasDocument = { nodes: [QUERY_NODE], edges: [] };
    const result = roundTrip(doc);
    expect(result.nodes[0]).toEqual(QUERY_NODE);
  });

  it("query node with viewMode:list round-trips", () => {
    const doc: CanvasDocument = { nodes: [QUERY_NODE_LIST], edges: [] };
    const result = roundTrip(doc);
    expect((result.nodes[0] as CanvasQueryNode).viewMode).toBe("list");
  });
});

describe("Round-trip: edges", () => {
  it("basic edge round-trips", () => {
    const doc: CanvasDocument = { nodes: [TEXT_NODE, FILE_NODE], edges: [EDGE_BASIC] };
    const result = roundTrip(doc);
    expect(result.edges[0]).toEqual(EDGE_BASIC);
  });

  it("full edge with all fields round-trips", () => {
    const doc: CanvasDocument = { nodes: [CRM_NODE, CRM_NODE_COMPACT], edges: [EDGE_FULL] };
    const result = roundTrip(doc);
    expect(result.edges[0]).toEqual(EDGE_FULL);
  });

  it("edge fromSide and toSide are preserved", () => {
    const doc: CanvasDocument = { nodes: [TEXT_NODE, LINK_NODE], edges: [EDGE_FULL] };
    const result = roundTrip(doc);
    expect(result.edges[0]?.fromSide).toBe("right");
    expect(result.edges[0]?.toSide).toBe("left");
  });

  it("edge with invalid side is stripped", () => {
    const json = JSON.stringify({
      nodes: [],
      edges: [{ id: "e1", fromNode: "n1", toNode: "n2", fromSide: "diagonal" }],
    });
    const result = parseCanvas(json);
    expect(result.edges[0]?.fromSide).toBeUndefined();
  });
});

describe("Round-trip: mixed document", () => {
  it("full document with all node types and edges round-trips", () => {
    const doc: CanvasDocument = {
      nodes: [
        TEXT_NODE,
        FILE_NODE,
        LINK_NODE,
        GROUP_NODE,
        CRM_NODE,
        QUERY_NODE,
      ],
      edges: [EDGE_BASIC, EDGE_FULL],
      metadata: {
        version: "1",
        createdAt: "2026-05-07T00:00:00Z",
        updatedAt: "2026-05-07T12:00:00Z",
      },
    };
    const result = roundTrip(doc);
    expect(result.nodes).toHaveLength(6);
    expect(result.edges).toHaveLength(2);
    expect(result.metadata?.version).toBe("1");
  });

  it("Obsidian ignores crm/query nodes — they survive as-is after round-trip through Supernote", () => {
    // Simulate: Supernote writes → "Obsidian reads and ignores crm/query" → Supernote reads back
    // In practice Obsidian drops them but since we write them back ourselves they're preserved
    const doc: CanvasDocument = {
      nodes: [TEXT_NODE, CRM_NODE, QUERY_NODE],
      edges: [],
    };
    const json = serializeCanvas(doc);
    // The JSON contains the crm and query nodes
    expect(json).toContain('"type": "crm"');
    expect(json).toContain('"type": "query"');
    // Supernote can read them back
    const result = parseCanvas(json);
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.some((n) => n.type === "crm")).toBe(true);
    expect(result.nodes.some((n) => n.type === "query")).toBe(true);
  });
});
