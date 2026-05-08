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
  const [newNoteHandlers] = useState(() => new Set<() => void>());

  // Hydrate from localStorage once on mount so a refresh does not reopen
  // a panel the user previously closed.
  useEffect(() => {
    const stored = readRightPanelPreference();
    setRightPanelVisibleState(stored);
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
