"use client";

/**
 * ShortcutsCheatSheet — modal cheat-sheet des raccourcis éditeur.
 * Ouverture via `?` hors d'un champ éditable dans NoteEditor.
 */

import { useMemo, useState } from "react";
import { Chip, Input } from "@heroui/react";
import { ACTION_META } from "@supernote/editor";
import { Modal } from "@supernote/ui";
import { useEditorBindings } from "@/lib/editor-shortcuts/useEditorBindings";
import { prettyCombo } from "@/lib/editor-shortcuts/prettyCombo";
import { BUILTIN_FORMAT_SHORTCUTS } from "@/lib/editor-shortcuts/builtins";

const CATEGORY_LABELS: Record<string, string> = {
  navigation: "Navigation",
  "block-ops": "Blocs",
  edition: "Édition",
  format: "Format",
  bloc: "Type de bloc",
  ia: "IA",
};

interface ShortcutsCheatSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ShortcutsCheatSheet({ isOpen, onClose }: ShortcutsCheatSheetProps) {
  const { resolved } = useEditorBindings();
  const [search, setSearch] = useState("");

  // Group actions by category
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, typeof ACTION_META[number][]>();
    for (const action of ACTION_META) {
      if (q && !action.label.toLowerCase().includes(q)) continue;
      const list = map.get(action.category) ?? [];
      list.push(action);
      map.set(action.category, list);
    }
    return map;
  }, [search]);

  // Filter builtin format shortcuts by search
  const filteredBuiltins = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return BUILTIN_FORMAT_SHORTCUTS;
    return BUILTIN_FORMAT_SHORTCUTS.filter((s) =>
      s.label.toLowerCase().includes(q),
    );
  }, [search]);

  const hasResults = grouped.size > 0 || filteredBuiltins.length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Raccourcis clavier éditeur"
      size="md"
    >
      <div className="space-y-4">
        <Input
          placeholder="Rechercher un raccourci…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm"
          aria-label="Rechercher un raccourci"
        />

        {!hasResults ? (
          <p className="py-4 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            Aucun raccourci ne correspond à « {search} »
          </p>
        ) : (
          <>
            {Array.from(grouped.entries()).map(([category, actions]) => (
              <div key={category}>
                <p
                  className="sn-eyebrow mb-1.5"
                >
                  {CATEGORY_LABELS[category] ?? category}
                </p>
                <div
                  className="overflow-hidden rounded-xl"
                  style={{ backgroundColor: "var(--surface-2)" }}
                >
                  {actions.map((action, idx) => {
                    const combo = resolved.byAction[action.id] ?? "";
                    const pretty = prettyCombo(combo);
                    const isLast = idx === actions.length - 1;
                    return (
                      <div
                        key={action.id}
                        className="flex items-center justify-between px-4 py-2.5"
                        style={{
                          borderBottom: isLast
                            ? undefined
                            : "1px solid var(--border-subtle)",
                        }}
                      >
                        <span
                          className="text-sm"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {action.label}
                        </span>
                        {pretty ? (
                          <Chip
                            variant="soft"
                            className="font-mono text-xs"
                          >
                            {pretty}
                          </Chip>
                        ) : (
                          <span
                            className="text-xs"
                            style={{ color: "var(--text-muted)" }}
                          >
                            —
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {filteredBuiltins.length > 0 && (
              <div>
                <p
                  className="sn-eyebrow mb-1.5"
                >
                  Format (intégrés)
                </p>
                <div
                  className="overflow-hidden rounded-xl"
                  style={{ backgroundColor: "var(--surface-2)" }}
                >
                  {filteredBuiltins.map((shortcut, idx) => {
                    const pretty = prettyCombo(shortcut.combo);
                    const isLast = idx === filteredBuiltins.length - 1;
                    return (
                      <div
                        key={shortcut.combo}
                        className="flex items-center justify-between px-4 py-2.5"
                        style={{
                          borderBottom: isLast
                            ? undefined
                            : "1px solid var(--border-subtle)",
                        }}
                      >
                        <span
                          className="text-sm"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {shortcut.label}
                        </span>
                        <Chip
                          variant="soft"
                          className="font-mono text-xs"
                        >
                          {pretty}
                        </Chip>
                      </div>
                    );
                  })}
                  <div
                    className="px-4 py-2"
                    style={{ borderTop: "1px solid var(--border-subtle)" }}
                  >
                    <span
                      className="text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Gérés par l'éditeur — non réassignables.
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
