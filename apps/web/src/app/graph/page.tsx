"use client";

import { AppShell } from "@/components/shell";
import { KnowledgeGraph, GRAPH_NODES, GRAPH_EDGES } from "@/components/graph-page";
import { Graph } from "@phosphor-icons/react";
import { EmptyState } from "@supernote/ui";

export default function GraphPage() {
  const isEmpty = GRAPH_NODES.length === 0;

  return (
    <AppShell>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Page header */}
        <div
          className="flex shrink-0 items-center gap-3 border-b px-6 py-3"
          style={{
            borderColor: "var(--border-subtle)",
            backgroundColor: "var(--surface-0)",
          }}
        >
          <Graph size={18} style={{ color: "var(--accent)" }} />
          <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            Graphe de connaissance
          </h1>
          {!isEmpty && (
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: "var(--surface-3)",
                color: "var(--text-muted)",
              }}
            >
              {GRAPH_NODES.length} noeuds · {GRAPH_EDGES.length} liens
            </span>
          )}
        </div>

        {/* Graph fills remaining space */}
        <div className="flex-1 overflow-hidden">
          {isEmpty ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={<Graph size={28} />}
                title="Le graphe s'enrichira dès tes premières entités"
                description="Crée des notes, contacts ou projets et les liens apparaîtront automatiquement."
              />
            </div>
          ) : (
            <KnowledgeGraph />
          )}
        </div>
      </div>
    </AppShell>
  );
}
