"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import {
  GRAPH_EDGES,
  GRAPH_NODES,
  NODE_TYPE_COLORS,
  type GraphNode,
  type NodeType,
} from "./fixtures";
import { GraphFilters } from "./GraphFilters";
import { GraphTooltip } from "./GraphTooltip";

// Dynamic import to avoid SSR issues with canvas-based library
const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d").then((m) => m.default),
  { ssr: false }
) as React.ComponentType<Record<string, unknown>>;

interface HoveredNode extends GraphNode {
  __x?: number;
  __y?: number;
}

interface GraphNodeDatum extends GraphNode {
  x?: number;
  y?: number;
}

interface GraphLinkDatum {
  source: string | GraphNodeDatum;
  target: string | GraphNodeDatum;
  label?: string;
}

export function KnowledgeGraph() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [activeTypes, setActiveTypes] = useState<NodeType[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [hoveredNode, setHoveredNode] = useState<HoveredNode | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Measure container
  useEffect(() => {
    function measure() {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
      }
    }
    measure();
    const obs = new ResizeObserver(measure);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Filtered data
  const filteredNodes = GRAPH_NODES.filter((n) => {
    const typeOk = activeTypes.length === 0 || activeTypes.includes(n.type);
    const tagOk =
      tagFilter.length === 0 ||
      n.tags.some((t) => t.toLowerCase().includes(tagFilter.replace("#", "").toLowerCase()));
    return typeOk && tagOk;
  });

  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));

  const filteredEdges = GRAPH_EDGES.filter(
    (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
  );

  const graphData = {
    nodes: filteredNodes.map((n) => ({ ...n })) as GraphNodeDatum[],
    links: filteredEdges.map((e) => ({
      source: e.source,
      target: e.target,
      label: e.label,
    })) as GraphLinkDatum[],
  };

  function toggleType(type: NodeType) {
    setActiveTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  }

  const handleNodeHover = useCallback((node: GraphNodeDatum | null) => {
    setHoveredNode(node as HoveredNode | null);
  }, []);

  const handleNodeClick = useCallback(
    (node: GraphNodeDatum) => {
      if (node.path) {
        router.push(node.path);
      }
    },
    [router]
  );

  // Track mouse for tooltip position
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setTooltipPos({ x: e.clientX + 12, y: e.clientY - 8 });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <GraphFilters
        activeTypes={activeTypes}
        onToggleType={toggleType}
        onClearTypes={() => setActiveTypes([])}
        tagFilter={tagFilter}
        onTagFilterChange={setTagFilter}
      />

      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
        style={{ backgroundColor: "var(--surface-0)" }}
        onMouseMove={handleMouseMove}
      >
        {dimensions.width > 0 && (
          <ForceGraph2D
            graphData={graphData as unknown as Record<string, unknown>}
            width={dimensions.width}
            height={dimensions.height}
            backgroundColor="transparent"
            nodeId="id"
            nodeLabel={(node: unknown) => (node as GraphNodeDatum).label}
            nodeVal={(node: unknown) => Math.max(2, (node as GraphNodeDatum).degree)}
            nodeColor={(node: unknown) =>
              NODE_TYPE_COLORS[(node as GraphNodeDatum).type] ?? "#94A3B8"
            }
            nodeRelSize={5}
            linkColor={() => "var(--border-subtle, #e2e8f0)"}
            linkWidth={1}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            onNodeHover={handleNodeHover as (node: unknown) => void}
            onNodeClick={handleNodeClick as (node: unknown) => void}
            enableNodeDrag
            cooldownTicks={100}
          />
        )}

        {/* Tooltip */}
        {hoveredNode && (
          <GraphTooltip node={hoveredNode} position={tooltipPos} />
        )}

        {/* Stats badge */}
        <div
          className="absolute bottom-4 left-4 rounded-lg px-3 py-1.5 text-xs"
          style={{
            backgroundColor: "var(--surface-1)",
            color: "var(--text-muted)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          {filteredNodes.length} noeuds · {filteredEdges.length} liens
        </div>
      </div>
    </div>
  );
}
