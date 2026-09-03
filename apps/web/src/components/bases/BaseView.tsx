"use client";

/**
 * BaseView — orchestrates one Base (EntityType) view inline.
 *
 * Used both by the standalone page `/bases/:typeId` and the inline BlockNote
 * `databaseView` block. Renders, in order:
 *   1. ViewTabs (every saved view of the Base, with a "+" to add one)
 *   2. The active view's renderer (only `table` implemented in Phase 1;
 *      other kinds fall back to a placeholder).
 *
 * Auto-bootstraps the default view via `views.ensureDefault` on first mount
 * so a fresh Base always has something to display.
 */

import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import type { EntityType } from "@supernote/core";
import { Skeleton } from "@supernote/ui";
import {
  useEnsureDefaultView,
  useEntityMutations,
  useViewMutations,
  useViews,
} from "./hooks";
import { ViewTabs } from "./ViewTabs";
import { DataGrid } from "./DataGrid";
import { BaseToolbar } from "./BaseToolbar";
import { KanbanView } from "./KanbanView";
import { GalleryView } from "./GalleryView";
import { CalendarView } from "./CalendarView";
import { ListView } from "./ListView";
import { DetailView } from "./DetailView";
import { FormView } from "./FormView";
import { TimelineView } from "./TimelineView";

// recharts (~120 Ko gzip) ne doit charger que sur une vue graphique.
const ChartView = lazy(() =>
  import("./ChartView").then((m) => ({ default: m.ChartView }))
);

interface BaseViewProps {
  base: EntityType;
  /** Optional fixed view id (inline blocks pin to one view). */
  pinnedViewId?: string;
  /** Optional bounded height for embedding inside a note. */
  maxHeight?: string;
  /** Read-only base (e.g. a Coda mirror): no create/edit affordances. */
  readOnly?: boolean;
}

export function BaseView({ base, pinnedViewId, maxHeight, readOnly = false }: BaseViewProps) {
  useEnsureDefaultView(base.id);
  const { data: views = [], isLoading } = useViews(base.id);
  const { create: createView } = useViewMutations();
  const entityMut = useEntityMutations(base.id);

  const [selectedId, setSelectedId] = useState<string | undefined>(pinnedViewId);

  // Recherche instantanée (loupe de la toolbar). La valeur différée lisse la
  // frappe : l'input reste réactif, le filtrage des lignes suit juste après.
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Auto-select: when no view is selected yet, pick the first system view
  // (default) or the first available view. Pinned id wins if present.
  useEffect(() => {
    if (pinnedViewId) {
      setSelectedId(pinnedViewId);
      return;
    }
    if (!selectedId && views.length > 0) {
      const sys = views.find((v) => v.isSystem) ?? views[0];
      setSelectedId(sys?.id);
    }
  }, [pinnedViewId, views, selectedId]);

  const active = useMemo(
    () => views.find((v) => v.id === selectedId),
    [views, selectedId],
  );

  const handleCreateView = () => {
    createView.mutate(
      {
        typeId: base.id,
        name: `Nouvelle vue`,
        kind: "table",
      },
      {
        onSuccess: (v) => {
          if (v && typeof v === "object" && "id" in v) {
            setSelectedId((v as { id: string }).id);
          }
        },
      },
    );
  };

  if (isLoading) {
    // Squelette de la barre d'onglets pendant le chargement des vues, plutôt
    // qu'un « Chargement des vues… » texte centré (local-first, ressenti).
    return (
      <div className="flex h-full flex-col">
        <div
          className="flex items-center gap-2 border-b px-3 py-2"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-24" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {!pinnedViewId && (
        <ViewTabs
          views={views}
          activeViewId={selectedId}
          onSelect={setSelectedId}
          onCreate={handleCreateView}
        />
      )}
      {active && (
        <BaseToolbar
          base={base}
          view={active}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onCreateEntry={
            readOnly
              ? undefined
              : () => entityMut.create.mutate({ typeId: base.id, fields: {}, body: "" })
          }
        />
      )}
      <div className="flex-1 overflow-hidden">
        {active ? (
          <ViewRenderer
            base={base}
            view={active}
            maxHeight={maxHeight}
            readOnly={readOnly}
            searchQuery={deferredSearchQuery}
          />
        ) : (
          <div
            className="flex items-center justify-center py-8 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            Aucune vue. Création de la vue par défaut…
          </div>
        )}
      </div>
    </div>
  );
}

// ── ViewRenderer ──────────────────────────────────────────────────────────
//
// Polymorphic dispatch on view.kind. Kept inline because no other consumer
// ever wants a "render any view kind" entry point — the dispatcher is
// implementation detail of BaseView.

function ViewRenderer({
  base,
  view,
  maxHeight,
  readOnly = false,
  searchQuery,
}: {
  base: import("@supernote/core").EntityType;
  view: import("@supernote/ipc").View;
  maxHeight?: string;
  readOnly?: boolean;
  /** Recherche instantanée (déjà différée par BaseView). */
  searchQuery?: string;
}) {
  switch (view.kind) {
    case "table":
      return (
        <DataGrid
          base={base}
          view={view}
          maxHeight={maxHeight}
          readOnly={readOnly}
          searchQuery={searchQuery}
        />
      );
    case "board":
      return <KanbanView base={base} view={view} searchQuery={searchQuery} />;
    case "gallery":
      return <GalleryView base={base} view={view} searchQuery={searchQuery} />;
    case "calendar":
      return <CalendarView base={base} view={view} />;
    case "list":
      return <ListView base={base} view={view} searchQuery={searchQuery} />;
    case "detail":
      return <DetailView base={base} view={view} />;
    case "chart":
      return (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <ChartView base={base} view={view} />
        </Suspense>
      );
    case "form":
      return <FormView base={base} view={view} />;
    case "timeline":
      return <TimelineView base={base} view={view} />;
    default:
      return (
        <DataGrid
          base={base}
          view={view}
          maxHeight={maxHeight}
          readOnly={readOnly}
          searchQuery={searchQuery}
        />
      );
  }
}
