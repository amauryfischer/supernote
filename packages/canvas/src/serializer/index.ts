// ============================================================
// Canvas serializer — round-trip safe with Obsidian .canvas format
//
// Obsidian ignores unknown node types gracefully (it renders them
// as blank cards), so "crm" and "query" nodes survive round-trips:
// Supernote writes them → Obsidian ignores them → Supernote reads them back.
// ============================================================

import type {
  CanvasDocument,
  CanvasEdge,
  CanvasNode,
  CanvasNodeSide,
} from "../types/canvas.js";

// ----- Raw JSON shapes (permissive, from Obsidian or Supernote) -------

interface RawNode {
  id?: unknown;
  type?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  [key: string]: unknown;
}

interface RawEdge {
  id?: unknown;
  fromNode?: unknown;
  toNode?: unknown;
  fromSide?: unknown;
  toSide?: unknown;
  label?: unknown;
  color?: unknown;
  relationTypeId?: unknown;
}

interface RawDocument {
  nodes?: unknown;
  edges?: unknown;
  excalidrawElements?: unknown;
  metadata?: unknown;
}

// ----- Helpers --------------------------------------------------------

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && isFinite(v) ? v : fallback;
}

function side(v: unknown): CanvasNodeSide | undefined {
  if (v === "top" || v === "right" || v === "bottom" || v === "left") return v;
  return undefined;
}

// ----- Node parsing ---------------------------------------------------

function parseNode(raw: RawNode): CanvasNode | null {
  const id = str(raw["id"]);
  const type = str(raw["type"]);
  const x = num(raw["x"]);
  const y = num(raw["y"]);
  const width = num(raw["width"], 200);
  const height = num(raw["height"], 100);

  if (!id || !type) return null;

  switch (type) {
    case "text":
      return { id, type, x, y, width, height, text: str(raw["text"]) };

    case "file":
      return {
        id,
        type,
        x,
        y,
        width,
        height,
        file: str(raw["file"]),
        ...(raw["subpath"] !== undefined && { subpath: str(raw["subpath"]) }),
      };

    case "link":
      return { id, type, x, y, width, height, url: str(raw["url"]) };

    case "group":
      return {
        id,
        type,
        x,
        y,
        width,
        height,
        ...(raw["label"] !== undefined && { label: str(raw["label"]) }),
        ...(raw["background"] !== undefined && {
          background: str(raw["background"]),
        }),
      };

    case "crm":
      return {
        id,
        type,
        x,
        y,
        width,
        height,
        entityId: str(raw["entityId"]),
        ...(raw["display"] === "card" || raw["display"] === "compact"
          ? { display: raw["display"] as "card" | "compact" }
          : {}),
      };

    case "query":
      return {
        id,
        type,
        x,
        y,
        width,
        height,
        query: str(raw["query"]),
        viewMode: raw["viewMode"] === "table" ? "table" : "list",
      };

    default:
      // Unknown type — skip gracefully (Obsidian extensions we don't know)
      return null;
  }
}

// ----- Edge parsing ---------------------------------------------------

function parseEdge(raw: RawEdge): CanvasEdge | null {
  const id = str(raw["id"]);
  const fromNode = str(raw["fromNode"]);
  const toNode = str(raw["toNode"]);

  if (!id || !fromNode || !toNode) return null;

  return {
    id,
    fromNode,
    toNode,
    ...(raw["fromSide"] !== undefined && { fromSide: side(raw["fromSide"]) }),
    ...(raw["toSide"] !== undefined && { toSide: side(raw["toSide"]) }),
    ...(raw["label"] !== undefined && { label: str(raw["label"]) }),
    ...(raw["color"] !== undefined && { color: str(raw["color"]) }),
    ...(raw["relationTypeId"] !== undefined && {
      relationTypeId: str(raw["relationTypeId"]),
    }),
  };
}

// ----- Public API -----------------------------------------------------

/**
 * Parse a raw JSON string or object into a CanvasDocument.
 * Unknown node types are skipped (Obsidian forward-compatibility).
 * Malformed nodes/edges are skipped individually — the document never fails.
 */
export function parseCanvas(json: string | object): CanvasDocument {
  let raw: RawDocument;

  try {
    raw = (typeof json === "string" ? JSON.parse(json) : json) as RawDocument;
  } catch {
    return { nodes: [], edges: [] };
  }

  const rawNodes = Array.isArray(raw["nodes"]) ? raw["nodes"] : [];
  const rawEdges = Array.isArray(raw["edges"]) ? raw["edges"] : [];

  const nodes: CanvasNode[] = rawNodes
    .map((n: unknown) => parseNode(n as RawNode))
    .filter((n): n is CanvasNode => n !== null);

  const edges: CanvasEdge[] = rawEdges
    .map((e: unknown) => parseEdge(e as RawEdge))
    .filter((e): e is CanvasEdge => e !== null);

  const rawExcali = Array.isArray(raw["excalidrawElements"])
    ? (raw["excalidrawElements"] as unknown[])
    : null;

  const excalidrawElements = rawExcali
    ? rawExcali.filter(
        (e): e is { id: string; type: string; [k: string]: unknown } =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as Record<string, unknown>)["id"] === "string" &&
          typeof (e as Record<string, unknown>)["type"] === "string",
      )
    : undefined;

  const doc: CanvasDocument = {
    nodes,
    edges,
    ...(excalidrawElements && { excalidrawElements }),
  };

  if (raw["metadata"] && typeof raw["metadata"] === "object") {
    const m = raw["metadata"] as Record<string, unknown>;
    return {
      ...doc,
      metadata: {
        version: str(m["version"], "1"),
        createdAt: str(m["createdAt"], new Date().toISOString()),
        updatedAt: str(m["updatedAt"], new Date().toISOString()),
      },
    };
  }

  return doc;
}

/**
 * Serialize a CanvasDocument to a JSON string.
 * The output is Obsidian-compatible: standard types are preserved as-is,
 * Supernote extensions (crm, query) are included but Obsidian ignores them.
 */
export function serializeCanvas(doc: CanvasDocument): string {
  return JSON.stringify(
    {
      nodes: doc.nodes,
      edges: doc.edges,
      ...(doc.excalidrawElements && {
        excalidrawElements: doc.excalidrawElements,
      }),
      ...(doc.metadata && { metadata: doc.metadata }),
    },
    null,
    2
  );
}
