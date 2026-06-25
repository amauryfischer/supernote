"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";

import { useShortcut } from "@/lib/keyboard/hooks";
import { useRegisterCommands } from "@/lib/commands/hooks";
import { SEED_COMMANDS } from "@/lib/commands/seed";
import { UnifiedSearchModal } from "@/components/mail/UnifiedSearchModal";

// CommandPalette pulls in the entire command catalogue UI; defer it until the
// user actually opens the palette. The first Cmd+K mounts it; subsequent opens
// reuse the loaded chunk.
const CommandPalette = dynamic(
  () => import("./CommandPalette").then((m) => ({ default: m.CommandPalette })),
  { ssr: false },
);

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
  const [unifiedOpen, setUnifiedOpen] = useState(false);

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

  // Cmd+K / Ctrl+K — open command palette.
  // Exception : du texte sélectionné DANS l'éditeur → Cmd+K est le préfixe
  // du chord IA (Cmd+K Cmd+R reformater, etc.). On rend la main (return
  // false → pas de stopPropagation) pour que le listener de l'éditeur
  // reçoive l'événement et arme le chord.
  useShortcut({
    id: "palette.open",
    keys: "mod+k",
    scope: "global",
    description: "Ouvrir la palette de commandes",
    handler: (e) => {
      const target = e.target as HTMLElement | null;
      const inEditor = !!target?.closest?.(".sn-editor-wrapper");
      const hasTextSelection = !(window.getSelection()?.isCollapsed ?? true);
      if (inEditor && hasTextSelection) return false;
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

  // Cmd+Shift+K — recherche unifiée (emails + notes + bases). Cmd+K est déjà
  // pris par la palette de commandes : on prend un combo libre dédié.
  useShortcut({
    id: "search.unified",
    keys: "mod+shift+k",
    scope: "global",
    description: "Recherche unifiée (emails, notes, bases)",
    handler: () => {
      setUnifiedOpen((prev) => !prev);
      return true;
    },
  });

  // Cmd+N — handled inside the notes view (see /notes & /notes/[id]) so it
  // can call the real `handleNewNote` with the active folder. Registering it
  // globally here would shadow the per-page handler (first-match-wins).

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

  // Only mount the dynamic palette when it's actually been opened at least
  // once — `dynamic` will fetch the chunk only when this branch first renders.
  return (
    <>
      {paletteOpen && <CommandPalette open={paletteOpen} onClose={closePalette} />}
      <UnifiedSearchModal isOpen={unifiedOpen} onClose={() => setUnifiedOpen(false)} />
    </>
  );
}
