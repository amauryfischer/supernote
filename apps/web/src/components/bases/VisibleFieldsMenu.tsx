"use client";

/**
 * VisibleFieldsMenu — popover to toggle which fields are visible in a view
 * and reorder them.
 *
 * The view stores two related arrays:
 *   - visibleFields: explicit ordered list of fieldIds shown
 *   - hiddenFields:  explicit list of fieldIds hidden
 *
 * When `visibleFields` is empty, `resolveVisibleFieldIds` falls back to the
 * schema's declared order minus `hiddenFields`. The menu always writes the
 * full explicit list so reorders and toggles persist deterministically.
 */

import { useEffect, useRef } from "react";
import { Eye, EyeSlash, CaretUp, CaretDown } from "@phosphor-icons/react";
import type { EntityType } from "@supernote/core";
import type { View } from "@supernote/ipc";
import { useViewMutations, resolveVisibleFieldIds } from "./hooks";
import { FieldKindBadge } from "@/components/schemas/FieldKindBadge";
import { labelForField } from "./filter-ops";

interface VisibleFieldsMenuProps {
  base: EntityType;
  view: View;
  onClose: () => void;
}

export function VisibleFieldsMenu({ base, view, onClose }: VisibleFieldsMenuProps) {
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

  // Compute the fully-resolved current state (visible-in-order + hidden) so
  // the menu shows everything, with visible items at the top in their order
  // and hidden items grouped at the bottom.
  const allFieldIds = base.fields.map((f) => f.id);
  const visible = resolveVisibleFieldIds(view, allFieldIds);
  const visibleSet = new Set(visible);
  const hidden = allFieldIds.filter((id) => !visibleSet.has(id));

  const commit = (nextVisible: string[], nextHidden: string[]) => {
    update.mutate({
      id: view.id,
      visibleFields: nextVisible,
      hiddenFields: nextHidden,
    });
  };

  const toggle = (fieldId: string, currentlyVisible: boolean) => {
    if (currentlyVisible) {
      commit(visible.filter((id) => id !== fieldId), [...hidden, fieldId]);
    } else {
      commit([...visible, fieldId], hidden.filter((id) => id !== fieldId));
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= visible.length) return;
    const next = [...visible];
    const tmp = next[index]!;
    next[index] = next[target]!;
    next[target] = tmp;
    commit(next, hidden);
  };

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 mt-1 rounded-lg border shadow-lg"
      style={{
        minWidth: 280,
        maxHeight: 420,
        overflowY: "auto",
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div
        className="sticky top-0 flex items-center gap-2 border-b px-3 py-2"
        style={{
          borderColor: "var(--border-subtle)",
          backgroundColor: "var(--surface-1)",
        }}
      >
        <Eye size={13} style={{ color: "var(--text-muted)" }} />
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--text-muted)" }}
        >
          Colonnes visibles
        </span>
      </div>

      {/* Visible (ordered) */}
      <div className="flex flex-col gap-0.5 px-2 py-2">
        {visible.length === 0 && (
          <p
            className="py-2 text-center text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            Aucune colonne visible.
          </p>
        )}
        {visible.map((fid, index) => {
          const field = base.fields.find((f) => f.id === fid);
          if (!field) return null;
          return (
            <div
              key={fid}
              className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-[var(--surface-2)]"
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  className="rounded p-0.5 hover:bg-[var(--surface-3)] disabled:opacity-30"
                  style={{ color: "var(--text-muted)" }}
                >
                  <CaretUp size={10} />
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === visible.length - 1}
                  className="rounded p-0.5 hover:bg-[var(--surface-3)] disabled:opacity-30"
                  style={{ color: "var(--text-muted)" }}
                >
                  <CaretDown size={10} />
                </button>
              </div>
              <FieldKindBadge kind={field.kind} />
              <span className="flex-1 text-xs" style={{ color: "var(--text-primary)" }}>
                {labelForField(field)}
              </span>
              <button
                type="button"
                onClick={() => toggle(fid, true)}
                className="rounded p-1 hover:bg-[var(--surface-3)]"
                title="Masquer"
                style={{ color: "var(--text-muted)" }}
              >
                <Eye size={12} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Hidden (alphabetical, no reorder needed since they're not displayed) */}
      {hidden.length > 0 && (
        <>
          <div
            className="border-t px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-muted)",
            }}
          >
            Masquées ({hidden.length})
          </div>
          <div className="flex flex-col gap-0.5 px-2 pb-2">
            {hidden.map((fid) => {
              const field = base.fields.find((f) => f.id === fid);
              if (!field) return null;
              return (
                <div
                  key={fid}
                  className="flex items-center gap-1.5 rounded px-1.5 py-1 opacity-60 hover:bg-[var(--surface-2)] hover:opacity-100"
                >
                  <FieldKindBadge kind={field.kind} />
                  <span className="flex-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    {labelForField(field)}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggle(fid, false)}
                    className="rounded p-1 hover:bg-[var(--surface-3)]"
                    title="Afficher"
                    style={{ color: "var(--text-muted)" }}
                  >
                    <EyeSlash size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
