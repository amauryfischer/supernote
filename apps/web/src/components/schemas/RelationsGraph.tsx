"use client";

import { useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  useNodesState,
  useEdgesState,
  type EdgeTypes,
  type EdgeProps,
  getStraightPath,
  BaseEdge,
  EdgeLabelRenderer,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ENTITY_TYPES, RELATION_TYPES } from "./fixtures";
import { getIcon } from "./icon-map";
import type { RelationType } from "@supernote/core";

// ---- Custom node ----
interface EntityNodeData extends Record<string, unknown> {
  label: string;
  plural: string;
  icon: string;
  color: string;
  fieldCount: number;
}

function EntityNode({ data }: { data: EntityNodeData }) {
  const Icon = getIcon(data.icon as string);
  return (
    <div
      style={{
        borderRadius: 12,
        border: `2px solid ${data.color}`,
        backgroundColor: "#fff",
        padding: "10px 14px",
        minWidth: 140,
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            borderRadius: 8,
            backgroundColor: `${data.color}22`,
            color: data.color as string,
          }}
        >
          <Icon size={14} />
        </span>
        <div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1e1e2e" }}>{data.label as string}</p>
          <p style={{ margin: 0, fontSize: 11, color: "#64748B" }}>{data.fieldCount as number} champs</p>
        </div>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { entityNode: EntityNode as unknown as NodeTypes[string] };

// ---- Custom edge with label ----
function LabeledEdge({ id, sourceX, sourceY, targetX, targetY, label, markerEnd }: EdgeProps) {
  const [edgePath, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{ stroke: "#94A3B8", strokeWidth: 1.5 }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
            cursor: "pointer",
            background: "#fff",
            border: "1px solid #E2E8F0",
            borderRadius: 6,
            padding: "2px 8px",
            fontSize: 11,
            fontWeight: 500,
            color: "#475569",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
          className="nodrag nopan"
        >
          {String(label ?? "")}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes: EdgeTypes = { labeled: LabeledEdge as unknown as EdgeTypes[string] };

// ---- Layout helpers ----
const COLS = 4;
const H_GAP = 220;
const V_GAP = 160;

function buildNodes(): Node[] {
  return ENTITY_TYPES.map((et, i) => ({
    id: et.id,
    type: "entityNode",
    position: {
      x: (i % COLS) * H_GAP + 40,
      y: Math.floor(i / COLS) * V_GAP + 40,
    },
    data: {
      label: et.name,
      plural: et.plural,
      icon: et.icon ?? "Box",
      color: et.color ?? "#6366F1",
      fieldCount: et.fields.length,
    } satisfies EntityNodeData,
  }));
}

function buildEdges(): Edge[] {
  return RELATION_TYPES.map((rel) => ({
    id: rel.id,
    source: rel.sourceTypeId,
    target: rel.targetTypeId,
    type: "labeled",
    label: rel.forwardLabel,
    markerEnd: { type: MarkerType.ArrowClosed, color: "#94A3B8" },
    data: { relId: rel.id },
  }));
}

// ---- Component ----
interface RelationsGraphProps {
  onEdgeClick: (rel: RelationType) => void;
}

export function RelationsGraph({ onEdgeClick }: RelationsGraphProps) {
  const [nodes, , onNodesChange] = useNodesState(buildNodes());
  const [edges, , onEdgesChange] = useEdgesState(buildEdges());

  const handleEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      const rel = RELATION_TYPES.find((r) => r.id === edge.id);
      if (rel) onEdgeClick(rel);
    },
    [onEdgeClick]
  );

  const RF = ReactFlow as unknown as React.ComponentType<{
    nodes: Node[];
    edges: Edge[];
    onNodesChange: typeof onNodesChange;
    onEdgesChange: typeof onEdgesChange;
    nodeTypes: NodeTypes;
    edgeTypes: EdgeTypes;
    onEdgeClick: typeof handleEdgeClick;
    fitView: boolean;
    fitViewOptions: { padding: number };
    children?: React.ReactNode;
  }>;

  return (
    <RF
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onEdgeClick={handleEdgeClick}
      fitView
      fitViewOptions={{ padding: 0.2 }}
    >
      <Background gap={24} color="#e2e8f0" />
      <Controls />
      <MiniMap
        nodeColor={(n) => {
          const et = ENTITY_TYPES.find((t) => t.id === n.id);
          return et?.color ?? "#94A3B8";
        }}
        maskColor="rgba(255,255,255,0.7)"
      />
    </RF>
  );
}
