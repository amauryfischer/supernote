"use client";

import { FileText, Plus } from "@phosphor-icons/react";
import { useTranslations } from "next-intl";
import { Button } from "@heroui/react";

import { GOOGLE_DOC_KINDS, type GoogleDocKind } from "@/lib/google-drive";
import { DRIVE_DOC_ICONS, DRIVE_DOC_ORDER } from "./driveDocMeta";

interface EmptyEditorProps {
  onNewNote: () => void;
  /**
   * Crée un Google Doc/Sheet/Slides. Absent quand Drive n'est pas connecté →
   * la rangée de boutons Workspace est masquée.
   */
  onNewDriveDoc?: (kind: GoogleDocKind) => void;
}

export function EmptyEditor({ onNewNote, onNewDriveDoc }: EmptyEditorProps) {
  const t = useTranslations("notes");

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ backgroundColor: "var(--accent-subtle)" }}
      >
        <FileText size={28} style={{ color: "var(--accent)" }} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
          {t("selectNote")}
        </h2>
        <p
          className="max-w-xs text-sm leading-relaxed"
          style={{ color: "var(--text-muted)" }}
        >
          {t("selectNoteHint")}
        </p>
      </div>

      <Button
        onPress={onNewNote}
        className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
        style={{
          backgroundColor: "var(--accent)",
          color: "var(--accent-foreground)",
        }}
      >
        <Plus size={15} />
        {t("newNote")}
      </Button>

      {onNewDriveDoc && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {DRIVE_DOC_ORDER.map((kind) => {
            const Icon = DRIVE_DOC_ICONS[kind];
            return (
              <Button
                key={kind}
                variant="ghost"
                onPress={() => onNewDriveDoc(kind)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium"
                style={{ color: "var(--text-muted)" }}
              >
                <Icon size={14} />
                {GOOGLE_DOC_KINDS[kind].label}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
