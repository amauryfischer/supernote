"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Export,
  ShareNetwork,
  CornersOut,
  CornersIn,
  FloppyDisk,
} from "@phosphor-icons/react";

interface CanvasEditorToolbarProps {
  title: string;
  fullscreen: boolean;
  onBack: () => void;
  onTitleChange: (title: string) => void;
  onExportPng: () => void;
  onShare: () => void;
  onSave: () => void;
  onToggleFullscreen: () => void;
}

export function CanvasEditorToolbar({
  title,
  fullscreen,
  onBack,
  onTitleChange,
  onExportPng,
  onShare,
  onSave,
  onToggleFullscreen,
}: CanvasEditorToolbarProps) {
  const [editing, setEditing] = useState(false);
  const [localTitle, setLocalTitle] = useState(title);

  function commitTitle() {
    setEditing(false);
    onTitleChange(localTitle);
  }

  return (
    <div
      className="flex h-11 shrink-0 items-center gap-2 border-b px-3"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
        zIndex: 10,
      }}
    >
      <button
        onClick={onBack}
        className="flex items-center justify-center rounded-md p-1.5 transition-colors hover:bg-[var(--surface-2)]"
        aria-label="Retour"
      >
        <ArrowLeft size={15} style={{ color: "var(--text-muted)" }} />
      </button>

      <div className="flex-1">
        {editing ? (
          <input
            autoFocus
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => e.key === "Enter" && commitTitle()}
            className="w-full rounded bg-[var(--surface-2)] px-2 py-0.5 text-sm font-semibold outline-none"
            style={{ color: "var(--text-primary)" }}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="rounded px-2 py-0.5 text-sm font-semibold transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-primary)" }}
          >
            {localTitle}
          </button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <ToolbarButton label="Exporter PNG" onClick={onExportPng}>
          <Export size={14} />
        </ToolbarButton>
        <ToolbarButton label="Partager" onClick={onShare}>
          <ShareNetwork size={14} />
        </ToolbarButton>
        <ToolbarButton label="Sauvegarder" onClick={onSave}>
          <FloppyDisk size={14} />
        </ToolbarButton>
        <ToolbarButton
          label={fullscreen ? "Quitter plein écran" : "Plein écran"}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? <CornersIn size={14} /> : <CornersOut size={14} />}
        </ToolbarButton>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex items-center justify-center rounded-md p-1.5 transition-colors hover:bg-[var(--surface-2)]"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </button>
  );
}
