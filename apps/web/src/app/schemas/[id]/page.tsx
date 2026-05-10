"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, FloppyDisk } from "@phosphor-icons/react";
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
import { AppShell, useMobileTitle, useMobileHeaderActions, useMobileFab, type MobileHeaderAction } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { ENTITY_TYPES } from "@/components/schemas/fixtures";
import { SortableFieldRow } from "@/components/schemas/SortableFieldRow";
import { FieldEditorModal } from "@/components/schemas/FieldEditorModal";
import { FieldKindBadge } from "@/components/schemas/FieldKindBadge";
import { getIcon } from "@/components/schemas/icon-map";
import { ipcEntityTypeToCore, coreFieldToIpc } from "@/components/schemas/adapters";
import { trpc } from "@/lib/trpc/client";
import type { Field, EntityType } from "@supernote/core";

export default function SchemaEditPage() {
  const params = useParams();
  const router = useRouter();
  const isMobile = useIsMobile();
  const id = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");

  // tRPC get — fallback to fixture on error
  const { data: ipcType, isLoading, isError } = trpc.schemas.get.useQuery({ id });
  const updateMutation = trpc.schemas.update.useMutation();

  const fallbackType = ENTITY_TYPES.find((t) => t.id === id);

  const resolvedType: EntityType | undefined = isError || !ipcType
    ? fallbackType
    : ipcEntityTypeToCore(ipcType);

  const [fields, setFields] = useState<Field[]>([]);
  const [editingField, setEditingField] = useState<Field | null | "new">(null);
  const [previewField, setPreviewField] = useState<Field | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Sync fields when resolved type changes
  useEffect(() => {
    if (resolvedType) {
      setFields([...resolvedType.fields]);
      setPreviewField(resolvedType.fields[0] ?? null);
    }
  }, [resolvedType]);

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

  const handleSave = useCallback(async () => {
    setSaveError(null);
    setSaveSuccess(false);
    try {
      await updateMutation.mutateAsync({
        id,
        fields: fields.map(coreFieldToIpc),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Erreur de sauvegarde");
    }
  }, [id, fields, updateMutation]);

  // Mobile chrome — hooks must be unconditional (before early returns)
  useMobileTitle(isMobile ? (resolvedType?.name ?? "Schéma") : null);
  const mobileHeaderActions: MobileHeaderAction[] = useMemo(() => {
    if (!isMobile) return [];
    return [
      {
        id: "save",
        icon: FloppyDisk,
        label: saveSuccess ? "Sauvegardé" : "Sauvegarder",
        onPress: () => void handleSave(),
        active: saveSuccess,
      },
    ];
  }, [isMobile, saveSuccess, handleSave]);
  useMobileHeaderActions(mobileHeaderActions);
  useMobileFab(
    isMobile
      ? { icon: Plus, label: "Nouveau champ", onPress: () => setEditingField("new") }
      : null,
  );

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <p style={{ color: "var(--text-muted)" }}>Chargement…</p>
        </div>
      </AppShell>
    );
  }

  if (!resolvedType) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center">
          <p style={{ color: "var(--text-muted)" }}>Type introuvable : {id}</p>
        </div>
      </AppShell>
    );
  }

  const Icon = getIcon(resolvedType.icon ?? "Box");

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Top bar — hidden on mobile (title + save in shell top bar) */}
        <div
          className="hidden items-center gap-3 border-b px-6 py-3 md:flex"
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
              style={{ backgroundColor: (resolvedType.color ?? "#6366F1") + "22", color: resolvedType.color ?? "#6366F1" }}
            >
              <Icon size={13} />
            </span>
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {resolvedType.name}
            </span>
          </div>
          {isError && (
            <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
              (mode hors-ligne)
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {saveError && (
              <span className="text-xs text-red-500">{saveError}</span>
            )}
            {saveSuccess && (
              <span className="text-xs" style={{ color: "var(--accent)" }}>Sauvegardé</span>
            )}
            <button
              onClick={() => void handleSave()}
              disabled={updateMutation.isPending}
              className="rounded-lg px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
            >
              {updateMutation.isPending ? "…" : "Sauvegarder"}
            </button>
          </div>
        </div>

        {/* Body — 2 columns on desktop, 1 column on mobile */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left — sortable field list — full width on mobile */}
          <aside
            className="flex shrink-0 flex-col border-r"
            style={{
              width: isMobile ? "100%" : 320,
              borderColor: "var(--border-subtle)",
              backgroundColor: "var(--surface-1)",
            }}
          >
            <div
              className="flex items-center justify-between border-b px-4 py-3"
              style={{ borderColor: "var(--border-subtle)" }}
            >
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

          {/* Right — live preview — hidden on mobile */}
          {!isMobile && <main className="flex flex-1 flex-col overflow-hidden" style={{ backgroundColor: "var(--surface-0)" }}>
            <div className="border-b px-6 py-4" style={{ borderColor: "var(--border-subtle)" }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Aperçu live — {resolvedType.defaultView ?? "table"}
              </p>
            </div>
            <div className="overflow-auto p-6">
              <div className="rounded-xl border" style={{ borderColor: "var(--border)" }}>
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
                {/* Mock rows */}
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
          </main>}
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
