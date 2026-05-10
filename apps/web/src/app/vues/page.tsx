"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, BookOpen } from "@phosphor-icons/react";
import { AppShell, useMobileFab, useMobileTitle } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ViewCard, SAVED_VIEWS } from "@/components/views";
import type { SavedView } from "@/components/views";
import { trpc } from "@/lib/trpc/client";
import type { ViewKind } from "@supernote/views";
import type { View } from "@supernote/ipc";

// ── IPC → local adapter ───────────────────────────────────────────────────

const VIEW_TYPE_MAP: Record<string, ViewKind> = {
  table: "table",
  kanban: "kanban",
  gallery: "gallery",
  calendar: "calendar",
  timeline: "timeline",
  graph: "graph",
};

function viewFromIpc(v: View): SavedView {
  const kind: ViewKind = VIEW_TYPE_MAP[v.type] ?? "table";
  return {
    id: v.id,
    name: v.name,
    kind,
    entityTypeId: v.typeId ?? "entity",
    filters: (v.config.filters ?? []).map((f) => ({
      fieldId: f.field,
      operator: f.operator as import("@supernote/views").FilterClause["operator"],
      value: f.value as import("@supernote/views").FilterClause["value"],
    })),
    sort: (v.config.sorts ?? []).map((s) => ({
      fieldId: s.field,
      direction: s.direction,
    })),
    groupBy: v.config.groupBy,
    columns: v.config.columns
      ? v.config.columns.map((c) => ({ fieldId: c, hidden: false, width: undefined }))
      : undefined,
    resultCount: 0,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

// ── Skeleton ──────────────────────────────────────────────────────────────

function ViewCardSkeleton() {
  return (
    <div
      className="animate-pulse rounded-xl border p-4"
      style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)", minHeight: 120 }}
    >
      <div className="h-3 w-32 rounded mb-2" style={{ backgroundColor: "var(--surface-3)" }} />
      <div className="h-2.5 w-20 rounded" style={{ backgroundColor: "var(--surface-3)" }} />
    </div>
  );
}

// ── Filter chips ──────────────────────────────────────────────────────────

const VIEW_KINDS: Array<{ value: ViewKind | "all"; label: string }> = [
  { value: "all", label: "Toutes" },
  { value: "table", label: "Table" },
  { value: "kanban", label: "Kanban" },
  { value: "gallery", label: "Galerie" },
  { value: "calendar", label: "Calendrier" },
  { value: "timeline", label: "Timeline" },
  { value: "graph", label: "Graphe" },
];

// ── Page ──────────────────────────────────────────────────────────────────

export default function VuesPage() {
  const listQuery = trpc.views.list.useQuery({});
  const deleteMutation = trpc.views.delete.useMutation({
    onSuccess: () => { void listQuery.refetch(); },
  });
  const router = useRouter();

  const [activeKind, setActiveKind] = useState<ViewKind | "all">("all");

  const useFallback = listQuery.isError;
  const allViews: SavedView[] = useFallback
    ? SAVED_VIEWS // SAVED_VIEWS is [] by default
    : (listQuery.data ?? []).map(viewFromIpc);

  const filtered = useMemo(() => {
    if (activeKind === "all") return allViews;
    return allViews.filter((v) => v.kind === activeKind);
  }, [allViews, activeKind]);

  function handleDelete(id: string) {
    if (!confirm("Supprimer cette vue ?")) return;
    if (useFallback) return;
    deleteMutation.mutate({ id });
  }

  const isMobile = useIsMobile();
  useMobileTitle(isMobile ? "Vues" : null, isMobile ? `${allViews.length}` : null);
  useMobileFab(
    isMobile
      ? { icon: Plus, label: "Nouvelle vue", onPress: () => router.push("/vues/nouvelle") }
      : null,
  );

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Header — hidden on mobile (title/FAB live in shell) */}
        <div
          className="hidden items-center justify-between border-b px-6 py-3 md:flex"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2">
            <BookOpen size={18} style={{ color: "var(--accent)" }} />
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              Vues
            </h1>
            <span
              className="rounded-full px-2 py-0.5 text-xs"
              style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
            >
              {allViews.length}
            </span>
            {useFallback && (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: "oklch(0.93 0.10 60 / 0.20)", color: "oklch(0.50 0.15 60)" }}
              >
                mode dégradé
              </span>
            )}
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
          className="flex items-center gap-2 overflow-x-auto border-b px-3 py-2 md:px-6 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6">
          {listQuery.isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 6 }).map((_, i) => <ViewCardSkeleton key={i} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center gap-3 pt-24 text-center"
              style={{ color: "var(--text-muted)" }}
            >
              <BookOpen size={40} weight="light" />
              <p className="text-sm">Aucune vue de ce type</p>
              <Link href="/vues/nouvelle" className="text-sm underline" style={{ color: "var(--accent)" }}>
                Créer une vue
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((view) => (
                <ViewCard key={view.id} view={view} onDelete={!useFallback ? handleDelete : undefined} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
