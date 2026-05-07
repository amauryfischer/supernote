"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { AppShell } from "@/components/shell";
import { ENTITY_TYPES } from "@/components/schemas/fixtures";
import { SortableFieldRow } from "@/components/schemas/SortableFieldRow";
import { FieldEditorModal } from "@/components/schemas/FieldEditorModal";
import { FieldKindBadge } from "@/components/schemas/FieldKindBadge";
import { getIcon } from "@/components/schemas/icon-map";
import type { Field, EntityType } from "@supernote/core";

export default function SchemaEditPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : params.id?.[0] ?? "";

  const original = ENTITY_TYPES.find((t) => t.id === id);
  const [type, setType] = useState<EntityType>(
    original ?? {
      id: id,
      name: id,
      plural: id,
      fields: [],
      defaultPath: "",
      fileNamePattern: "{name}",
    }
  );
  const [fields, setFields] = useState<Field[]>([...type.fields]);
  const [editingField, setEditingField] = useState<Field | null | "new">(null);
  const [previewField, setPreviewField] = useState<Field | null>(fields[0] ?? null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setFields((prev) => {
      const oldIdx = prev.findIndex((f) => f.id === active.id);
      const newIdx = prev.findIndex((f) => f.id === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  }, []);

  const handleSaveField = useCallback((saved: Field) => {
    setFields((prev) => {
      const idx = prev.findIndex((f) => f.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
    setEditingField(null);
  }, []);

  const handleDeleteField = useCallback((fieldId: string) => {
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
  }, []);

  const Icon = getIcon(type.icon ?? "Box");

  if (!original) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <p style={{ color: "var(--text-muted)" }}>Type introuvable: {id}</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Top bar */}
        <div
          className="flex items-center gap-3 border-b px-6 py-3"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
        >
          <button
            onClick={() => router.push("/schemas")}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-secondary)" }}
          >
            <ArrowLeft size={14} />
            Schémas
          </button>
          <span style={{ color: "var(--border)" }}>/</span>
          <div className="flex items-center gap-2">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-md"
              style={{ backgroundColor: (type.color ?? "#6366F1") + "22", color: type.color ?? "#6366F1" }}
            >
              <Icon size={13} />
            </span>
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {type.name}
            </span>
          </div>
          <div className="ml-auto">
            <button
              className="rounded-lg px-4 py-1.5 text-sm font-medium transition-colors"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
            >
              Sauvegarder
            </button>
          </div>
        </div>

        {/* Body — 2 columns */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left — sortable field list */}
          <aside
            className="flex w-80 shrink-0 flex-col border-r"
            style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
          >
            <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border-subtle)" }}>
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Champs ({fields.length})
              </span>
              <button
                onClick={() => setEditingField("new")}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
                style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
              >
                <Plus size={11} /> Champ
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-3">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                  {fields.map((field) => (
                    <SortableFieldRow
                      key={field.id}
                      field={field}
                      onEdit={() => setEditingField(field)}
                      onDelete={() => handleDeleteField(field.id)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </aside>

          {/* Right — live preview */}
          <main className="flex flex-1 flex-col overflow-hidden" style={{ backgroundColor: "var(--surface-0)" }}>
            {/* Header */}
            <div className="border-b px-6 py-4" style={{ borderColor: "var(--border-subtle)" }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Aperçu live — {type.defaultView ?? "table"}
              </p>
            </div>
            {/* Table preview */}
            <div className="overflow-auto p-6">
              <div
                className="rounded-xl border"
                style={{ borderColor: "var(--border)" }}
              >
                {/* Table header */}
                <div
                  className="flex items-center border-b px-3 py-2"
                  style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
                >
                  {fields.slice(0, 5).map((field) => (
                    <div
                      key={field.id}
                      className="min-w-0 flex-1 cursor-pointer select-none px-2"
                      onClick={() => setPreviewField(field)}
                    >
                      <FieldKindBadge kind={field.kind} />
                      <p className="mt-0.5 truncate text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                        {field.label}
                      </p>
                    </div>
                  ))}
                </div>
                {/* Rows */}
                {[1, 2, 3].map((row) => (
                  <div
                    key={row}
                    className="flex items-center border-b px-3 py-3 last:border-b-0"
                    style={{ borderColor: "var(--border-subtle)" }}
                  >
                    {fields.slice(0, 5).map((field) => (
                      <div key={field.id} className="min-w-0 flex-1 px-2">
                        <p className="truncate text-sm" style={{ color: "var(--text-muted)" }}>
                          {field.kind === "bool"
                            ? row % 2 === 0 ? "Oui" : "Non"
                            : field.kind === "number" || field.kind === "currency"
                            ? (row * 1234).toLocaleString("fr-FR")
                            : field.kind === "date" || field.kind === "datetime" || field.kind === "createdAt" || field.kind === "updatedAt"
                            ? `2026-05-0${row}`
                            : `Valeur ${row}`}
                        </p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* Field detail panel */}
              {previewField && (
                <div
                  className="mt-4 rounded-xl border p-4"
                  style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)" }}
                >
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                    Champ sélectionné
                  </p>
                  <div className="flex items-center gap-3">
                    <FieldKindBadge kind={previewField.kind} />
                    <span className="font-medium" style={{ color: "var(--text-primary)" }}>{previewField.label}</span>
                    <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>{previewField.name}</span>
                    {previewField.required && (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-600">requis</span>
                    )}
                    {previewField.helpText && (
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{previewField.helpText}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>

      {/* Field editor modal */}
      {editingField !== null && (
        <FieldEditorModal
          field={editingField === "new" ? null : editingField}
          onClose={() => setEditingField(null)}
          onSave={handleSaveField}
        />
      )}
    </AppShell>
  );
}
