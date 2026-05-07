// ============================================================
// useFlowAdapter — converts CanvasDocument ↔ React Flow nodes/edges
//
// Coordinate systems:
//   CanvasDocument: absolute x/y in "world space" (same unit as Excalidraw)
//   React Flow: nodes have x/y in world space too (viewport pan/zoom handled internally)
//
// The two coordinate systems are intentionally kept identical so that
// when the user switches modes, nodes appear at the same position.
// ============================================================

import { useMemo } from "react";
import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { CanvasDocument, CanvasNode, CanvasEdge } from "../types/canvas.js";
import type { EntityRef } from "../types/props.js";

type EntityResolver = (id: string) => Promise<EntityRef | null>;

/** Convert a CanvasNode to a React Flow node */
function canvasNodeToFlow(
  node: CanvasNode,
  resolveEntity: EntityResolver | undefined
): FlowNode {
  const base: FlowNode = {
    id: node.id,
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    data: {},
    type: "default",
  };

  switch (node.type) {
    case "text":
      return { ...base, type: "textNode", data: { text: node.text } };

    case "file":
      return {
        ...base,
        type: "noteEmbedNode",
        data: { file: node.file, subpath: node.subpath },
      };

    case "link":
      return {
        ...base,
        type: "textNode",
        data: { text: node.url },
      };

    case "group":
      return {
        ...base,
        type: "group",
        data: { label: node.label },
        style: {
          background: node.background ?? "rgba(200,200,200,0.1)",
          border: "1px dashed #cbd5e1",
          borderRadius: 8,
          width: node.width,
          height: node.height,
        },
      };

    case "crm":
      return {
        ...base,
        type: "entityCardNode",
        data: {
          entityId: node.entityId,
          display: node.display,
          resolveEntity,
        },
      };

    case "query":
      return {
        ...base,
        type: "queryNode",
        data: { query: node.query, viewMode: node.viewMode },
      };
  }
}

/** Convert a CanvasEdge to a React Flow edge */
function canvasEdgeToFlow(edge: CanvasEdge): FlowEdge {
  return {
    id: edge.id,
    source: edge.fromNode,
    target: edge.toNode,
    sourceHandle: edge.fromSide,
    targetHandle: edge.toSide,
    label: edge.label,
    style: edge.color ? { stroke: edge.color } : undefined,
    data: { relationTypeId: edge.relationTypeId },
  };
}

/** Convert React Flow node positions back to CanvasNode coordinates */
export function flowNodeToCanvasCoords(
  node: FlowNode,
  original: CanvasNode
): CanvasNode {
  return {
    ...original,
    x: node.position.x,
    y: node.position.y,
    width: node.measured?.width ?? original.width,
    height: node.measured?.height ?? original.height,
  } as CanvasNode;
}

interface FlowAdapterResult {
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
}

/** Hook: memoize the CanvasDocument → React Flow conversion */
export function useFlowAdapter(
  doc: CanvasDocument,
  resolveEntity: EntityResolver | undefined
): FlowAdapterResult {
  const flowNodes = useMemo(
    () => doc.nodes.map((n) => canvasNodeToFlow(n, resolveEntity)),
    [doc.nodes, resolveEntity]
  );

  const flowEdges = useMemo(
    () => doc.edges.map(canvasEdgeToFlow),
    [doc.edges]
  );

  return { flowNodes, flowEdges };
}
