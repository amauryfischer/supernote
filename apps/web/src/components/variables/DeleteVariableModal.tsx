"use client";

import { Button } from "@heroui/react";
import { Trash } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc/client";

interface DeleteVariableModalProps {
  isOpen: boolean;
  variableId: string | null;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteVariableModal({
  isOpen,
  variableId,
  onClose,
  onDeleted,
}: DeleteVariableModalProps) {
  const del = trpc.variables.delete.useMutation();

  async function handleDelete() {
    if (!variableId) return;
    await del.mutateAsync({ id: variableId });
    onDeleted();
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
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
              Supprimer la variable
            </h2>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              Les formules qui référencent cette variable afficheront une erreur après suppression.
            </p>
          </div>

          <div className="flex w-full gap-3">
            <Button
              variant="ghost"
              onPress={onClose}
              isDisabled={del.isPending}
              className="flex-1 rounded-lg bg-transparent py-2 text-sm font-medium hover:bg-[var(--surface-2)]"
              style={{ border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
            >
              Annuler
            </Button>
            <Button
              variant="ghost"
              onPress={handleDelete}
              isDisabled={del.isPending}
              className="flex-1 rounded-lg py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "var(--color-red-500, #ef4444)", color: "#fff" }}
            >
              {del.isPending ? "Suppression…" : "Supprimer"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
