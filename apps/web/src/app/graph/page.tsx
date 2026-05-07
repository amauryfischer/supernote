"use client";

import { AppShell } from "@/components/shell";
import { KnowledgeGraph } from "@/components/graph-page";
import { Graph } from "@phosphor-icons/react";

export default function GraphPage() {
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
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: "var(--surface-3)",
              color: "var(--text-muted)",
            }}
          >
            50 noeuds · 80 liens
          </span>
        </div>

        {/* Graph fills remaining space */}
        <div className="flex-1 overflow-hidden">
          <KnowledgeGraph />
        </div>
      </div>
    </AppShell>
  );
}
