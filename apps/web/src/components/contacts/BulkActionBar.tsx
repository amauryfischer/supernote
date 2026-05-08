"use client";

import { Archive, Envelope, Tag, Trash, X } from "@phosphor-icons/react";

interface BulkActionBarProps {
  selectedCount: number;
  onClear: () => void;
  onEmail?: () => void;
  onArchive?: () => void;
  /** Override the "Archiver" button label. If "Supprimer" is passed, a trash icon is shown. */
  archiveLabel?: string;
  onAddTag?: () => void;
}

export function BulkActionBar({ selectedCount, onClear, onEmail, onArchive, archiveLabel, onAddTag }: BulkActionBarProps) {
  const archiveText = archiveLabel ?? "Archiver";
  const ArchiveIcon = archiveLabel === "Supprimer" ? Trash : Archive;
  if (selectedCount === 0) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border px-4 py-3 shadow-xl"
      style={{
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border)",
        backdropFilter: "blur(8px)",
      }}
    >
      <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
        {selectedCount} sélectionné{selectedCount > 1 ? "s" : ""}
      </span>

      <div className="flex gap-2">
        <button
          onClick={onEmail}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-secondary)" }}
        >
          <Envelope size={13} />
          Email
        </button>
        <button
          onClick={onAddTag}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-secondary)" }}
        >
          <Tag size={13} />
          Ajouter tag
        </button>
        <button
          onClick={onArchive}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-secondary)" }}
        >
          <ArchiveIcon size={13} />
          {archiveText}
        </button>
      </div>

      <button
        onClick={onClear}
        className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
        style={{ color: "var(--text-muted)" }}
        aria-label="Désélectionner tout"
      >
        <X size={14} />
      </button>
    </div>
  );
}
