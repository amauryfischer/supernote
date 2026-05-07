"use client";

import { Plus } from "@phosphor-icons/react";

interface NewNoteButtonProps {
  onClick: () => void;
  label?: string;
}

export function NewNoteButton({ onClick, label = "Nouvelle note" }: NewNoteButtonProps) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
      style={{
        backgroundColor: "var(--accent)",
        color: "var(--accent-foreground)",
      }}
    >
      <Plus size={13} />
      {label}
    </button>
  );
}
