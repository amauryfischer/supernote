"use client";

import { Keyboard, ArrowCounterClockwise } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Button, Chip, Input } from "@heroui/react";
import { ACTION_META } from "@supernote/editor";
import { useSettings } from "../SettingsContext";
import { SettingSection } from "../SettingSection";
import type { Shortcut } from "../types";
import { useEditorBindings } from "@/lib/editor-shortcuts/useEditorBindings";
import { prettyCombo, toCanonicalCombo } from "@/lib/editor-shortcuts/prettyCombo";

// Lecture seule : la personnalisation des raccourcis applicatifs n'est pas
// encore branchée au binding réel. On AFFICHE donc les touches sans offrir un
// contrôle d'édition qui ne s'appliquerait pas — un bouton qui « enregistre »
// dans le vide trahit la confiance. Les raccourcis ÉDITEUR (section 2) sont,
// eux, réellement éditables (EditorShortcutRow).
function ShortcutRow({ shortcut }: { shortcut: Shortcut }) {
  return (
    <div
      className="flex items-center justify-between py-2.5"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
      <span className="text-sm" style={{ color: "var(--text-primary)" }}>
        {shortcut.label}
      </span>
      <kbd
        className="rounded-md border px-2 py-1 font-mono text-xs"
        style={{
          borderColor: "var(--border)",
          backgroundColor: "var(--surface-1)",
          color: "var(--text-secondary)",
        }}
      >
        {shortcut.keys}
      </kbd>
    </div>
  );
}

// ── Editor shortcut categories ─────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  navigation: "Navigation",
  "block-ops": "Blocs",
  edition: "Édition",
  format: "Format",
  bloc: "Type de bloc",
  ia: "IA",
};

// Combos non réassignables — refus côté UI (mirrors resolve.ts RESERVED set).
const RESERVED_COMBOS = new Set([
  "mod+z", "mod+shift+z", "mod+c", "mod+v", "mod+x", "mod+a",
]);

/**
 * Row for a single editor action — shows `prettyCombo`, click-to-capture,
 * conflict badge, and inline error on reserved attempt.
 */
function EditorShortcutRow({
  actionId,
  label,
  currentCombo,
  hasConflict,
  onSave,
}: {
  actionId: string;
  label: string;
  currentCombo: string;
  hasConflict: boolean;
  onSave: (canonical: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    const parts: string[] = [];
    if (e.metaKey) parts.push("Cmd");
    if (e.ctrlKey && !e.metaKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.key && !["Meta", "Control", "Alt", "Shift"].includes(e.key)) {
      parts.push(e.key.toUpperCase());
    }
    if (parts.length > 1) setDraft(parts.join("+"));
  };

  const save = () => {
    const canonical = toCanonicalCombo(draft);
    if (RESERVED_COMBOS.has(canonical)) {
      setError(`${draft} est réservé et ne peut pas être réassigné.`);
      return;
    }
    setError(null);
    onSave(canonical);
    setEditing(false);
  };

  const cancel = () => {
    setDraft("");
    setError(null);
    setEditing(false);
  };

  const displayLabel = prettyCombo(currentCombo) || "—";

  return (
    <div className="py-2.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm truncate" style={{ color: "var(--text-primary)" }}>
            {label}
          </span>
          {hasConflict && (
            <Chip color="warning" variant="soft" className="text-[10px]">
              Conflit
            </Chip>
          )}
        </div>
        {editing ? (
          <div className="flex items-center gap-2 shrink-0">
            <Input
              autoFocus
              value={draft}
              onKeyDown={handleKeyDown}
              readOnly
              placeholder="Appuyez sur les touches…"
              className="w-[160px] font-mono text-xs"
            />
            <Button
              variant="ghost"
              size="sm"
              onPress={save}
              isDisabled={!draft}
              className="rounded-md px-2 py-1 text-xs font-medium"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
            >
              OK
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onPress={cancel}
              className="rounded-md border px-2 py-1 text-xs"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            >
              Annuler
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onPress={() => { setDraft(""); setError(null); setEditing(true); }}
            className="rounded-md border px-2 py-1 font-mono text-xs shrink-0"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-1)",
              color: "var(--text-secondary)",
            }}
          >
            {displayLabel}
          </Button>
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs" style={{ color: "var(--color-danger, #ef4444)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function ShortcutsTab() {
  const { settings, updateSettings } = useSettings();
  const { shortcuts } = settings;
  const { resolved } = useEditorBindings();

  const restoreEditorDefaults = () => {
    updateSettings("editorShortcuts", {});
  };

  const saveEditorShortcut = (actionId: string, canonical: string) => {
    updateSettings("editorShortcuts", {
      ...settings.editorShortcuts,
      [actionId]: canonical,
    });
  };

  // Group ACTION_META by category
  const grouped = useMemo(() => {
    const map = new Map<string, typeof ACTION_META[number][]>();
    for (const action of ACTION_META) {
      const list = map.get(action.category) ?? [];
      list.push(action);
      map.set(action.category, list);
    }
    return map;
  }, []);

  // Set of conflicting action IDs (duplicate or native)
  const conflictedActionIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of resolved.conflicts) {
      if (c.kind === "duplicate" || c.kind === "native") {
        for (const id of c.actionIds) ids.add(id);
      }
    }
    return ids;
  }, [resolved.conflicts]);

  return (
    <div className="space-y-6">
      <SettingSection
        title="Raccourcis clavier"
        description="Aperçu (lecture seule) des raccourcis applicatifs."
        icon={<Keyboard size={16} />}
      >
        <div>
          {shortcuts.map((shortcut) => (
            <ShortcutRow key={shortcut.id} shortcut={shortcut} />
          ))}
        </div>
      </SettingSection>

      <SettingSection
        title="Raccourcis éditeur"
        description="Cliquez sur un raccourci pour le modifier. Appuyez sur ? dans l'éditeur pour voir la cheat-sheet."
        icon={<Keyboard size={16} />}
        action={
          <Button
            variant="ghost"
            size="sm"
            onPress={restoreEditorDefaults}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)", backgroundColor: "var(--surface-1)" }}
          >
            <ArrowCounterClockwise size={14} />
            Restaurer les défauts
          </Button>
        }
      >
        <div>
          {Array.from(grouped.entries()).map(([category, actions]) => (
            <div key={category}>
              <p
                className="px-0 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                {CATEGORY_LABELS[category] ?? category}
              </p>
              {actions.map((action) => (
                <EditorShortcutRow
                  key={action.id}
                  actionId={action.id}
                  label={action.label}
                  currentCombo={resolved.byAction[action.id] ?? ""}
                  hasConflict={conflictedActionIds.has(action.id)}
                  onSave={(canonical) => saveEditorShortcut(action.id, canonical)}
                />
              ))}
            </div>
          ))}
        </div>
      </SettingSection>
    </div>
  );
}
