"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/**
 * localStorage key for the user's right-panel visibility preference.
 * Persisted so that closing the panel survives a refresh / navigation.
 */
const RIGHT_PANEL_STORAGE_KEY = "supernote.shell.rightPanel";

function readRightPanelPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(RIGHT_PANEL_STORAGE_KEY);
    if (raw === null) return true;
    return raw === "true";
  } catch {
    return true;
  }
}

function writeRightPanelPreference(next: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RIGHT_PANEL_STORAGE_KEY, next ? "true" : "false");
  } catch {
    // ignore quota / disabled-storage errors
  }
}

interface ShellChromeContextValue {
  /** When true, sidebar and right panel dim/collapse so the user can focus on writing. */
  focusMode: boolean;
  setFocusMode: (next: boolean) => void;
  toggleFocusMode: () => void;

  /** Right panel can be hidden by the user (via the X button or topbar toggle). */
  rightPanelVisible: boolean;
  toggleRightPanel: () => void;
  setRightPanelVisible: (next: boolean) => void;

  /**
   * Accent CSS-variable overrides published by deep child routes (e.g. the
   * notes detail page when the selected folder has a custom color). The
   * AppShell merges them into its outermost element style, so sidebar /
   * topbar / right panel inherit the tint along with the editor pane.
   */
  accentOverride: Record<string, string> | null;
  setAccentOverride: (next: Record<string, string> | null) => void;

  /** Bus to ask the home page to focus its writing canvas (e.g. from the topbar "Nouveau" button). */
  requestNewNote: () => void;
  onRequestNewNote: (handler: () => void) => () => void;
}

const ShellChromeContext = createContext<ShellChromeContextValue | null>(null);

export function ShellChromeProvider({ children }: { children: React.ReactNode }) {
  const [focusMode, setFocusModeState] = useState(false);
  // Default to true on the server / first paint to avoid a flash of "panel
  // hidden" before we can read localStorage. The effect below reconciles
  // with the persisted user preference on mount.
  const [rightPanelVisible, setRightPanelVisibleState] = useState(true);
  const [accentOverride, setAccentOverrideState] = useState<Record<string, string> | null>(null);
  const [newNoteHandlers] = useState(() => new Set<() => void>());

  // Hydrate from localStorage once on mount so a refresh does not reopen
  // a panel the user previously closed.
  useEffect(() => {
    const stored = readRightPanelPreference();
    setRightPanelVisibleState(stored);
  }, []);

  // Global keyboard shortcut: Ctrl/Cmd + . toggles focus mode. We pick "."
  // because it's free in every page (Cmd+K is search, Cmd+S save, Cmd+Z
  // undo, …) and visually maps to "more / fewer chrome" affordances. The
  // listener runs at the document level so it works regardless of which
  // editor / input has focus.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== "." && e.code !== "Period") return;
      e.preventDefault();
      setFocusModeState((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setFocusMode = useCallback((next: boolean) => {
    setFocusModeState(next);
  }, []);

  const toggleFocusMode = useCallback(() => {
    setFocusModeState((v) => !v);
  }, []);

  const setRightPanelVisible = useCallback((next: boolean) => {
    setRightPanelVisibleState(next);
    writeRightPanelPreference(next);
  }, []);

  const toggleRightPanel = useCallback(() => {
    setRightPanelVisibleState((v) => {
      const next = !v;
      writeRightPanelPreference(next);
      return next;
    });
  }, []);

  // Stable identity per (vars-shape) so AppShell's `style={...}` doesn't
  // get a fresh object on every parent render — keeps the merge cheap.
  const setAccentOverride = useCallback(
    (next: Record<string, string> | null) => {
      setAccentOverrideState((prev) => {
        if (prev === next) return prev;
        if (!prev || !next) return next;
        const a = Object.entries(prev).sort();
        const b = Object.entries(next).sort();
        if (a.length !== b.length) return next;
        for (let i = 0; i < a.length; i++) {
          if (a[i]![0] !== b[i]![0] || a[i]![1] !== b[i]![1]) return next;
        }
        return prev;
      });
    },
    [],
  );

  const requestNewNote = useCallback(() => {
    newNoteHandlers.forEach((h) => h());
  }, [newNoteHandlers]);

  const onRequestNewNote = useCallback(
    (handler: () => void) => {
      newNoteHandlers.add(handler);
      return () => {
        newNoteHandlers.delete(handler);
      };
    },
    [newNoteHandlers],
  );

  const value = useMemo<ShellChromeContextValue>(
    () => ({
      focusMode,
      setFocusMode,
      toggleFocusMode,
      rightPanelVisible,
      toggleRightPanel,
      setRightPanelVisible,
      accentOverride,
      setAccentOverride,
      requestNewNote,
      onRequestNewNote,
    }),
    [
      focusMode,
      setFocusMode,
      toggleFocusMode,
      rightPanelVisible,
      toggleRightPanel,
      setRightPanelVisible,
      accentOverride,
      setAccentOverride,
      requestNewNote,
      onRequestNewNote,
    ],
  );

  return (
    <ShellChromeContext.Provider value={value}>
      {children}
    </ShellChromeContext.Provider>
  );
}

export function useShellChrome(): ShellChromeContextValue {
  const ctx = useContext(ShellChromeContext);
  if (!ctx) {
    throw new Error(
      "useShellChrome must be called from a component nested in ShellChromeProvider",
    );
  }
  return ctx;
}
