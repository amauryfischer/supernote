// ============================================================
// TextNode — React Flow node for free text (styled sticky note)
// ============================================================

import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface TextNodeData {
  text: string;
}

const STYLE: React.CSSProperties = {
  background: "var(--surface-highlight, #fefce8)",
  border: "1px solid var(--border-subtle, #fde68a)",
  borderRadius: 6,
  padding: "10px 14px",
  minWidth: 160,
  maxWidth: 320,
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  fontFamily: "inherit",
  fontSize: 13,
  color: "var(--text-primary, #1e293b)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

/** A styled text node (sticky note) */
export function TextNode({ data }: NodeProps) {
  const nodeData = data as unknown as TextNodeData;

  return (
    <div style={STYLE}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      {nodeData.text}
    </div>
  );
}
