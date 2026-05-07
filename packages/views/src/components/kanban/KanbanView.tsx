import React, { useMemo } from "react";
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import type { Entity, EntityType, SelectField, StatusField } from "@supernote/core/types";
import type { ViewProps } from "../../types/index.js";
import { queryEntities } from "../../query/index.js";
import { formatFieldValue, getEntityLabel } from "../../utils/field.js";

interface KanbanColumn {
  key: string;
  label: string;
  color?: string;
  entities: Entity[];
}

function getColumns(schema: EntityType, groupBy: string, entities: Entity[]): KanbanColumn[] {
  const field = schema.fields.find((f) => f.id === groupBy);
  let options: Array<{ value: string; label: string; color?: string }> = [];

  if (field && (field.kind === "select" || field.kind === "status")) {
    options = (field as SelectField | StatusField).options.map((o) => ({
      value: o.value,
      label: o.label,
      color: o.color,
    }));
  }

  const grouped = new Map<string, Entity[]>();
  for (const e of entities) {
    const val = e.fields[groupBy];
    const key = val != null ? String(val) : "__ungrouped__";
    const arr = grouped.get(key) ?? [];
    arr.push(e);
    grouped.set(key, arr);
  }

  const columns: KanbanColumn[] = options.map((opt) => ({
    key: opt.value,
    label: opt.label,
    color: opt.color,
    entities: grouped.get(opt.value) ?? [],
  }));

  const ungrouped = grouped.get("__ungrouped__");
  if (ungrouped && ungrouped.length > 0) {
    columns.push({ key: "__ungrouped__", label: "Ungrouped", entities: ungrouped });
  }

  if (columns.length === 0) {
    for (const [key, ents] of grouped.entries()) {
      columns.push({ key, label: key, entities: ents });
    }
  }

  return columns;
}

export function KanbanView<T extends Entity = Entity>({
  view,
  entities,
  schema,
  onEntityClick,
  onEntityChange,
  onEntityCreate,
}: ViewProps<T>): React.JSX.Element {
  const groupBy = view.groupBy ?? schema.fields.find(
    (f) => f.kind === "select" || f.kind === "status"
  )?.id ?? "";

  const processed = useMemo(
    () => queryEntities(entities, view.filters ?? [], view.sort ?? []),
    [entities, view.filters, view.sort]
  );

  const columns = useMemo(
    () => getColumns(schema, groupBy, processed),
    [schema, groupBy, processed]
  );

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const draggedId = String(active.id);
    const targetColumnKey = String(over.id);

    const entity = entities.find((e) => e.id === draggedId);
    if (!entity || !groupBy || !onEntityChange) return;

    const updated = {
      ...entity,
      fields: { ...entity.fields, [groupBy]: targetColumnKey },
    } as T;
    onEntityChange(updated);
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div
        data-testid="kanban-view"
        style={{ display: "flex", gap: 16, overflowX: "auto", padding: 16, height: "100%" }}
      >
        {columns.map((col) => (
          <KanbanColumn
            key={col.key}
            column={col}
            schema={schema}
            onEntityClick={onEntityClick as ((e: Entity) => void) | undefined}
            onEntityCreate={onEntityCreate}
          />
        ))}
      </div>
    </DndContext>
  );
}

interface KanbanColumnProps {
  column: KanbanColumn;
  schema: EntityType;
  onEntityClick?: (e: Entity) => void;
  onEntityCreate?: (groupKey?: string) => void;
}

function KanbanColumn({ column, schema, onEntityClick, onEntityCreate }: KanbanColumnProps): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });

  return (
    <div
      ref={setNodeRef}
      data-testid={`kanban-column-${column.key}`}
      style={{
        minWidth: 280,
        background: isOver ? "#f0f9ff" : "#f8fafc",
        borderRadius: 8,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        border: `2px solid ${isOver ? "#3b82f6" : "#e2e8f0"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        {column.color && (
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: column.color }} />
        )}
        <strong>{column.label}</strong>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#64748b" }}>
          {column.entities.length}
        </span>
      </div>
      {column.entities.map((entity) => (
        <KanbanCard
          key={entity.id}
          entity={entity}
          schema={schema}
          onClick={onEntityClick}
        />
      ))}
      {onEntityCreate && (
        <button
          style={{ marginTop: 4, width: "100%", padding: "6px 0", background: "transparent", border: "1px dashed #cbd5e1", borderRadius: 6, cursor: "pointer", color: "#64748b" }}
          onClick={() => onEntityCreate(column.key)}
          aria-label={`Add card to ${column.label}`}
        >
          + Add card
        </button>
      )}
    </div>
  );
}

interface KanbanCardProps {
  entity: Entity;
  schema: EntityType;
  onClick?: (e: Entity) => void;
}

function KanbanCard({ entity, schema, onClick }: KanbanCardProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: entity.id });
  const label = getEntityLabel(entity, schema);

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      data-testid="kanban-card"
      onClick={() => onClick?.(entity)}
      style={{
        background: "#fff",
        borderRadius: 6,
        padding: "10px 12px",
        boxShadow: isDragging ? "0 8px 24px rgba(0,0,0,0.15)" : "0 1px 3px rgba(0,0,0,0.08)",
        cursor: isDragging ? "grabbing" : "grab",
        opacity: isDragging ? 0.5 : 1,
        userSelect: "none",
      }}
    >
      <div style={{ fontWeight: 500, fontSize: 14 }}>{label}</div>
      {schema.fields.slice(1, 3).map((f) => {
        const val = entity.fields[f.id];
        if (val == null) return null;
        return (
          <div key={f.id} style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
            {f.label}: {formatFieldValue(val)}
          </div>
        );
      })}
    </div>
  );
}
