"use client";

/**
 * KanbanView — Notion/Trello-style board grouped by a select/status field.
 *
 * Columns come from the field's options + a leading "Sans valeur" bucket for
 * entries whose field is empty. Cards drag between columns: dropping rewrites
 * `fields[groupByField]` for the dropped entity.
 *
 * Falls back to a config prompt when the view's `groupByField` isn't set and
 * no select/status field exists on the schema.
 */

import { useMemo, useState } from "react";
import { Button, Popover } from "@heroui/react";
import { ArrowsLeftRight } from "@phosphor-icons/react";
import { EmptyState, Tooltip } from "@supernote/ui";
import type { EntityType, SelectOption } from "@supernote/core";
import type { View } from "@supernote/ipc";
import {
  useEntitiesForView,
  useEntityMutations,
  resolveVisibleFieldIds,
  useSearchFilter,
} from "./hooks";
import { resolveGroupByField } from "./entity-summary";
import { EntityCard } from "./EntityCard";
import { EntityCardSkeleton } from "./BasesSkeleton";

interface KanbanViewProps {
  base: EntityType;
  view: View;
  /** Recherche instantanée (toolbar) — filtre client-side sur les champs visibles. */
  searchQuery?: string;
}

const NULL_BUCKET = "__null__";

export function KanbanView({ base, view, searchQuery }: KanbanViewProps) {
  const groupField = resolveGroupByField(base, view.groupByField);
  const { data, isLoading } = useEntitiesForView(base.id, view.filters, view.sorts);
  const mut = useEntityMutations(base.id);
  const [dragging, setDragging] = useState<string | null>(null);
  // Recherche instantanée — avant l'early return pour un ordre de hooks stable.
  const allItems = useMemo(() => data?.items ?? [], [data?.items]);
  const items = useSearchFilter(allItems, base, view, searchQuery);

  // The field's options drive the columns. Status and select fields both
  // expose `options: SelectOption[]`.
  const options = useMemo(
    () => ((groupField as { options?: SelectOption[] } | null)?.options ?? []) as SelectOption[],
    [groupField],
  );
  const groupFieldId = groupField?.id;

  // Bucket entries by the group field's value. Anything unset (null/empty
  // string) lands in the leading "Sans valeur" bucket so it stays
  // actionable rather than disappearing.
  const buckets = useMemo(() => {
    const byKey = new Map<string, typeof items>();
    byKey.set(NULL_BUCKET, []);
    for (const opt of options) byKey.set(opt.value, []);
    if (!groupFieldId) return byKey;
    for (const item of items) {
      const raw = item.fields[groupFieldId];
      const key = raw === null || raw === undefined || raw === "" ? NULL_BUCKET : String(raw);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(item);
    }
    return byKey;
  }, [items, options, groupFieldId]);

  const visibleFieldIds = useMemo(
    () => resolveVisibleFieldIds(view, base.fields.map((f) => f.id)),
    [view, base.fields],
  );

  if (!groupField) {
    return <KanbanEmptyState />;
  }

  // Au doigt, le glisser-déposer HTML5 n'existe pas : chaque carte offre
  // « Déplacer vers… » (révélé au survol sur desktop, permanent au tactile).
  const moveTargets = [
    { value: NULL_BUCKET, label: "Sans valeur", color: "#94A3B8" },
    ...options.map((o) => ({ value: o.value, label: o.label, color: o.color })),
  ];
  const renderCard = (entity: (typeof items)[number], bucket: string) => (
    <EntityCard
      key={entity.id}
      base={base}
      entity={entity}
      visibleFieldIds={visibleFieldIds}
      onDragStart={(id) => setDragging(id)}
      onDragEnd={() => setDragging(null)}
      actions={
        mut.readOnly ? undefined : (
          <MoveToPicker
            targets={moveTargets}
            current={bucket}
            onMove={(value) => handleDrop(value, entity.id)}
          />
        )
      }
    />
  );

  const handleDrop = (toValue: string, entityId: string) => {
    setDragging(null);
    if (!entityId) return;
    const entity = items.find((e) => e.id === entityId);
    if (!entity) return;
    const currentValue = entity.fields[groupField.id];
    const newValue = toValue === NULL_BUCKET ? null : toValue;
    if (currentValue === newValue) return;
    mut.update.mutate({
      id: entityId,
      fields: { [groupField.id]: newValue as never },
    });
  };

  const addCardTo = (value: string) => {
    mut.create.mutate({
      typeId: base.id,
      fields: value === NULL_BUCKET ? {} : { [groupField.id]: value },
      body: "",
    });
  };

  return (
    <div
      className="flex h-full gap-3 overflow-x-auto p-3"
      style={{ backgroundColor: "var(--surface-0)" }}
    >
      <KanbanColumn
        title="Sans valeur"
        color="#94A3B8"
        count={buckets.get(NULL_BUCKET)?.length ?? 0}
        onDrop={(id) => handleDrop(NULL_BUCKET, id)}
        onAdd={() => addCardTo(NULL_BUCKET)}
        dragging={!!dragging}
      >
        {(buckets.get(NULL_BUCKET) ?? []).map((entity) => renderCard(entity, NULL_BUCKET))}
      </KanbanColumn>

      {options.map((opt) => (
        <KanbanColumn
          key={opt.value}
          title={opt.label}
          color={opt.color}
          count={buckets.get(opt.value)?.length ?? 0}
          onDrop={(id) => handleDrop(opt.value, id)}
          onAdd={() => addCardTo(opt.value)}
          dragging={!!dragging}
        >
          {(buckets.get(opt.value) ?? []).map((entity) => renderCard(entity, opt.value))}
        </KanbanColumn>
      ))}

      {isLoading && (
        <div className="flex w-64 shrink-0 flex-col gap-2 self-start">
          {Array.from({ length: 3 }, (_, i) => (
            <EntityCardSkeleton key={i} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Déplacer vers… ───────────────────────────────────────────────────────

function MoveToPicker({
  targets,
  current,
  onMove,
}: {
  targets: Array<{ value: string; label: string; color?: string }>;
  current: string;
  onMove: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Tooltip content="Déplacer vers…">
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          aria-label="Déplacer vers…"
          className="sn-reveal sn-hit h-6 w-6 min-w-0 rounded-md"
          style={{ color: "var(--text-muted)" }}
        >
          <ArrowsLeftRight size={13} aria-hidden />
        </Button>
      </Tooltip>
      <Popover.Content className="w-56 p-1">
        <Popover.Dialog className="outline-none" aria-label="Déplacer vers">
          <p className="px-2 pb-1 pt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
            Déplacer vers…
          </p>
          <div className="flex flex-col">
            {targets.map((t) => (
              <Button
                key={t.value}
                variant="ghost"
                size="sm"
                isDisabled={t.value === current}
                onPress={() => {
                  setOpen(false);
                  onMove(t.value);
                }}
                className="sn-hit h-8 w-full justify-start gap-2 rounded-md px-2 text-left text-xs"
                style={{ color: "var(--text-primary)" }}
              >
                <span
                  className="inline-block size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: t.color ?? "#64748B" }}
                  aria-hidden
                />
                <span className="truncate">{t.label}</span>
              </Button>
            ))}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

// ── Column ───────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  title: string;
  color?: string;
  count: number;
  dragging: boolean;
  onDrop: (entityId: string) => void;
  onAdd: () => void;
  children: React.ReactNode;
}

function KanbanColumn({
  title,
  color,
  count,
  dragging,
  onDrop,
  onAdd,
  children,
}: KanbanColumnProps) {
  const [over, setOver] = useState(false);
  const accent = color ?? "#64748B";

  return (
    <div
      className="flex h-full w-72 shrink-0 flex-col rounded-md"
      style={{
        backgroundColor: "var(--surface-1)",
        border: `1px solid ${over ? accent : "var(--border-subtle)"}`,
        transition: "var(--sn-transition-colors)",
      }}
      onDragOver={(e) => {
        if (!dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (!over) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/plain");
        if (id) onDrop(id);
      }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-block size-2 shrink-0 rounded-full"
            style={{ backgroundColor: accent }}
          />
          <span
            className="truncate text-xs font-semibold"
            style={{ color: "var(--text-primary)" }}
            title={title}
          >
            {title}
          </span>
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            {count}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onPress={onAdd}
          className="rounded p-0.5 hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-muted)" }}
          aria-label="Ajouter une entrée"
        >
          <span aria-hidden="true">+</span>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────

function KanbanEmptyState() {
  // EmptyState partagé — même traitement dans les 4 vues bases
  return (
    <div className="flex h-full items-center justify-center">
      <EmptyState
        title="Le Kanban a besoin d'un champ de regroupement"
        description="Ajoute un champ select ou status au schéma de la Base, puis configure « Grouper par » dans la barre d'outils."
      />
    </div>
  );
}
