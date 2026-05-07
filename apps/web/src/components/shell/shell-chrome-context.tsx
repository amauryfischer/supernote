"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

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
  const [rightPanelVisible, setRightPanelVisibleState] = useState(true);
  const [newNoteHandlers] = useState(() => new Set<() => void>());

  const setFocusMode = useCallback((next: boolean) => {
    setFocusModeState(next);
  }, []);

  const toggleFocusMode = useCallback(() => {
    setFocusModeState((v) => !v);
  }, []);

  const setRightPanelVisible = useCallback((next: boolean) => {
    setRightPanelVisibleState(next);
  }, []);

  const toggleRightPanel = useCallback(() => {
    setRightPanelVisibleState((v) => !v);
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
