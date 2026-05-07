"use client";

import type { SearchMode } from "./types";

interface ModeToggleProps {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
}

const MODES: Array<{ value: SearchMode; label: string }> = [
  { value: "fts", label: "FTS" },
  { value: "hybrid", label: "Hybride" },
  { value: "semantic", label: "Sémantique" },
];

export function ModeToggle({ mode, onChange }: ModeToggleProps) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg border p-1"
      style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
    >
      {MODES.map((m) => (
        <button
          key={m.value}
          onClick={() => onChange(m.value)}
          className="rounded-md px-3 py-1 text-xs font-medium transition-colors"
          style={
            mode === m.value
              ? { backgroundColor: "var(--accent)", color: "white" }
              : { color: "var(--text-secondary)" }
          }
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
