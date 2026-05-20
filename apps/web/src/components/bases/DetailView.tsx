"use client";

/**
 * DetailView — vue "fiche" : une carte par entité avec tous les champs visibles
 * en pleine largeur, libellé à gauche, éditeur Cell à droite. Pendant
 * Coda/Notion "Detail view".
 *
 * Édition inline : on réutilise `<Cell>` directement (déjà câblé sur
 * `entities.update`), donc les modifs sont commit immédiatement et invalident
 * la query partagée avec le DataGrid.
 */

import { useMemo, useState } from "react";
import { Button } from "@heroui/react";
import { CaretDown, CaretRight, Trash } from "@phosphor-icons/react";
import type { EntityType, Field } from "@supernote/core";
import type { View } from "@supernote/ipc";
import { Cell } from "./Cell";
import {
  useEntitiesForView,
  useEntityMutations,
  resolveVisibleFieldIds,
} from "./hooks";

interface DetailViewProps {
  base: EntityType;
  view: View;
}

export function DetailView({ base, view }: DetailViewProps) {
  const allIds = useMemo(() => base.fields.map((f) => f.id), [base.fields]);
  const visibleIds = useMemo(
    () => resolveVisibleFieldIds(view, allIds),
    [view, allIds],
  );
  const fieldById = useMemo(() => {
    const m = new Map<string, Field>();
    for (const f of base.fields) m.set(f.id, f);
    return m;
  }, [base.fields]);

  const { data, isLoading } = useEntitiesForView(base.id, view.filters, view.sorts);
  const mut = useEntityMutations(base.id);
  const items = data?.items ?? [];

  // Ouvert/fermé par entityId. Par défaut tout est ouvert (≤ 50 lignes) sinon
  // tout fermé pour éviter une page géante au montage.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 text-xs" style={{ color: "var(--text-muted)" }}>
        Chargement…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-6 text-xs" style={{ color: "var(--text-muted)" }}>
        Aucune entrée. Utilisez « + Nouvelle entrée » pour en créer une.
      </div>
    );
  }

  const primaryFieldId = visibleIds[0];

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4">
      {items.map((entity) => {
        const isCollapsed = collapsed.has(entity.id);
        const title =
          (primaryFieldId && (entity.fields?.[primaryFieldId] as string)) ||
          "(sans titre)";
        return (
          <div
            key={entity.id}
            className="rounded-lg border"
            style={{
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--surface-1)",
            }}
          >
            {/* Header carte */}
            <div
              className="flex items-center gap-2 border-b px-3 py-2"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => toggle(entity.id)}
                aria-label={isCollapsed ? "Déplier" : "Replier"}
              >
                {isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
              </Button>
              <span
                className="flex-1 truncate text-sm font-medium"
                style={{ color: "var(--text-primary)" }}
              >
                {title}
              </span>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => mut.delete.mutate({ id: entity.id })}
                aria-label="Supprimer"
                style={{ color: "var(--text-muted)" }}
              >
                <Trash size={13} />
              </Button>
            </div>

            {/* Champs (collapsibles) */}
            {!isCollapsed && (
              <div className="flex flex-col gap-2 px-3 py-3">
                {visibleIds.map((fid) => {
                  const field = fieldById.get(fid);
                  if (!field) return null;
                  return (
                    <div key={fid} className="grid grid-cols-[140px_1fr] gap-3">
                      <span
                        className="pt-1.5 text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {field.label || field.name}
                      </span>
                      <div className="min-w-0">
                        <Cell
                          field={field}
                          value={entity.fields?.[fid]}
                          onChange={(next) => {
                            mut.update.mutate({
                              id: entity.id,
                              fields: { [fid]: next as never },
                            });
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
