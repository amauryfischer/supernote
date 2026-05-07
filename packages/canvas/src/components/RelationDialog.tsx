// ============================================================
// RelationDialog — modal that appears when two CRM nodes are connected
// The consumer provides `onCreateRelation` to persist the relation.
// ============================================================

import React, { useState } from "react";
import type { RelationCreationResult } from "../types/props.js";

interface RelationDialogProps {
  sourceId: string;
  targetId: string;
  onConfirm: (sourceId: string, targetId: string) => Promise<RelationCreationResult>;
  onCancel: () => void;
}

const OVERLAY_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  zIndex: 100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const DIALOG_STYLE: React.CSSProperties = {
  background: "var(--surface, #fff)",
  borderRadius: 12,
  padding: "24px 28px",
  minWidth: 360,
  maxWidth: 480,
  boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
  fontFamily: "inherit",
};

/** Modal dialog for confirming a relation between two CRM entities */
export function RelationDialog({
  sourceId,
  targetId,
  onConfirm,
  onCancel,
}: RelationDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    const result = await onConfirm(sourceId, targetId);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? "Failed to create relation");
    }
  }

  return (
    <div style={OVERLAY_STYLE} onClick={onCancel}>
      <div style={DIALOG_STYLE} onClick={(e) => e.stopPropagation()}>
        <h2
          style={{
            margin: "0 0 8px",
            fontSize: 16,
            fontWeight: 700,
            color: "var(--text-primary, #1e293b)",
          }}
        >
          Create relation
        </h2>
        <p
          style={{
            margin: "0 0 20px",
            fontSize: 13,
            color: "var(--text-muted, #64748b)",
          }}
        >
          Link <code>{sourceId}</code> to <code>{targetId}</code>
        </p>

        {error && (
          <div
            style={{
              background: "#fef2f2",
              color: "#dc2626",
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 12,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: "8px 18px",
              borderRadius: 6,
              border: "1px solid var(--border-subtle, #e2e8f0)",
              background: "transparent",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            style={{
              padding: "8px 18px",
              borderRadius: 6,
              border: "none",
              background: "var(--accent, #6366f1)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
            }}
          >
            {loading ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
