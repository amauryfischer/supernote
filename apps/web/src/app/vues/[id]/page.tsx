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
import type { FilterClause, SortClause, ViewKind } from "@supernote/views";
import type { Field } from "@supernote/core";
import { ViewRenderer } from "@supernote/views";

type ToolbarTab = "filtres" | "tris" | "grouper";

export default function VueEditPage() {
  const params = useParams();
  const router = useRouter();
  const viewId = params.id as string;

  const original = SAVED_VIEWS.find((v) => v.id === viewId);

  const [name, setName] = useState(original?.name ?? "Vue sans titre");
  const [isEditingName, setIsEditingName] = useState(false);
  const [kind, setKind] = useState<ViewKind>(original?.kind ?? "table");
  const [filters, setFilters] = useState<FilterClause[]>(
    (original?.filters ?? []).map((f) => ({ ...f }))
  );
  const [sort, setSort] = useState<SortClause[]>(
    (original?.sort ?? []).map((s) => ({ ...s }))
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
    [original, viewId, name, kind, filters, sort, groupBy]
  );

  const handleSave = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, []);

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "Escape") setIsEditingName(false);
  };

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
                className="flex items-center gap-1.5 group"
                onClick={() => setIsEditingName(true)}
                aria-label="Renommer la vue"
              >
                <span
                  className="text-sm font-semibold"
                  style={{ color: "var(--text-primary)" }}
                >
                  {name}
                </span>
                <PencilSimple
                  size={13}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: "var(--text-muted)" }}
                />
              </button>
            )}

            <span
              className="rounded-full border px-2 py-0.5 text-xs"
              style={{
                borderColor: "var(--border-subtle)",
                color: "var(--text-muted)",
              }}
            >
              {entityLabel}
            </span>
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
            {saved ? "Enregistre" : "Enregistrer"}
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
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--surface-0)",
            }}
          >
            {activeTab === "filtres" && (
              <FilterBuilder
                filters={filters}
                schema={MOCK_SCHEMA}
                onChange={setFilters}
              />
            )}
            {activeTab === "tris" && (
              <SortBuilder
                sort={sort}
                schema={MOCK_SCHEMA}
                onChange={setSort}
              />
            )}
            {activeTab === "grouper" && (
              <div className="flex items-center gap-2">
                <label
                  className="text-xs font-medium"
                  style={{ color: "var(--text-secondary)" }}
                >
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
                  {MOCK_SCHEMA.fields.map((f: Field) => (
                    <option key={f.id} value={f.id}>{f.label}</option>
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
            Apercu
          </p>
          <div
            className="rounded-xl border overflow-hidden"
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--surface-1)",
              minHeight: 300,
            }}
          >
            <ViewRenderer
              view={currentView}
              entities={MOCK_ENTITIES}
              schema={MOCK_SCHEMA}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
