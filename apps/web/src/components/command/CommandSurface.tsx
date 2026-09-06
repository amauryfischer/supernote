"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppTheme } from "@supernote/ui";

import { useShortcut } from "@/lib/keyboard/hooks";
import { useRegisterCommands } from "@/lib/commands/hooks";
import { buildSeedCommands } from "@/lib/commands/seed";
import { UnifiedSearchModal } from "@/components/mail/UnifiedSearchModal";
import { todayJournalDate } from "@/lib/journal-live-entry";
import { QuickCaptureOverlay } from "./QuickCaptureOverlay";

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
  const [captureOpen, setCaptureOpen] = useState(false);

  const navigate = useNavigate();
  const { theme, setTheme, resolvedTheme } = useAppTheme();

  // Les commandes sont enregistrées une fois (useRegisterCommands ne réagit qu'au
  // changement d'id) → toggleTheme doit être stable ET lire le thème COURANT via
  // un ref, sinon il figerait le thème initial et ne basculerait plus.
  const themeRef = useRef(resolvedTheme ?? theme);
  themeRef.current = resolvedTheme ?? theme;
  const toggleTheme = useCallback(() => {
    setTheme(themeRef.current === "dark" ? "light" : "dark");
  }, [setTheme]);
  // CommandSurface vit hors du ShellChromeProvider (celui-ci est dans AppShell,
  // sous l'Outlet) → on passe par un event window que shell-chrome-context écoute.
  const toggleRightPanel = useCallback(() => {
    window.dispatchEvent(new CustomEvent("supernote:toggle-right-panel"));
  }, []);
  // « today » figé au montage (yyyy-mm-dd) — suffisant pour la note du jour.
  const today = useMemo(todayJournalDate, []);

  // Commandes liées aux vraies actions (navigation SPA, thème, chrome).
  const commands = useMemo(
    () => buildSeedCommands({ navigate, toggleTheme, toggleRightPanel, today }),
    [navigate, toggleTheme, toggleRightPanel, today],
  );
  useRegisterCommands(commands);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  // Identité stable : une flèche inline réarmerait le timer de fermeture de la
  // capture à chaque rendu de ce composant.
  const closeCapture = useCallback(() => setCaptureOpen(false), []);

  // useShortcut n'enregistre le handler qu'une fois (deps id/keys/scope) : la
  // closure capture `paletteOpen=false` pour toujours. On lit l'état courant via
  // un ref pour que le handler Échap voie la vraie valeur.
  const paletteOpenRef = useRef(paletteOpen);
  paletteOpenRef.current = paletteOpen;

  // Listen for the TopBar button's custom event ("Recherche rapide" click)
  useEffect(() => {
    const handler = () => setPaletteOpen(true);
    window.addEventListener("supernote:open-command-palette", handler);
    return () => window.removeEventListener("supernote:open-command-palette", handler);
  }, []);

  // Recherche unifiée : Cmd+Shift+K n'a aucune affordance visible et est
  // inaccessible au tactile. Un event window permet de l'ouvrir depuis le
  // MoreDrawer mobile et une action de header (cf. shell mobile).
  useEffect(() => {
    const handler = () => setUnifiedOpen(true);
    window.addEventListener("supernote:open-unified-search", handler);
    return () => window.removeEventListener("supernote:open-unified-search", handler);
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
      if (paletteOpenRef.current) {
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

  // Capture rapide. ⚠️ Pas `mod+shift+n` : Chrome, Edge, Firefox et Safari le
  // confisquent tous (fenêtre de navigation privée) et la page ne le reçoit
  // jamais.
  useShortcut({
    id: "capture.open",
    keys: "mod+alt+c",
    scope: "global",
    description: "Capture rapide dans l'entrée du jour",
    handler: () => {
      setCaptureOpen(true);
      return true;
    },
  });

  useEffect(() => {
    const handler = () => setCaptureOpen(true);
    window.addEventListener("supernote:open-quick-capture", handler);
    return () => window.removeEventListener("supernote:open-quick-capture", handler);
  }, []);

  // Cmd+N — handled inside the notes view (see /notes & /notes/[id]) so it
  // can call the real `handleNewNote` with the active folder. Registering it
  // globally here would shadow the per-page handler (first-match-wins).

  // Cmd+D — PAS de binding global : il masquait « recopier vers le bas » du
  // DataGrid (et c'est un raccourci navigateur). La « Note du jour » reste
  // accessible via la palette.

  // Cmd+Shift+F — recherche globale (navigation SPA vers /recherche).
  useShortcut({
    id: "shortcut.search.open",
    keys: "mod+shift+f",
    scope: "global",
    description: "Recherche globale",
    handler: () => {
      navigate("/recherche");
      return true;
    },
  });

  // Only mount the dynamic palette when it's actually been opened at least
  // once — `dynamic` will fetch the chunk only when this branch first renders.
  return (
    <>
      {paletteOpen && <CommandPalette open={paletteOpen} onClose={closePalette} />}
      <UnifiedSearchModal isOpen={unifiedOpen} onClose={() => setUnifiedOpen(false)} />
      <QuickCaptureOverlay isOpen={captureOpen} onClose={closeCapture} />
    </>
  );
}
