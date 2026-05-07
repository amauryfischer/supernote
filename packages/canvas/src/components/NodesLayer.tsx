// ============================================================
// NodesLayer — React Flow wrapper (typed nodes mode)
//
// This layer is shown when mode === "nodes". It renders typed nodes
// (text, file, crm, query, group) and handles edge creation.
//
// When two CRM nodes are connected, `onCrmConnect` is called
// to trigger the RelationDialog.
//
// Coordinate space: React Flow uses world coordinates for node positions.
// These are kept identical to CanvasDocument x/y so mode switching
// preserves node positions exactly.
// ============================================================

import React, { useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type OnConnect,
  type Node as FlowNode,
  type Edge as FlowEdge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { EntityCardNode } from "../nodes/EntityCardNode.js";
import { NoteEmbedNode } from "../nodes/NoteEmbedNode.js";
import { QueryNode } from "../nodes/QueryNode.js";
import { TextNode } from "../nodes/TextNode.js";

const NODE_TYPES: NodeTypes = {
  entityCardNode: EntityCardNode,
  noteEmbedNode: NoteEmbedNode,
  queryNode: QueryNode,
  textNode: TextNode,
};

export interface NodesLayerProps {
  initialNodes: FlowNode[];
  initialEdges: FlowEdge[];
  onNodesChange?: (nodes: FlowNode[]) => void;
  onEdgesChange?: (edges: FlowEdge[]) => void;
  /** Called when two nodes are connected — caller decides whether to open relation dialog */
  onConnect?: (connection: { source: string; target: string }) => void;
  readOnly?: boolean;
}

/** React Flow layer for typed nodes with edges */
export function NodesLayer({
  initialNodes,
  initialEdges,
  onNodesChange,
  onEdgesChange,
  onConnect: onConnectProp,
  readOnly,
}: NodesLayerProps) {
  const [nodes, setNodes, handleNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, handleEdgesChange] = useEdgesState(initialEdges);

  const handleConnect: OnConnect = useCallback(
    (connection) => {
      if (connection.source && connection.target) {
        onConnectProp?.({ source: connection.source, target: connection.target });
      }
    },
    [onConnectProp]
  );

  // Propagate changes to parent
  const handleNodesChangeWrapped = useCallback(
    (changes: Parameters<typeof handleNodesChange>[0]) => {
      handleNodesChange(changes);
      // Defer to let state settle
      setTimeout(() => {
        setNodes((prev) => {
          onNodesChange?.(prev);
          return prev;
        });
      }, 0);
    },
    [handleNodesChange, setNodes, onNodesChange]
  );

  const handleEdgesChangeWrapped = useCallback(
    (changes: Parameters<typeof handleEdgesChange>[0]) => {
      handleEdgesChange(changes);
      setTimeout(() => {
        setEdges((prev) => {
          onEdgesChange?.(prev);
          return prev;
        });
      }, 0);
    },
    [handleEdgesChange, setEdges, onEdgesChange]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      onNodesChange={handleNodesChangeWrapped}
      onEdgesChange={handleEdgesChangeWrapped}
      onConnect={handleConnect}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      elementsSelectable={!readOnly}
      fitView
    >
      <Background />
      <Controls />
      <MiniMap
        nodeColor={(node) => {
          if (node.type === "entityCardNode") return "var(--accent, #6366f1)";
          if (node.type === "queryNode") return "var(--accent, #6366f1)";
          return "#e2e8f0";
        }}
      />
    </ReactFlow>
  );
}
