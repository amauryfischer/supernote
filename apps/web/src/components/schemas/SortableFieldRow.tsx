"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Edit2, Trash2 } from "lucide-react";
import type { Field } from "@supernote/core";
import { FieldKindBadge } from "./FieldKindBadge";

interface SortableFieldRowProps {
  field: Field;
  onEdit: () => void;
  onDelete: () => void;
}

export function SortableFieldRow({ field, onEdit, onDelete }: SortableFieldRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
      {...attributes}
    >
      <button
        {...listeners}
        className="cursor-grab rounded p-0.5 hover:bg-[var(--surface-2)] active:cursor-grabbing"
      >
        <GripVertical size={14} style={{ color: "var(--text-muted)" }} />
      </button>
      <FieldKindBadge kind={field.kind} />
      <span className="flex-1 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
        {field.label}
      </span>
      <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>
        {field.name}
      </span>
      {field.required && (
        <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-600">
          requis
        </span>
      )}
      <div className="flex items-center gap-1">
        <button
          onClick={onEdit}
          className="rounded p-1 hover:bg-[var(--surface-2)]"
          title="Modifier"
        >
          <Edit2 size={13} style={{ color: "var(--text-muted)" }} />
        </button>
        <button
          onClick={onDelete}
          className="rounded p-1 hover:bg-red-50"
          title="Supprimer"
        >
          <Trash2 size={13} style={{ color: "var(--danger)" }} />
        </button>
      </div>
    </div>
  );
}
