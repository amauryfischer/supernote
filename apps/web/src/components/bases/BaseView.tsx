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

import { useEffect, useMemo, useState } from "react";
import type { EntityType } from "@supernote/core";
import {
  useEnsureDefaultView,
  useEntityMutations,
  useViewMutations,
  useViews,
} from "./hooks";
import { ViewTabs } from "./ViewTabs";
import { DataGrid } from "./DataGrid";
import { BaseToolbar } from "./BaseToolbar";
import { VIEW_KIND_LABEL } from "./ViewKindIcon";

interface BaseViewProps {
  base: EntityType;
  /** Optional fixed view id (inline blocks pin to one view). */
  pinnedViewId?: string;
  /** Optional bounded height for embedding inside a note. */
  maxHeight?: string;
}

export function BaseView({ base, pinnedViewId, maxHeight }: BaseViewProps) {
  useEnsureDefaultView(base.id);
  const { data: views = [], isLoading } = useViews(base.id);
  const { create: createView } = useViewMutations();
  const entityMut = useEntityMutations(base.id);

  const [selectedId, setSelectedId] = useState<string | undefined>(pinnedViewId);

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
    return (
      <div
        className="flex items-center justify-center py-8 text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        Chargement des vues…
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
          onCreateEntry={() =>
            entityMut.create.mutate({ typeId: base.id, fields: {}, body: "" })
          }
        />
      )}
      <div className="flex-1 overflow-hidden">
        {active ? (
          active.kind === "table" ? (
            <DataGrid base={base} view={active} maxHeight={maxHeight} />
          ) : (
            <div
              className="flex h-full items-center justify-center px-4 py-12 text-center text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              La vue « {VIEW_KIND_LABEL[active.kind] ?? active.kind} » sera disponible bientôt.
              <br />
              Bascule sur une vue Tableau en attendant.
            </div>
          )
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
