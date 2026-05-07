"use client";

import { useState, useMemo, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  FloppyDisk,
  Funnel,
  SortAscending,
  SquaresFour,
  PencilSimple,
  Check,
} from "@phosphor-icons/react";
import { AppShell } from "@/components/shell";
import {
  FilterBuilder,
  SortBuilder,
  ViewKindPicker,
  SAVED_VIEWS,
  MOCK_SCHEMA,
  MOCK_ENTITIES,
  ENTITY_TYPES,
} from "@/components/views";
import type { SavedView } from "@/components/views";
import { trpc } from "@/lib/trpc/client";
import type { FilterClause, SortClause, ViewKind } from "@supernote/views";
import { ViewRenderer } from "@supernote/views";
import type { View, SaveViewInput } from "@supernote/ipc";

// ── IPC adapters ──────────────────────────────────────────────────────────

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
      operator: f.operator as FilterClause["operator"],
      value: f.value as FilterClause["value"],
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

function savedViewToSaveInput(v: SavedView): SaveViewInput {
  return {
    id: v.id,
    name: v.name,
    type: v.kind as SaveViewInput["type"],
    typeId: v.entityTypeId,
    config: {
      filters: (v.filters ?? []).map((f) => ({
        field: f.fieldId,
        operator: f.operator as import("@supernote/ipc").FilterCondition["operator"],
        value: f.value,
      })),
      sorts: (v.sort ?? []).map((s) => ({ field: s.fieldId, direction: s.direction })),
      groupBy: v.groupBy,
      columns: v.columns?.map((c) => c.fieldId),
    },
  };
}

// ── Loading skeleton ──────────────────────────────────────────────────────

