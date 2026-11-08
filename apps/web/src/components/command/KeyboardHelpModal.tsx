"use client";

import { useMemo, useState } from "react";
import { Input, Modal } from "@supernote/ui";

import type { Shortcut } from "@/lib/keyboard";
import { prettyCombo } from "@/lib/editor-shortcuts/prettyCombo";

const prettyKeys = (keys: string) => keys.split(" ").map(prettyCombo).join(" puis ");

interface KeyboardHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  shortcuts: Shortcut[];
}

export function KeyboardHelpModal({ isOpen, onClose, shortcuts }: KeyboardHelpModalProps) {
  const [search, setSearch] = useState("");

  // Une action peut avoir deux combos (Ctrl+N / Ctrl+Alt+N) : une ligne par libellé.
  const rows = useMemo(() => {
    const byLabel = new Map<string, string[]>();
    for (const s of shortcuts) byLabel.set(s.description, [...(byLabel.get(s.description) ?? []), prettyKeys(s.keys)]);
    const q = search.trim().toLowerCase();
    return [...byLabel].filter(([label]) => !q || label.toLowerCase().includes(q));
  }, [shortcuts, search]);

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => { if (!open) onClose(); }} title="Raccourcis clavier" size="md">
      <div className="space-y-4">
        <Input
          autoFocus
          placeholder="Rechercher un raccourci…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm"
          aria-label="Rechercher un raccourci"
        />
        <div className="overflow-hidden rounded-xl" style={{ backgroundColor: "var(--surface-2)" }}>
          {rows.map(([label, combos], i) => (
            <div
              key={label}
              className="flex items-center justify-between gap-4 px-4 py-2.5"
              style={{ borderTop: i ? "1px solid var(--border-subtle)" : undefined }}
            >
              <span className="text-sm" style={{ color: "var(--text-primary)" }}>{label}</span>
              <span className="flex shrink-0 gap-1">
                {combos.map((c) => (
                  <kbd
                    key={c}
                    className="rounded px-1.5 py-0.5 font-mono text-[11px]"
                    style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)", border: "1px solid var(--border)" }}
                  >
                    {c}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Le mail et l'éditeur ont leurs propres raccourcis : <kbd>?</kbd> dans chacun.
        </p>
      </div>
    </Modal>
  );
}
