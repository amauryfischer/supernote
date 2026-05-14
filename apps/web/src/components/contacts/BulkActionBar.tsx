"use client";

import { Button } from "@heroui/react";
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
        <Button
          variant="ghost"
          size="sm"
          onPress={onEmail}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          <Envelope size={13} />
          Email
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={onAddTag}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          <Tag size={13} />
          Ajouter tag
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={onArchive}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          <ArchiveIcon size={13} />
          {archiveText}
        </Button>
      </div>

      <Button
        isIconOnly
        variant="ghost"
        size="sm"
        onPress={onClear}
        className="h-7 w-7 rounded-md"
        style={{ color: "var(--text-muted)" }}
        aria-label="Désélectionner tout"
      >
        <X size={14} />
      </Button>
    </div>
  );
}