function VueEditSkeleton() {
  return (
    <div className="flex h-full flex-col animate-pulse">
      <div
        className="flex items-center justify-between border-b px-4 py-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="h-4 w-40 rounded" style={{ backgroundColor: "var(--surface-3)" }} />
        <div className="h-7 w-28 rounded-md" style={{ backgroundColor: "var(--surface-3)" }} />
      </div>
      <div className="flex-1 px-4 py-4">
        <div className="h-64 rounded-xl" style={{ backgroundColor: "var(--surface-1)" }} />
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

type ToolbarTab = "filtres" | "tris" | "grouper";

export default function VueEditPage() {
  const params = useParams();
  const router = useRouter();
  const viewId = params.id as string;

  const getQuery = trpc.views.get.useQuery({ id: viewId }, { retry: false });
  const saveMutation = trpc.views.save.useMutation({
    onSuccess: () => setSaved(true),
    onError: (err) => console.error("views.save error", err),
  });

  const useFallback = getQuery.isError;
  const original: SavedView | null = useFallback
    ? (SAVED_VIEWS.find((v) => v.id === viewId) ?? null)
    : getQuery.data
    ? viewFromIpc(getQuery.data)
    : null;

  const [name, setName] = useState(original?.name ?? "Vue sans titre");
  const [isEditingName, setIsEditingName] = useState(false);
  const [kind, setKind] = useState<ViewKind>(original?.kind ?? "table");
  const [filters, setFilters] = useState<FilterClause[]>(
    (original?.filters ?? []).map((f) => ({ ...f })),
  );
  const [sort, setSort] = useState<SortClause[]>(
    (original?.sort ?? []).map((s) => ({ ...s })),
  );
  const [groupBy, setGroupBy] = useState<string | undefined>(original?.groupBy);
  const [activeTab, setActiveTab] = useState<ToolbarTab | null>(null);
  const [saved, setSaved] = useState(false);

  const currentView = useMemo<SavedView>(
    () => ({
      ...(original ?? {
        id: viewId,
        entityTypeId: "contact",
        resultCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cardConfig: undefined,
        dateField: undefined,
        endDateField: undefined,
        graphConfig: undefined,
        columns: undefined,
      }),
      name,
      kind,
      filters,
      sort,
      groupBy,
    }),
    [original, viewId, name, kind, filters, sort, groupBy],
  );

  const handleSave = useCallback(() => {
    setSaved(false);
    if (useFallback) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      return;
    }
    saveMutation.mutate(savedViewToSaveInput(currentView));
    setTimeout(() => setSaved(false), 2000);
  }, [useFallback, saveMutation, currentView]);

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Escape") setIsEditingName(false);
  };

  if (getQuery.isLoading) {
    return (
      <AppShell>
        <VueEditSkeleton />
      </AppShell>
    );
  }

  if (!original) {
    return (
      <AppShell>
        <div className="flex h-full flex-col items-center justify-center gap-4">
          <p style={{ color: "var(--text-secondary)" }}>Vue introuvable.</p>
          <button
            onClick={() => router.push("/vues")}
            className="text-sm underline"
            style={{ color: "var(--accent)" }}
          >
            Retour aux vues
          </button>
        </div>
      </AppShell>
    );
  }

  const entityLabel = ENTITY_TYPES[original.entityTypeId] ?? original.entityTypeId;

  return (
    <AppShell>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-2"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/vues")}
              className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:opacity-70"
              style={{ color: "var(--text-muted)" }}
              aria-label="Retour"
            >
              <ArrowLeft size={16} />
            </button>

            {isEditingName ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  className="rounded border px-2 py-1 text-sm font-semibold"
                  style={{
                    borderColor: "var(--accent)",
                    backgroundColor: "var(--surface-1)",
                    color: "var(--text-primary)",
                    minWidth: 200,
                  }}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setIsEditingName(false)}
                  onKeyDown={handleNameKeyDown}
                />
                <button onClick={() => setIsEditingName(false)}>
                  <Check size={14} style={{ color: "var(--accent)" }} />
                </button>
              </div>
            ) : (
              <button
                className="group flex items-center gap-1.5"
                onClick={() => setIsEditingName(true)}
                aria-label="Renommer la vue"
              >
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {name}
                </span>
                <PencilSimple
                  size={13}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ color: "var(--text-muted)" }}
                />
              </button>
            )}

            <span
              className="rounded-full border px-2 py-0.5 text-xs"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
            >
              {entityLabel}
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

          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all"
            style={{
              backgroundColor: saved ? "#22c55e" : "var(--accent)",
              color: "white",
            }}
          >
            <FloppyDisk size={14} />
            {saved ? "Enregistré" : "Enregistrer"}
          </button>
        </div>

        {/* Toolbar */}
        <div
          className="flex items-start gap-4 border-b px-4 py-2"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
        >
          <ViewKindPicker value={kind} onChange={setKind} />

          <div className="flex items-center gap-1">
            {(["filtres", "tris", "grouper"] as ToolbarTab[]).map((tab) => {
              const icons: Record<ToolbarTab, React.ReactNode> = {
                filtres: <Funnel size={13} />,
                tris: <SortAscending size={13} />,
                grouper: <SquaresFour size={13} />,
              };
              const labels: Record<ToolbarTab, string> = {
                filtres: `Filtres${filters.length > 0 ? ` (${filters.length})` : ""}`,
                tris: `Tris${sort.length > 0 ? ` (${sort.length})` : ""}`,
                grouper: "Grouper",
              };
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(isActive ? null : tab)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all"
                  style={{
                    backgroundColor: isActive ? "var(--accent-subtle)" : "transparent",
                    color: isActive ? "var(--accent)" : "var(--text-secondary)",
                  }}
                >
                  {icons[tab]}
                  {labels[tab]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Expandable panel */}
        {activeTab !== null && (
          <div
            className="border-b px-4 py-3"
            style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
          >
            {activeTab === "filtres" && (
              <FilterBuilder filters={filters} schema={MOCK_SCHEMA} onChange={setFilters} />
            )}
            {activeTab === "tris" && (
              <SortBuilder sort={sort} schema={MOCK_SCHEMA} onChange={setSort} />
            )}
            {activeTab === "grouper" && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                  Grouper par :
                </label>
                <select
                  className="rounded-md border px-2 py-1 text-sm"
                  style={{
                    borderColor: "var(--border-subtle)",
                    backgroundColor: "var(--surface-1)",
                    color: "var(--text-primary)",
                  }}
                  value={groupBy ?? ""}
                  onChange={(e) => setGroupBy(e.target.value || undefined)}
                >
                  <option value="">Aucun</option>
                  {MOCK_SCHEMA.fields.map((f: { id: string; label: string }) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Live preview */}
        <div className="flex-1 overflow-auto px-4 py-4">
          <p
            className="mb-2 text-xs font-medium uppercase tracking-wide"
            style={{ color: "var(--text-muted)" }}
          >
            Aperçu
          </p>
          <div
            className="overflow-hidden rounded-xl border"
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--surface-1)",
              minHeight: 300,
            }}
          >
            <ViewRenderer view={currentView} entities={MOCK_ENTITIES} schema={MOCK_SCHEMA} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
