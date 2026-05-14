"use client";

import { useState } from "react";
import { Button } from "@heroui/react";
import { Command } from "@phosphor-icons/react";

import { SEED_COMMANDS } from "@/lib/commands/seed";

/**
 * Demo page for the command palette system.
 * Accessible at /command-demo
 *
 * To test:
 *  - Press Cmd+K (macOS) or Ctrl+K (Win/Linux) to open the palette
 *  - Press Cmd+Shift+P for the alternative shortcut
 *  - Press Esc or click outside to close
 *  - Type to filter commands
 */
export default function CommandDemoPage() {
  const [lastEvent, setLastEvent] = useState<string>("");

  return (
    <div
        className="flex min-h-screen flex-col items-center justify-center gap-8 p-8"
        style={{ backgroundColor: "var(--surface-0)", color: "var(--text-primary)" }}
      >
        {/* Title */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl"
            style={{ backgroundColor: "var(--accent-subtle)" }}
          >
            <Command size={24} style={{ color: "var(--accent)" }} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Command Palette — Demo
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Système de palette de commandes Supernote avec raccourcis clavier globaux
          </p>
        </div>

        {/* Trigger button */}
        <Button
          onPress={() => {
            // Dispatch a synthetic keyboard event to trigger the palette
            window.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "k",
                metaKey: true,
                ctrlKey: false,
                bubbles: true,
                cancelable: true,
              }),
            );
            setLastEvent("Opened via button click");
          }}
          className="flex items-center gap-3 rounded-lg px-6 py-3 text-sm font-medium transition-all hover:scale-[1.02] active:scale-[0.99]"
          style={{
            backgroundColor: "var(--accent)",
            color: "var(--accent-foreground)",
            boxShadow: "0 2px 8px oklch(0.55 0.24 295 / 0.3)",
          }}
        >
          <Command size={16} />
          Ouvrir la palette
        </Button>

        {/* Shortcut hints */}
        <div
          className="flex flex-col gap-2 rounded-xl p-6 text-sm"
          style={{
            backgroundColor: "var(--surface-1)",
            border: "1px solid var(--border-subtle)",
            minWidth: "360px",
          }}
        >
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Raccourcis disponibles
          </h2>
          <ShortcutRow keys={["⌘", "K"]} label="Ouvrir / Fermer la palette" />
          <ShortcutRow keys={["⌘", "⇧", "P"]} label="Ouvrir la palette (alternatif)" />
          <ShortcutRow keys={["⌘", "N"]} label="Nouvelle note" />
          <ShortcutRow keys={["⌘", "D"]} label="Note du jour" />
          <ShortcutRow keys={["⌘", "⇧", "F"]} label="Recherche globale" />
          <ShortcutRow keys={["Esc"]} label="Fermer" />

          <div
            className="mt-3 text-xs"
            style={{
              color: "var(--text-muted)",
              borderTop: "1px solid var(--border-subtle)",
              paddingTop: "12px",
            }}
          >
            Sur Windows/Linux, remplacez <kbd>⌘</kbd> par <kbd>Ctrl</kbd>
          </div>
        </div>

        {/* Commands seed list */}
        <div
          className="rounded-xl p-6 text-sm"
          style={{
            backgroundColor: "var(--surface-1)",
            border: "1px solid var(--border-subtle)",
            minWidth: "360px",
          }}
        >
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Commandes enregistrées (seed)
          </h2>
          <CommandList />
        </div>

        {lastEvent && (
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            Dernier événement : {lastEvent}
          </p>
        )}
      </div>
  );
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

function ShortcutRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((k, i) => (
          <kbd
            key={i}
            className="rounded px-1.5 py-0.5 text-[11px] font-mono"
            style={{
              backgroundColor: "var(--surface-3)",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
            }}
          >
            {k}
          </kbd>
        ))}
      </span>
    </div>
  );
}

function CommandList() {
  return (
    <ul className="flex flex-col gap-1.5">
      {SEED_COMMANDS.map((cmd) => (
        <li key={cmd.id} className="flex items-center gap-2">
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-mono uppercase"
            style={{
              backgroundColor: "var(--accent-subtle)",
              color: "var(--accent)",
            }}
          >
            {cmd.group ?? "tools"}
          </span>
          <span style={{ color: "var(--text-secondary)" }}>{cmd.label}</span>
          <code className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
            {cmd.id}
          </code>
        </li>
      ))}

    </ul>
  );
}
