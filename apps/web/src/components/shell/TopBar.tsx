"use client";

import { Command, PanelRight, Plus } from "lucide-react";
import { useShellChrome } from "./shell-chrome-context";

export function TopBar() {
  const { toggleRightPanel, rightPanelVisible, requestNewNote } = useShellChrome();

  return (
    <header
      className="shell-chrome flex items-center justify-between border-b px-4"
      style={{
        height: "var(--header-height)",
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      {/* Quick search hint */}
      <button
        onClick={() => {
          // dispatched as event so the eventual command-palette can listen for it
          window.dispatchEvent(new CustomEvent("supernote:open-command-palette"));
        }}
        className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors hover:bg-[var(--surface-2)]"
        style={{
          color: "var(--text-muted)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <Command size={11} />
        <span>Recherche rapide…</span>
        <kbd
          className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-mono"
          style={{
            backgroundColor: "var(--surface-3)",
            color: "var(--text-muted)",
          }}
        >
          K
        </kbd>
      </button>

      {/* Actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={requestNewNote}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
          style={{
            backgroundColor: "var(--accent)",
            color: "var(--accent-foreground)",
          }}
        >
          <Plus size={13} />
          Nouveau
        </button>
        <button
          onClick={toggleRightPanel}
          aria-label={rightPanelVisible ? "Masquer le panneau" : "Afficher le panneau"}
          className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
          style={{
            color: rightPanelVisible ? "var(--text-secondary)" : "var(--text-muted)",
          }}
        >
          <PanelRight size={15} />
        </button>
      </div>
    </header>
  );
}
