"use client";

/**
 * GalleryView — responsive card grid for a Base.
 *
 * Auto-sized columns via CSS grid `auto-fill`: cards reflow as the viewport
 * narrows. Cover images come from the first `image` field of the schema.
 * Clicking a card has no specific destination in Phase 1 — Phase 4 will wire
 * an entity drawer; for now the card is informational.
 */

import { useMemo } from "react";
import { Button } from "@heroui/react";
import { Plus } from "@phosphor-icons/react";
import type { EntityType } from "@supernote/core";
import type { View } from "@supernote/ipc";
import {
  useEntitiesForView,
  useEntityMutations,
  resolveVisibleFieldIds,
} from "./hooks";
import { EntityCard } from "./EntityCard";

interface GalleryViewProps {
  base: EntityType;
  view: View;
}

export function GalleryView({ base, view }: GalleryViewProps) {
  const { data, isLoading } = useEntitiesForView(base.id, view.filters, view.sorts);
  const mut = useEntityMutations(base.id);
  const items = data?.items ?? [];

  const visibleFieldIds = useMemo(
    () => resolveVisibleFieldIds(view, base.fields.map((f) => f.id)),
    [view, base.fields],
  );

  return (
    <div
      className="h-full overflow-y-auto p-4"
      style={{ backgroundColor: "var(--surface-0)" }}
    >
      {isLoading ? (
        <p className="text-center text-xs" style={{ color: "var(--text-muted)" }}>
          Chargement…
        </p>
      ) : items.length === 0 ? (
        <p className="text-center text-xs" style={{ color: "var(--text-muted)" }}>
          Aucune entrée. Ajoute-en une depuis la barre d'outils.
        </p>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
        >
          {items.map((entity) => (
            <EntityCard
              key={entity.id}
              base={base}
              entity={entity}
              visibleFieldIds={visibleFieldIds}
            />
          ))}
          <Button
            variant="ghost"
            onPress={() => mut.create.mutate({ typeId: base.id, fields: {}, body: "" })}
            className="flex min-h-[140px] items-center justify-center rounded-md border-2 border-dashed text-xs font-medium hover:bg-[var(--surface-1)]"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-muted)",
            }}
          >
            <Plus size={12} /> Nouvelle entrée
          </Button>
        </div>
      )}
    </div>
  );
}
