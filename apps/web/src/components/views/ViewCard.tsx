"use client";

import Link from "next/link";
import {
  Table,
  Kanban,
  Images,
  CalendarBlank,
  ChartBar,
  Graph,
} from "@phosphor-icons/react";
import type { ViewKind } from "@supernote/views";
import type { SavedView } from "./fixtures";
import { ENTITY_TYPES } from "./fixtures";

const KIND_META: Record<ViewKind, { label: string; icon: React.ElementType; color: string }> = {
  table: { label: "Table", icon: Table, color: "var(--accent)" },
  kanban: { label: "Kanban", icon: Kanban, color: "#f59e0b" },
  gallery: { label: "Galerie", icon: Images, color: "#8b5cf6" },
  calendar: { label: "Calendrier", icon: CalendarBlank, color: "#10b981" },
  timeline: { label: "Timeline", icon: ChartBar, color: "#ef4444" },
  graph: { label: "Graphe", icon: Graph, color: "#06b6d4" },
};

interface ViewCardProps {
  view: SavedView;
}

export function ViewCard({ view }: ViewCardProps) {
  const meta = KIND_META[view.kind];
  const IconComponent = meta.icon;
  const entityLabel = ENTITY_TYPES[view.entityTypeId] ?? view.entityTypeId;

  return (
    <Link
      href={`/vues/${view.id}`}
      className="group flex flex-col gap-3 rounded-xl border p-4 transition-all hover:shadow-md"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${meta.color}18`, color: meta.color }}
        >
          <IconComponent size={16} weight="bold" />
        </div>
        <span
          className="text-xs font-medium"
          style={{ color: meta.color }}
        >
          {meta.label}
        </span>
      </div>

      <div>
        <h3
          className="text-sm font-semibold leading-tight group-hover:underline"
          style={{ color: "var(--text-primary)" }}
        >
          {view.name}
        </h3>
        <p
          className="mt-1 text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          {entityLabel}
        </p>
      </div>

      <div
        className="mt-auto text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        {view.resultCount} resultats
      </div>
    </Link>
  );
}
