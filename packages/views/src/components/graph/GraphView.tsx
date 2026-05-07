import React, { useMemo, useCallback } from "react";
import type { Entity } from "@supernote/core/types";
import type { ViewProps } from "../../types/index.js";
import { queryEntities } from "../../query/index.js";
import { getEntityLabel } from "../../utils/field.js";

export interface GraphNode {
  id: string;
  label: string;
  color?: string;
  val?: number;
  entity: Entity;
}

export interface GraphLink {
  source: string;
  target: string;
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export function GraphView<T extends Entity = Entity>({
  view,
  entities,
  schema,
  edges,
  onEntityClick,
}: ViewProps<T>): React.JSX.Element {
  const nodeLabelFieldId = view.graphConfig?.nodeLabelFieldId;
  const nodeColorFieldId = view.graphConfig?.nodeColorFieldId;
  const nodeSize = view.graphConfig?.nodeSize ?? 6;

  const processed = useMemo(
    () => queryEntities(entities, view.filters ?? [], view.sort ?? []),
    [entities, view.filters, view.sort]
  );

  const graphData = useMemo<GraphData>(() => {
    const nodes: GraphNode[] = processed.map((entity) => ({
      id: entity.id,
      label: nodeLabelFieldId
        ? String(entity.fields[nodeLabelFieldId] ?? getEntityLabel(entity, schema))
        : getEntityLabel(entity, schema),
      color: nodeColorFieldId ? String(entity.fields[nodeColorFieldId] ?? "#3b82f6") : "#3b82f6",
      val: nodeSize,
      entity,
    }));

    const links: GraphLink[] = (edges ?? []).map((e) => ({
      source: e.sourceId,
      target: e.targetId,
      label: e.label,
    }));

    return { nodes, links };
  }, [processed, edges, nodeLabelFieldId, nodeColorFieldId, nodeSize, schema]);

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      onEntityClick?.(node.entity as T);
    },
    [onEntityClick]
  );

  return (
    <FallbackGraphView
      graphData={graphData}
      onNodeClick={handleNodeClick}
    />
  );
}

interface FallbackGraphViewProps {
  graphData: GraphData;
  onNodeClick: (node: GraphNode) => void;
}

function FallbackGraphView({
  graphData,
  onNodeClick,
}: FallbackGraphViewProps): React.JSX.Element {
  return (
    <div
      data-testid="graph-view"
      style={{ padding: 16 }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {graphData.nodes.map((node) => (
          <button
            key={node.id}
            data-testid="graph-node"
            onClick={() => onNodeClick(node)}
            style={{
              padding: "6px 12px",
              borderRadius: 20,
              background: node.color ?? "#3b82f6",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {node.label}
          </button>
        ))}
      </div>
      {graphData.links.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: "#64748b" }}>
          {graphData.links.length} relationship(s)
        </div>
      )}
    </div>
  );
}
