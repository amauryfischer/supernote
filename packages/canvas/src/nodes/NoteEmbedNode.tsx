// ============================================================
// NoteEmbedNode — React Flow node that embeds a file/note preview
// ============================================================

import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface NoteEmbedNodeData {
  file: string;
  subpath?: string;
  previewTitle?: string;
  previewLines?: string[];
}

const STYLE: React.CSSProperties = {
  background: "var(--surface, #fff)",
  border: "1px solid var(--border-subtle, #e2e8f0)",
  borderRadius: 8,
  padding: "10px 14px",
  minWidth: 200,
  maxWidth: 280,
  boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
  fontFamily: "inherit",
  fontSize: 13,
};

/** Renders a preview of an embedded note (title + first 2 lines) */
export function NoteEmbedNode({ data }: NodeProps) {
  const nodeData = data as unknown as NoteEmbedNodeData;
  const fileName = nodeData.file.split("/").at(-1) ?? nodeData.file;
  const displayTitle = nodeData.previewTitle ?? fileName;
  const lines = nodeData.previewLines?.slice(0, 2) ?? [];

  return (
    <div style={STYLE}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 14 }}>📄</span>
        <span
          style={{
            fontWeight: 600,
            color: "var(--text-primary, #1e293b)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayTitle}
        </span>
      </div>

      {nodeData.subpath && (
        <div
          style={{ fontSize: 10, color: "var(--accent, #6366f1)", marginBottom: 4 }}
        >
          {nodeData.subpath}
        </div>
      )}

      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            fontSize: 11,
            color: "var(--text-muted, #64748b)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {line}
        </div>
      ))}

      {lines.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--text-muted, #94a3b8)" }}>
          {nodeData.file}
        </div>
      )}
    </div>
  );
}
