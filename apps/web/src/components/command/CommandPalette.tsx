"use client";

import { Command } from "cmdk";
import {
  BookOpen,
  Calendar,
  FileText,
  Hash,
  Stack,
  SidebarSimple,
  Plus,
  MagnifyingGlass,
  Gear,
  Sun,
  Users,
  Lightning,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { registry } from "@/lib/commands/registry";
import type { Command as AppCommand } from "@/lib/commands/types";

// ---------------------------------------------------------------------------
// Icon resolver — maps seed icon names to Lucide components
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, PhosphorIcon> = {
  "file-plus": Plus,
  "file-text": FileText,
  "calendar": Calendar,
  "search": MagnifyingGlass,
  "users": Users,
  "layers": Stack,
  "hash": Hash,
  "settings": Gear,
  "panel-left": SidebarSimple,
  "panel-right": SidebarSimple,
  "sun": Sun,
  "zap": Lightning,
  "book-open": BookOpen,
};

function CommandIcon({ name, size = 15 }: { name?: string; size?: number }) {
  if (!name) return null;
  const Icon = ICON_MAP[name];
  if (!Icon) return null;
  return <Icon size={size} />;
}

// ---------------------------------------------------------------------------
// Shortcut hint renderer
// ---------------------------------------------------------------------------

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPod|iPad/.test(navigator.platform);

function ShortcutHint({ keys }: { keys: string }) {
  const parts = keys
    .split("+")
    .map((k) => {
      if (k === "mod") return isMac ? "⌘" : "Ctrl";
      if (k === "shift") return "⇧";
      if (k === "alt") return isMac ? "⌥" : "Alt";
      return k.toUpperCase();
    });

  return (
    <span className="flex items-center gap-0.5">
      {parts.map((p, i) => (
        <kbd
          key={i}
          className="rounded px-1.5 py-0.5 text-[10px] font-mono"
          style={{
            backgroundColor: "var(--surface-3)",
            color: "var(--text-muted)",
            border: "1px solid var(--border)",
          }}
        >
          {p}
        </kbd>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Group labels
// ---------------------------------------------------------------------------

const GROUP_LABELS: Record<string, string> = {
  creation: "Créer",
  navigation: "Navigation",
  editing: "Édition",
  view: "Affichage",
  tools: "Outils",
  plugin: "Plugins",
};

// ---------------------------------------------------------------------------
// CommandPalette component
// ---------------------------------------------------------------------------

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  // Reset query on open
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const allCommands = useMemo(() => registry.list(), [open]);

  const handleSelect = useCallback(
    async (cmdId: string) => {
      onClose();
      await registry.execute(cmdId);
    },
    [onClose],
  );

  if (!open) return null;

  // Group commands
  const grouped = allCommands.reduce<Record<string, AppCommand[]>>((acc, cmd) => {
    const g = cmd.group ?? "tools";
    if (!acc[g]) acc[g] = [];
    acc[g]!.push(cmd);
    return acc;
  }, {});

  const groupOrder: string[] = ["creation", "navigation", "view", "tools", "editing", "plugin"];

  return (
    // Overlay
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{
        paddingTop: "12vh",
        backgroundColor: "oklch(0.14 0.006 260 / 0.4)",
        backdropFilter: "blur(4px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Modal */}
      <div
        className="w-full overflow-hidden shadow-2xl"
        style={{
          maxWidth: "600px",
          backgroundColor: "var(--surface-1)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-xl)",
          animation: "cmdpalette-in 120ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <Command
          label="Command palette"
          loop
          shouldFilter={true}
          className="flex flex-col"
        >
          {/* Search input */}
          <div
            className="flex items-center gap-3 px-4"
            style={{
              borderBottom: "1px solid var(--border-subtle)",
              height: "52px",
            }}
          >
            <MagnifyingGlass
              size={16}
              style={{ color: "var(--text-muted)", flexShrink: 0 }}
            />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Tapez une commande, cherchez une note, ou créez quelque chose…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
              style={{ color: "var(--text-primary)" }}
              autoFocus
            />
            <kbd
              className="rounded px-1.5 py-0.5 text-[10px] font-mono"
              style={{
                backgroundColor: "var(--surface-3)",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
              }}
            >
              Esc
            </kbd>
          </div>

          {/* Results */}
          <Command.List
            className="max-h-[420px] overflow-y-auto py-2"
            style={{ scrollbarWidth: "thin" }}
          >
            <Command.Empty
              className="py-8 text-center text-sm"
              style={{ color: "var(--text-muted)" }}
            >
              Aucun résultat pour &ldquo;{query}&rdquo;
            </Command.Empty>

            {/* Placeholder sections visible when no query */}
            {!query && (
              <>
                <PlaceholderGroup label="Récents" />
                <PlaceholderGroup label="Suggestions" />
              </>
            )}

            {/* Command groups */}
            {groupOrder.map((groupKey) => {
              const cmds = grouped[groupKey];
              if (!cmds?.length) return null;
              return (
                <Command.Group
                  key={groupKey}
                  heading={GROUP_LABELS[groupKey] ?? groupKey}
                  className="px-2"
                >
                  {cmds.map((cmd) => (
                    <CommandItem
                      key={cmd.id}
                      cmd={cmd}
                      onSelect={handleSelect}
                    />
                  ))}
                </Command.Group>
              );
            })}

            {/* Placeholder sections */}
            {!query && (
              <>
                <PlaceholderGroup label="Notes" items={["Ouvrir une note…"]} />
                <PlaceholderGroup label="Contacts" items={["Rechercher un contact…"]} />
                <PlaceholderGroup label="Projets" items={["Rechercher un projet…"]} />
              </>
            )}
          </Command.List>

          {/* Footer */}
          <div
            className="flex items-center justify-between px-4 py-2 text-[11px]"
            style={{
              borderTop: "1px solid var(--border-subtle)",
              color: "var(--text-muted)",
            }}
          >
            <span className="flex items-center gap-3">
              <span>
                <kbd className="font-mono">↑↓</kbd> naviguer
              </span>
              <span>
                <kbd className="font-mono">↵</kbd> sélectionner
              </span>
              <span>
                <kbd className="font-mono">Esc</kbd> fermer
              </span>
            </span>
            <span style={{ color: "var(--accent)" }}>Supernote</span>
          </div>
        </Command>
      </div>

      <style>{`
        @keyframes cmdpalette-in {
          from { opacity: 0; transform: scale(0.97) translateY(-4px); }
          to   { opacity: 1; transform: scale(1)    translateY(0); }
        }
        [cmdk-group-heading] {
          padding: 4px 8px 2px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
        }
        [cmdk-group]:not([hidden]) ~ [cmdk-group] {
          margin-top: 4px;
        }
        [cmdk-item][data-selected="true"] {
          background-color: var(--accent-subtle);
          color: var(--accent);
        }
        [cmdk-item][data-selected="true"] [data-cmd-icon] {
          background-color: oklch(0.55 0.24 295 / 0.2);
          color: var(--accent);
        }
        [cmdk-item]:hover:not([aria-disabled="true"]) {
          background-color: var(--surface-2);
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommandItem
// ---------------------------------------------------------------------------

function CommandItem({
  cmd,
  onSelect,
}: {
  cmd: AppCommand;
  onSelect: (id: string) => void;
}) {
  return (
    <Command.Item
      value={cmd.id}
      keywords={cmd.keywords}
      onSelect={() => onSelect(cmd.id)}
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
      style={{
        color: "var(--text-primary)",
      }}
      data-cmd-item
    >
      <span
        data-cmd-icon
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
        style={{
          backgroundColor: "var(--surface-2)",
          color: "var(--text-secondary)",
        }}
      >
        <CommandIcon name={cmd.icon} size={13} />
      </span>
      <span className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        <span className="font-medium leading-tight">{cmd.label}</span>
        {cmd.description && (
          <span
            className="truncate text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            {cmd.description}
          </span>
        )}
      </span>
      {cmd.shortcut && <ShortcutHint keys={cmd.shortcut} />}
    </Command.Item>
  );
}

// ---------------------------------------------------------------------------
// Placeholder group (for sections not yet wired to tRPC)
// ---------------------------------------------------------------------------

function PlaceholderGroup({
  label,
  items = [],
}: {
  label: string;
  items?: string[];
}) {
  if (!items.length) {
    return (
      <Command.Group heading={label} className="px-2">
        <div
          className="px-3 py-2 text-xs italic"
          style={{ color: "var(--text-muted)" }}
        >
          — prochainement —
        </div>
      </Command.Group>
    );
  }
  return (
    <Command.Group heading={label} className="px-2">
      {items.map((item) => (
        <Command.Item
          key={item}
          disabled
          className="px-3 py-2 text-xs"
          style={{ color: "var(--text-muted)" }}
        >
          {item}
        </Command.Item>
      ))}
    </Command.Group>
  );
}
