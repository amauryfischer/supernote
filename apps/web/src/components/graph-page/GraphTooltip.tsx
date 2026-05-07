"use client";

import { NODE_TYPE_COLORS, NODE_TYPE_LABELS, type GraphNode } from "./fixtures";

interface GraphTooltipProps {
  node: GraphNode;
  position: { x: number; y: number };
}

export function GraphTooltip({ node, position }: GraphTooltipProps) {
  const color = NODE_TYPE_COLORS[node.type];

  return (
    <div
      className="pointer-events-none fixed z-50 rounded-lg border px-3 py-2 shadow-lg"
      style={{
        left: position.x,
        top: position.y,
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
        minWidth: 160,
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="font-semibold text-sm" style={{ color: "var(--text-primary)" }}>
          {node.label}
        </span>
      </div>

      <p className="mt-0.5 text-xs" style={{ color }}>
        {NODE_TYPE_LABELS[node.type]}
      </p>

      {node.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {node.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full px-1.5 py-0.5 text-xs"
              style={{
                backgroundColor: "var(--surface-2)",
                color: "var(--text-muted)",
              }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        {node.degree} connexions
        {node.path && " · Cliquer pour ouvrir"}
      </p>
    </div>
  );
}
