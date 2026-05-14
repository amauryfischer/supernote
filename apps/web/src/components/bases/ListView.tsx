"use client";

/**
 * ListView — compact vertical list with optional grouping.
 *
 * When `groupByField` is a `select` / `status`, entries are bucketed by
 * value with collapsible section headers. Otherwise, a single flat list.
 * Each row shows the entity's title plus its visible secondary fields
 * formatted by Cell (same shape as Kanban/Gallery cards but laid out
 * horizontally with less chrome).
 */

import { useMemo, useState } from "react";
import { Button } from "@heroui/react";
import { CaretDown, CaretRight, Plus } from "@phosphor-icons/react";
import type { EntityType, SelectOption } from "@supernote/core";
import type { View } from "@supernote/ipc";
import {
  useEntitiesForView,
  useEntityMutations,
  resolveVisibleFieldIds,
} from "./hooks";
import { resolveGroupByField } from "./entity-summary";
import { EntityCard } from "./EntityCard";

interface ListViewProps {
  base: EntityType;
  view: View;
}

const NULL_BUCKET = "__null__";

export function ListView({ base, view }: ListViewProps) {
  const groupField = resolveGroupByField(base, view.groupByField);
  const { data, isLoading } = useEntitiesForView(base.id, view.filters, view.sorts);
  const mut = useEntityMutations(base.id);
  const items = data?.items ?? [];

  const visibleFieldIds = useMemo(
    () => resolveVisibleFieldIds(view, base.fields.map((f) => f.id)),
    [view, base.fields],
  );

  const grouped = useMemo(() => {
    if (!groupField) {
      // Single virtual bucket "Toutes".
      return [{ key: "all", label: "Toutes les entrées", color: undefined, items }];
    }
    const options = ((groupField as { options?: SelectOption[] }).options ?? []) as SelectOption[];
    const byKey = new Map<string, typeof items>();
    byKey.set(NULL_BUCKET, []);
    for (const opt of options) byKey.set(opt.value, []);
    for (const item of items) {
      const raw = item.fields[groupField.id];
      const key = raw === null || raw === undefined || raw === ""
        ? NULL_BUCKET
        : String(raw);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(item);
    }
    const sections = [
      {
        key: NULL_BUCKET,
        label: "Sans valeur",
        color: undefined as string | undefined,
        items: byKey.get(NULL_BUCKET) ?? [],
      },
      ...options.map((opt) => ({
        key: opt.value,
        label: opt.label,
        color: opt.color,
        items: byKey.get(opt.value) ?? [],
      })),
    ];
    return sections;
  }, [groupField, items]);

  const addEntry = (bucketValue?: string) => {
    const fields = groupField && bucketValue && bucketValue !== NULL_BUCKET
      ? { [groupField.id]: bucketValue }
      : {};
    mut.create.mutate({ typeId: base.id, fields, body: "" });
  };

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ backgroundColor: "var(--surface-0)" }}
    >
      {isLoading && (
        <p className="px-4 py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          Chargement…
        </p>
      )}
      {!isLoading && items.length === 0 && (
        <p className="px-4 py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>
          Aucune entrée.
        </p>
      )}
      <div className="flex flex-col gap-2 p-3">
        {grouped.map((section) => (
          <ListSection
            key={section.key}
            label={section.label}
            color={section.color}
            count={section.items.length}
            onAdd={groupField ? () => addEntry(section.key) : undefined}
          >
            {section.items.map((entity) => (
              <EntityCard
                key={entity.id}
                base={base}
                entity={entity}
                visibleFieldIds={visibleFieldIds}
                compact
              />
            ))}
          </ListSection>
        ))}
        {!groupField && (
          <Button
            variant="ghost"
            size="sm"
            onPress={() => addEntry()}
            className="flex items-center gap-1.5 self-start rounded px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-secondary)" }}
          >
            <Plus size={11} /> Nouvelle entrée
          </Button>
        )}
      </div>
    </div>
  );
}

// ── ListSection ──────────────────────────────────────────────────────────

interface ListSectionProps {
  label: string;
  color?: string;
  count: number;
  onAdd?: () => void;
  children: React.ReactNode;
}

function ListSection({ label, color, count, onAdd, children }: ListSectionProps) {
  const [open, setOpen] = useState(true);
  const accent = color ?? "#64748B";
  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-[var(--surface-2)]"
        style={{ cursor: "pointer" }}
      >
        <Button
          variant="ghost"
          size="sm"
          onPress={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
          style={{ color: "var(--text-secondary)" }}
        >
          {open ? <CaretDown size={11} /> : <CaretRight size={11} />}
          <span
            className="inline-block size-2 rounded-full"
            style={{ backgroundColor: accent }}
          />
          <span className="text-xs font-semibold">{label}</span>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {count}
          </span>
        </Button>
        {onAdd && (
          <Button
            variant="ghost"
            size="sm"
            onPress={onAdd}
            className="rounded p-0.5 hover:bg-[var(--surface-3)]"
            style={{ color: "var(--text-muted)" }}
            aria-label="Ajouter dans cette section"
          >
            <Plus size={11} />
          </Button>
        )}
      </div>
      {open && (
        <div className="ml-4 mt-1 flex flex-col gap-1">{children}</div>
      )}
    </div>
  );
}
