"use client";

import { useCallback, useEffect, useState } from "react";

import { useShortcut } from "@/lib/keyboard/hooks";
import { useRegisterCommands } from "@/lib/commands/hooks";
import { SEED_COMMANDS } from "@/lib/commands/seed";
import { CommandPalette } from "./CommandPalette";

/**
 * CommandSurface registers all seed commands, wires up global keyboard
 * shortcuts (Cmd+K to open palette, Esc to close), and renders the palette
 * overlay.
 *
 * Mount this once at the app root level. It renders no visible chrome by
 * itself — only the portal-like overlay when the palette is open.
 */
export function CommandSurface() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Register seed commands
  useRegisterCommands(SEED_COMMANDS);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  // Listen for the TopBar button's custom event ("Recherche rapide" click)
  useEffect(() => {
    const handler = () => setPaletteOpen(true);
    window.addEventListener("supernote:open-command-palette", handler);
    return () => window.removeEventListener("supernote:open-command-palette", handler);
  }, []);

  // Cmd+K / Ctrl+K — open command palette
  useShortcut({
    id: "palette.open",
    keys: "mod+k",
    scope: "global",
    description: "Ouvrir la palette de commandes",
    handler: () => {
      setPaletteOpen((prev) => !prev);
      return true;
    },
  });

  // Esc — close palette (when it's open, scope shifts to modal but we handle it here)
  useShortcut({
    id: "palette.close",
    keys: "esc",
    scope: "global",
    description: "Fermer la palette de commandes",
    handler: () => {
      if (paletteOpen) {
        closePalette();
        return true;
      }
      return false;
    },
  });

  // Cmd+Shift+P — open palette (VS Code style alternative)
  useShortcut({
    id: "palette.open-alt",
    keys: "mod+shift+p",
    scope: "global",
    description: "Ouvrir la palette de commandes (alternatif)",
    handler: () => {
      openPalette();
      return true;
    },
  });

  // Cmd+N — new note shortcut
  useShortcut({
    id: "shortcut.note.create",
    keys: "mod+n",
    scope: "global",
    description: "Nouvelle note",
    handler: () => {
      const cmd = SEED_COMMANDS.find((c) => c.id === "note.create");
      if (cmd) void cmd.run();
      return true;
    },
  });

  // Cmd+D — daily note shortcut
  useShortcut({
    id: "shortcut.note.create-daily",
    keys: "mod+d",
    scope: "global",
    description: "Note du jour",
    handler: () => {
      const cmd = SEED_COMMANDS.find((c) => c.id === "note.create-daily");
      if (cmd) void cmd.run();
      return true;
    },
  });

  // Cmd+Shift+F — global search
  useShortcut({
    id: "shortcut.search.open",
    keys: "mod+shift+f",
    scope: "global",
    description: "Recherche globale",
    handler: () => {
      const cmd = SEED_COMMANDS.find((c) => c.id === "search.open");
      if (cmd) void cmd.run();
      return true;
    },
  });

  return <CommandPalette open={paletteOpen} onClose={closePalette} />;
}
