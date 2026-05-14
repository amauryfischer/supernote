"use client";

/**
 * PivotFieldMenu — popover to pick the "pivot field" of a view.
 *
 * The view's `groupByField` slot is interpreted by the renderer:
 *   - Kanban / List → select / status fields drive column buckets
 *   - Calendar      → date / datetime fields drive day placement
 *
 * We accept a `mode` prop that constrains the candidate fields shown.
 */

import { useEffect, useRef } from "react";
import { Button } from "@heroui/react";
import { Check } from "@phosphor-icons/react";
import type { EntityType, Field, FieldKind } from "@supernote/core";
import type { View } from "@supernote/ipc";
import { useViewMutations } from "./hooks";
import { FieldKindBadge } from "@/components/schemas/FieldKindBadge";
import { labelForField } from "./filter-ops";

interface PivotFieldMenuProps {
  base: EntityType;
  view: View;
  mode: "group" | "date";
  onClose: () => void;
}

const GROUP_KINDS: FieldKind[] = ["select", "status"];
const DATE_KINDS: FieldKind[] = ["date", "datetime", "createdAt", "updatedAt"];

export function PivotFieldMenu({ base, view, mode, onClose }: PivotFieldMenuProps) {
  const { update } = useViewMutations();
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [onClose]);

  const candidates: Field[] = base.fields.filter((f) =>
    mode === "group" ? GROUP_KINDS.includes(f.kind) : DATE_KINDS.includes(f.kind),
  );

  const pick = (fieldId: string | null) => {
    update.mutate({ id: view.id, groupByField: fieldId });
    onClose();
  };

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 mt-1 rounded-lg border shadow-lg"
      style={{
        minWidth: 240,
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div
        className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide"
        style={{
          borderColor: "var(--border-subtle)",
          color: "var(--text-muted)",
        }}
      >
        {mode === "group" ? "Grouper par" : "Date d'affichage"}
      </div>
      <div className="flex flex-col gap-0.5 p-1">
        {candidates.length === 0 ? (
          <p
            className="px-3 py-2 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            {mode === "group"
              ? "Aucun champ select / status sur le schéma."
              : "Aucun champ date sur le schéma."}
          </p>
        ) : (
          candidates.map((f) => {
            const active = view.groupByField === f.id;
            return (
              <Button
                key={f.id}
                variant="ghost"
                size="sm"
                onPress={() => pick(f.id)}
                className="flex items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-[var(--surface-2)]"
                style={{
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  backgroundColor: active ? "var(--surface-3)" : "transparent",
                }}
              >
                <FieldKindBadge kind={f.kind} />
                <span className="flex-1">{labelForField(f)}</span>
                {active && <Check size={11} />}
              </Button>
            );
          })
        )}
        {view.groupByField && (
          <Button
            variant="ghost"
            size="sm"
            onPress={() => pick(null)}
            className="mt-1 border-t px-3 py-1 text-left text-xs"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-muted)",
            }}
          >
            Effacer la sélection
          </Button>
        )}
      </div>
    </div>
  );
}
