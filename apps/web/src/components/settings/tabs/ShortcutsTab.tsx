"use client";

import { Keyboard, ArrowCounterClockwise } from "@phosphor-icons/react";
import { useState } from "react";
import { useSettings } from "../SettingsContext";
import { SettingSection } from "../SettingSection";
import { DEFAULT_SETTINGS } from "../defaults";
import type { Shortcut } from "../types";

function ShortcutRow({
  shortcut,
  onEdit,
}: {
  shortcut: Shortcut;
  onEdit: (keys: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(shortcut.keys);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    const parts: string[] = [];
    if (e.metaKey) parts.push("Cmd");
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.key && !["Meta", "Control", "Alt", "Shift"].includes(e.key)) {
      parts.push(e.key.toUpperCase());
    }
    if (parts.length > 1) setDraft(parts.join("+"));
  };

  const save = () => {
    onEdit(draft);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(shortcut.keys);
    setEditing(false);
  };

  return (
    <div
      className="flex items-center justify-between py-2.5"
      style={{ borderBottom: "1px solid var(--border-subtle)" }}
    >
      <span className="text-sm" style={{ color: "var(--text-primary)" }}>
        {shortcut.label}
      </span>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            onKeyDown={handleKeyDown}
            readOnly
            className="rounded-md border px-2 py-1 font-mono text-xs focus:outline-none"
            style={{
              borderColor: "var(--accent)",
              backgroundColor: "var(--surface-1)",
              color: "var(--text-primary)",
              width: 120,
            }}
          />
          <button
            onClick={save}
            className="rounded-md px-2 py-1 text-xs font-medium"
            style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
          >
            OK
          </button>
          <button
            onClick={cancel}
            className="rounded-md border px-2 py-1 text-xs"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
          >
            Annuler
          </button>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="rounded-md border px-2 py-1 font-mono text-xs transition-all hover:opacity-80"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface-1)",
            color: "var(--text-secondary)",
          }}
        >
          {shortcut.keys}
        </button>
      )}
    </div>
  );
}

export function ShortcutsTab() {
  const { settings, updateSettings } = useSettings();
  const { shortcuts } = settings;

  const editShortcut = (id: string, keys: string) => {
    updateSettings(
      "shortcuts",
      shortcuts.map((s) => (s.id === id ? { ...s, keys } : s)),
    );
  };

  const restoreDefaults = () => {
    updateSettings("shortcuts", DEFAULT_SETTINGS.shortcuts);
  };

  return (
    <div className="space-y-6">
      <SettingSection
        title="Raccourcis clavier"
        description="Cliquez sur un raccourci pour le modifier"
        icon={<Keyboard size={16} />}
        action={
          <button
            onClick={restoreDefaults}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-all hover:opacity-80"
            style={{ borderColor: "var(--border)", color: "var(--text-secondary)", backgroundColor: "var(--surface-1)" }}
          >
            <ArrowCounterClockwise size={14} />
            Restaurer les défauts
          </button>
        }
      >
        <div>
          {shortcuts.map((shortcut) => (
            <ShortcutRow
              key={shortcut.id}
              shortcut={shortcut}
              onEdit={(keys) => editShortcut(shortcut.id, keys)}
            />
          ))}
        </div>
      </SettingSection>
    </div>
  );
}
