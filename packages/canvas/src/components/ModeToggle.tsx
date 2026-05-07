// ============================================================
// ModeToggle — switches between Draw mode (Excalidraw) and Nodes mode (React Flow)
// ============================================================

import React from "react";
import type { CanvasMode } from "../types/props.js";

interface ModeToggleProps {
  mode: CanvasMode;
  onToggle: (mode: CanvasMode) => void;
  readOnly?: boolean;
}

const CONTAINER_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  zIndex: 20,
  display: "flex",
  background: "var(--surface, #fff)",
  border: "1px solid var(--border-subtle, #e2e8f0)",
  borderRadius: 8,
  overflow: "hidden",
  boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
};

function buttonStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    background: active ? "var(--accent, #6366f1)" : "transparent",
    color: active ? "#fff" : "var(--text-muted, #64748b)",
    border: "none",
    cursor: "pointer",
    transition: "all 0.15s",
  };
}

/** Toggle between Draw (Excalidraw) and Nodes (React Flow) modes */
export function ModeToggle({ mode, onToggle, readOnly }: ModeToggleProps) {
  if (readOnly) return null;

  return (
    <div style={CONTAINER_STYLE}>
      <button
        style={buttonStyle(mode === "nodes")}
        onClick={() => onToggle("nodes")}
        aria-pressed={mode === "nodes"}
      >
        Nodes
      </button>
      <button
        style={buttonStyle(mode === "draw")}
        onClick={() => onToggle("draw")}
        aria-pressed={mode === "draw"}
      >
        Draw
      </button>
    </div>
  );
}
