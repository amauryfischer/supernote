"use client";

import { Plus } from "@phosphor-icons/react";
import { Button } from "@heroui/react";

interface NewNoteButtonProps {
  onClick: () => void;
  label?: string;
}

export function NewNoteButton({ onClick, label = "Nouvelle note" }: NewNoteButtonProps) {
  return (
    <Button
      onPress={onClick}
      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
      style={{
        backgroundColor: "var(--btn-primary-bg)",
        color: "var(--btn-primary-fg)",
      }}
    >
      <Plus size={13} />
      {label}
    </Button>
  );
}
