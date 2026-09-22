"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Graph } from "@phosphor-icons/react";
import { EmptyState } from "@supernote/ui";
import { trpc } from "@/lib/trpc/client";
import { useWorkerReady } from "@/components/notes/hooks";
import { NODE_TYPE_COLORS, type GraphNode, type NodeType } from "./fixtures";
import { GraphFilters } from "./GraphFilters";
import { GraphTooltip } from "./GraphTooltip";

// Chargé à la demande : la bibliothèque dessine sur canvas et pèse lourd.
const ForceGraph2D = dynamic(
  () => import("react-force-graph-2d").then((m) => m.default),
  { ssr: false }
) as React.ComponentType<Record<string, unknown>>;

interface GraphNodeDatum extends GraphNode {
  typeId: string;
  x?: number;
  y?: number;
}

interface GraphLinkDatum {
  source: string | GraphNodeDatum;
  target: string | GraphNodeDatum;
}

const TYPE_OF: Record<string, NodeType> = {
  note: "note",
  personne: "contact",
  organisation: "organisation",
  tag: "tag",
};

/** Le canvas ne lit pas les variables CSS : on résout le token une fois par thème. */
function cssToken(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function KnowledgeGraph() {
  const router = useRouter();
  const workerReady = useWorkerReady();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [activeTypes, setActiveTypes] = useState<NodeType[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [hoveredNode, setHoveredNode] = useState<GraphNodeDatum | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const graphQuery = trpc.entities.graph.useQuery(undefined, { enabled: workerReady, staleTime: 60_000 });

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

  const nodes = useMemo<GraphNodeDatum[]>(
    () =>
      (graphQuery.data?.nodes ?? []).map((n) => ({
        id: n.id,
        typeId: n.typeId,
        label: n.title,
        type: TYPE_OF[n.typeId] ?? "concept",
        tags: n.tags,
        date: "",
        degree: n.degree,
        ...(n.typeId === "note" ? { path: `/notes/${n.id}` } : n.typeId === "personne" ? { path: `/contacts/${n.id}` } : {}),
      })),
    [graphQuery.data],
  );

  const tag = tagFilter.replace("#", "").toLowerCase();
  const filteredNodes = nodes.filter(
    (n) =>
      (activeTypes.length === 0 || activeTypes.includes(n.type)) &&
      (tag.length === 0 || n.tags.some((t) => t.toLowerCase().includes(tag))),
  );
  const filteredIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = (graphQuery.data?.edges ?? []).filter((e) => filteredIds.has(e.source) && filteredIds.has(e.target));

  const graphData = {
    nodes: filteredNodes.map((n) => ({ ...n })),
    links: filteredEdges.map((e) => ({ source: e.source, target: e.target })) as GraphLinkDatum[],
  };

  const linkColor = cssToken("--border", "#d4d4d8");

  function toggleType(type: NodeType) {
    setActiveTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }

  const handleNodeClick = useCallback(
    (node: GraphNodeDatum) => {
      if (node.path) {
        router.push(node.path);
        return;
      }
      window.dispatchEvent(new CustomEvent("supernote:open-peek", { detail: { baseId: node.typeId, entityId: node.id } }));
    },
    [router],
  );

  if (!workerReady) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState icon={<Graph size={28} aria-hidden />} title="Ouvre un coffre pour voir la carte" />
      </div>
    );
  }
  if (graphQuery.isSuccess && nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={<Graph size={28} aria-hidden />}
          title="Aucun lien pour l'instant"
          description="Tape [[ ou @ dans une note pour relier une note, un contact ou une fiche : les liens apparaissent ici."
        />
      </div>
    );
  }

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
        onMouseMove={(e) => setTooltipPos({ x: e.clientX + 12, y: e.clientY - 8 })}
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
            nodeColor={(node: unknown) => NODE_TYPE_COLORS[(node as GraphNodeDatum).type] ?? "#94A3B8"}
            nodeRelSize={5}
            linkColor={() => linkColor}
            linkWidth={1}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            onNodeHover={((node: GraphNodeDatum | null) => setHoveredNode(node)) as (node: unknown) => void}
            onNodeClick={handleNodeClick as (node: unknown) => void}
            enableNodeDrag
            cooldownTicks={100}
          />
        )}

        {hoveredNode && <GraphTooltip node={hoveredNode} position={tooltipPos} />}

        <div
          className="absolute bottom-4 left-4 rounded-lg px-3 py-1.5 text-xs"
          style={{
            backgroundColor: "var(--surface-1)",
            color: "var(--text-muted)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          {filteredNodes.length} nœuds · {filteredEdges.length} liens
          {graphQuery.data?.truncated ? " · les plus cités seulement" : ""}
        </div>
      </div>
    </div>
  );
}
