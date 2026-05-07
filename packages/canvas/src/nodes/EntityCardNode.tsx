// ============================================================
// EntityCardNode — React Flow node for CRM entities
//
// Uses CSS variables (--text-primary, --text-muted, --accent,
// --surface, --border-subtle) from the host app theme.
// ============================================================

import React, { useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { EntityRef } from "../types/props.js";

export interface EntityCardNodeData {
  entityId: string;
  display?: "card" | "compact";
  resolveEntity?: (id: string) => Promise<EntityRef | null>;
}

const CARD_STYLE: React.CSSProperties = {
  background: "var(--surface, #fff)",
  border: "1px solid var(--border-subtle, #e2e8f0)",
  borderRadius: 8,
  padding: "10px 14px",
  minWidth: 180,
  boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
  fontFamily: "inherit",
  fontSize: 13,
};

const COMPACT_STYLE: React.CSSProperties = {
  ...CARD_STYLE,
  padding: "6px 10px",
  minWidth: 120,
};

/** Renders a preview of a CRM entity with icon, name, and key fields */
export function EntityCardNode({ data }: NodeProps) {
  const nodeData = data as unknown as EntityCardNodeData;
  const [entity, setEntity] = useState<EntityRef | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!nodeData.resolveEntity) {
      setLoading(false);
      return;
    }
    nodeData.resolveEntity(nodeData.entityId).then((e) => {
      setEntity(e);
      setLoading(false);
    });
  }, [nodeData.entityId, nodeData.resolveEntity]);

  const isCompact = nodeData.display === "compact";
  const style = isCompact ? COMPACT_STYLE : CARD_STYLE;

  return (
    <div style={style}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      {loading ? (
        <span style={{ color: "var(--text-muted, #94a3b8)" }}>Loading…</span>
      ) : entity ? (
        <EntityContent entity={entity} compact={isCompact} />
      ) : (
        <MissingEntity entityId={nodeData.entityId} />
      )}
    </div>
  );
}

function EntityContent({
  entity,
  compact,
}: {
  entity: EntityRef;
  compact: boolean;
}) {
  const visibleFields = entity.fields
    ? Object.entries(entity.fields).slice(0, compact ? 1 : 3)
    : [];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {entity.typeIcon && (
          <span style={{ fontSize: 14 }}>{entity.typeIcon}</span>
        )}
        <span
          style={{
            fontWeight: 600,
            color: "var(--text-primary, #1e293b)",
            fontSize: compact ? 12 : 13,
          }}
        >
          {entity.name}
        </span>
      </div>
      {!compact && (
        <div
          style={{
            color: "var(--text-muted, #64748b)",
            fontSize: 11,
            marginTop: 4,
          }}
        >
          {entity.typeName}
        </div>
      )}
      {visibleFields.map(([key, val]) => (
        <div
          key={key}
          style={{ fontSize: 11, color: "var(--text-muted, #64748b)", marginTop: 2 }}
        >
          <span style={{ fontWeight: 500 }}>{key}:</span>{" "}
          {String(val)}
        </div>
      ))}
    </>
  );
}

function MissingEntity({ entityId }: { entityId: string }) {
  return (
    <div style={{ color: "var(--text-muted, #94a3b8)", fontSize: 12 }}>
      <div style={{ fontWeight: 600 }}>Unknown entity</div>
      <div style={{ fontSize: 10, marginTop: 2 }}>{entityId}</div>
    </div>
  );
}
