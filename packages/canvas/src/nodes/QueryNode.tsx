// ============================================================
// QueryNode — React Flow node for query results
// The actual query execution is delegated to the consumer via `runQuery`.
// ============================================================

import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

export interface QueryNodeData {
  query: string;
  viewMode: "list" | "table";
}

const STYLE: React.CSSProperties = {
  background: "var(--surface, #fff)",
  border: "1px solid var(--accent, #6366f1)",
  borderRadius: 8,
  padding: "10px 14px",
  minWidth: 220,
  boxShadow: "0 1px 4px rgba(99,102,241,0.12)",
  fontFamily: "inherit",
  fontSize: 13,
};

/** Placeholder node for a saved query. Execution is provided by the consumer. */
export function QueryNode({ data }: NodeProps) {
  const nodeData = data as unknown as QueryNodeData;

  return (
    <div style={STYLE}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 14 }}>🔍</span>
        <span
          style={{
            fontWeight: 600,
            color: "var(--accent, #6366f1)",
            fontSize: 12,
          }}
        >
          Query
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10,
            background: "var(--accent, #6366f1)",
            color: "#fff",
            borderRadius: 4,
            padding: "1px 6px",
          }}
        >
          {nodeData.viewMode}
        </span>
      </div>

      <div
        style={{
          fontSize: 11,
          color: "var(--text-muted, #64748b)",
          fontFamily: "monospace",
          background: "var(--surface-subtle, #f8fafc)",
          borderRadius: 4,
          padding: "4px 6px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {nodeData.query}
      </div>
    </div>
  );
}
