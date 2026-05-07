"use client";

import Link from "next/link";
import {
  Table,
  Kanban,
  Images,
  CalendarBlank,
  ChartBar,
  Graph,
  Trash,
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
  /** If provided, shows a delete button on hover. */
  onDelete?: (id: string) => void;
}

export function ViewCard({ view, onDelete }: ViewCardProps) {
  const meta = KIND_META[view.kind];
  const IconComponent = meta.icon;
  const entityLabel = ENTITY_TYPES[view.entityTypeId] ?? view.entityTypeId;

  return (
    <div className="group relative">
      <Link
        href={`/vues/${view.id}`}
        className="flex flex-col gap-3 rounded-xl border p-4 transition-all hover:shadow-md"
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
          <span className="text-xs font-medium" style={{ color: meta.color }}>
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
          <p className="mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
            {entityLabel}
          </p>
        </div>

        <div className="mt-auto text-xs" style={{ color: "var(--text-muted)" }}>
          {view.resultCount} résultats
        </div>
      </Link>

      {onDelete && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onDelete(view.id);
          }}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[oklch(0.93_0.10_28_/_0.15)]"
          style={{ color: "var(--danger)" }}
          aria-label="Supprimer la vue"
        >
          <Trash size={13} />
        </button>
      )}
    </div>
  );
}
