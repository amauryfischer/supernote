"use client";

import { Button } from "@heroui/react";
import { Command, PanelRight, Plus } from "lucide-react";

export function TopBar() {
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
        <Button
          size="sm"
          variant="primary"
          className="gap-1.5 text-xs"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Plus size={13} />
          Nouveau
        </Button>
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          className="h-8 w-8"
          style={{ color: "var(--text-muted)" }}
        >
          <PanelRight size={15} />
        </Button>
      </div>
    </header>
  );
}
