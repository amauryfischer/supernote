"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Plus, BookOpen } from "@phosphor-icons/react";
import { AppShell } from "@/components/shell";
import { ViewCard, SAVED_VIEWS, ENTITY_TYPES } from "@/components/views";
import type { ViewKind } from "@supernote/views";

const VIEW_KINDS: Array<{ value: ViewKind | "all"; label: string }> = [
  { value: "all", label: "Toutes" },
  { value: "table", label: "Table" },
  { value: "kanban", label: "Kanban" },
  { value: "gallery", label: "Galerie" },
  { value: "calendar", label: "Calendrier" },
  { value: "timeline", label: "Timeline" },
  { value: "graph", label: "Graphe" },
];

export default function VuesPage() {
  const [activeKind, setActiveKind] = useState<ViewKind | "all">("all");

  const filtered = useMemo(() => {
    if (activeKind === "all") return SAVED_VIEWS;
    return SAVED_VIEWS.filter((v) => v.kind === activeKind);
  }, [activeKind]);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            <BookOpen size={18} style={{ color: "var(--accent)" }} />
            <h1
              className="text-base font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              Vues
            </h1>
            <span
              className="rounded-full px-2 py-0.5 text-xs"
              style={{
                backgroundColor: "var(--accent-subtle)",
                color: "var(--accent)",
              }}
            >
              {SAVED_VIEWS.length}
            </span>
          </div>

          <Link
            href="/vues/nouvelle"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80"
            style={{ backgroundColor: "var(--accent)", color: "white" }}
          >
            <Plus size={14} weight="bold" />
            Nouvelle vue
          </Link>
        </div>

        {/* Kind filter chips */}
        <div
          className="flex items-center gap-2 border-b px-6 py-2"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          {VIEW_KINDS.map(({ value, label }) => {
            const isActive = activeKind === value;
            return (
              <button
                key={value}
                onClick={() => setActiveKind(value)}
                className="rounded-full px-3 py-1 text-xs font-medium transition-all"
                style={{
                  backgroundColor: isActive ? "var(--accent)" : "var(--surface-1)",
                  color: isActive ? "white" : "var(--text-secondary)",
                  border: `1px solid ${isActive ? "var(--accent)" : "var(--border-subtle)"}`,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Views grid */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {filtered.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center gap-3 pt-24 text-center"
              style={{ color: "var(--text-muted)" }}
            >
              <BookOpen size={40} weight="light" />
              <p className="text-sm">Aucune vue de ce type</p>
              <Link
                href="/vues/nouvelle"
                className="text-sm underline"
                style={{ color: "var(--accent)" }}
              >
                Creer une vue
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((view) => (
                <ViewCard key={view.id} view={view} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
