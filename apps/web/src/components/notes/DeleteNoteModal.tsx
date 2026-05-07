"use client";

import { Trash } from "@phosphor-icons/react";

interface DeleteNoteModalProps {
  isOpen: boolean;
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteNoteModal({
  isOpen,
  isPending,
  onConfirm,
  onCancel,
}: DeleteNoteModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl p-6 shadow-xl"
        style={{ backgroundColor: "var(--surface-0)", border: "1px solid var(--border-subtle)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-4 text-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--surface-2)" }}
          >
            <Trash size={22} style={{ color: "var(--text-secondary)" }} />
          </div>

          <div>
            <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              Supprimer cette note ?
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              La note sera déplacée dans la corbeille. Cette action est réversible.
            </p>
          </div>

          <div className="flex w-full gap-3">
            <button
              onClick={onCancel}
              disabled={isPending}
              className="flex-1 rounded-lg py-2 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
              style={{
                border: "1px solid var(--border-subtle)",
                color: "var(--text-secondary)",
              }}
            >
              Annuler
            </button>
            <button
              onClick={onConfirm}
              disabled={isPending}
              className="flex-1 rounded-lg py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-red-500, #ef4444)",
                color: "#fff",
              }}
            >
              {isPending ? "Suppression…" : "Supprimer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
