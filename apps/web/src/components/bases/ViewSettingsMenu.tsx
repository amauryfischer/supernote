"use client";

/**
 * ViewSettingsMenu — kebab dropdown for one view: rename, duplicate, delete,
 * change kind. Rendered as a popover anchored to a trigger button (caller
 * positions it). System (default) views can be renamed but not deleted.
 */

import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@heroui/react";
import {
  PencilSimple,
  Copy,
  Trash,
  Table,
  Kanban,
  GridFour,
  CalendarBlank,
  List,
} from "@phosphor-icons/react";
import type { View, ViewKind } from "@supernote/ipc";
import { useConfirm } from "@/lib/confirm";
import { useViewMutations } from "./hooks";
import { VIEW_KIND_LABEL } from "./ViewKindIcon";

interface ViewSettingsMenuProps {
  view: View;
  onClose: () => void;
  /** Called with the new view id after a duplicate so the parent can switch. */
  onDuplicated?: (newId: string) => void;
  /** Called after delete so the parent can fall back to another view. */
  onDeleted?: () => void;
}

const KIND_ICONS: Record<ViewKind, React.ComponentType<{ size?: number }>> = {
  table: Table,
  board: Kanban,
  gallery: GridFour,
  calendar: CalendarBlank,
  list: List,
};

export function ViewSettingsMenu({
  view,
  onClose,
  onDuplicated,
  onDeleted,
}: ViewSettingsMenuProps) {
  const { create, update, delete: del } = useViewMutations();
  const confirm = useConfirm();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nextName, setNextName] = useState(view.name);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [onClose]);

  const commitRename = () => {
    const trimmed = nextName.trim();
    if (trimmed && trimmed !== view.name) {
      update.mutate({ id: view.id, name: trimmed });
    }
    setRenaming(false);
    onClose();
  };

  const duplicate = () => {
    create.mutate(
      {
        typeId: view.typeId,
        name: `${view.name} (copie)`,
        kind: view.kind,
        filters: view.filters as never,
        sorts: view.sorts as never,
        visibleFields: view.visibleFields,
        hiddenFields: view.hiddenFields,
        groupByField: view.groupByField,
        rowHeight: view.rowHeight,
      },
      {
        onSuccess: (created) => {
          if (created && typeof created === "object" && "id" in created) {
            onDuplicated?.((created as { id: string }).id);
          }
          onClose();
        },
      },
    );
  };

  const remove = () => {
    if (view.isSystem) return;
    del.mutate(
      { id: view.id },
      {
        onSuccess: () => {
          onDeleted?.();
          onClose();
        },
      },
    );
  };

  const changeKind = (kind: ViewKind) => {
    if (kind === view.kind) return;
    update.mutate({ id: view.id, kind });
    onClose();
  };

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 mt-1 rounded-lg border shadow-lg"
      style={{
        minWidth: 220,
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
      }}
    >
      {/* Rename */}
      {renaming ? (
        <div
          className="border-b p-2"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <Input
            autoFocus
            value={nextName}
            onChange={(e) => setNextName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setRenaming(false);
                setNextName(view.name);
              }
            }}
            className="w-full rounded border bg-transparent px-2 py-1 text-xs"
            style={{ borderColor: "var(--accent)", color: "var(--text-primary)" }}
          />
        </div>
      ) : (
        <MenuButton
          icon={<PencilSimple size={12} />}
          label="Renommer"
          onClick={() => setRenaming(true)}
        />
      )}

      <MenuButton icon={<Copy size={12} />} label="Dupliquer" onClick={duplicate} />

      {/* Change kind submenu (inline list) */}
      <div
        className="border-t px-2 py-1.5 text-xs font-semibold uppercase tracking-wide"
        style={{
          borderColor: "var(--border-subtle)",
          color: "var(--text-muted)",
        }}
      >
        Type de vue
      </div>
      <div className="flex flex-col gap-0.5 px-1 pb-1">
        {(Object.keys(KIND_ICONS) as ViewKind[]).map((kind) => {
          const KindIcon = KIND_ICONS[kind];
          const active = kind === view.kind;
          return (
            <Button
              key={kind}
              variant="ghost"
              size="sm"
              onPress={() => changeKind(kind)}
              className="flex items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-[var(--surface-2)]"
              style={{
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                backgroundColor: active ? "var(--surface-3)" : "transparent",
              }}
            >
              <KindIcon size={11} />
              {VIEW_KIND_LABEL[kind]}
              {active && <span className="ml-auto text-xs">✓</span>}
            </Button>
          );
        })}
      </div>

      {/* Delete */}
      {!view.isSystem && (
        <>
          <div
            className="border-t"
            style={{ borderColor: "var(--border-subtle)" }}
          />
          <MenuButton
              icon={<Trash size={12} />}
              label="Supprimer la vue"
              onClick={async () => {
                const ok = await confirm({
                  title: "Supprimer cette vue ?",
                  body: (
                    <>
                      La vue <strong>{view.name}</strong> sera supprimée. Ses filtres, tris et configuration
                      sont perdus. Les données des entités restent intactes. Cette action est irréversible.
                    </>
                  ),
                  confirmLabel: "Supprimer la vue",
                  variant: "danger",
                });
                if (ok) {
                  remove();
                }
              }}
              danger
            />
        </>
      )}
    </div>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onPress={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--surface-2)]"
      style={{ color: danger ? "#EF4444" : "var(--text-secondary)" }}
    >
      {icon}
      {label}
    </Button>
  );
}
