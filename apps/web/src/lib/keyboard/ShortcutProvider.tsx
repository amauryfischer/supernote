"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { comboFromEvent, normalizeCombo } from "./normalize";
import type { Shortcut, ShortcutScope } from "./types";

// ---------------------------------------------------------------------------
// Browser shortcuts to block (prevent accidental tab/window close, etc.)
// ---------------------------------------------------------------------------
const BLOCKED_BROWSER_COMBOS = new Set([
  "ctrl+w",
  "ctrl+shift+w",
  "meta+w",
  "meta+shift+w",
  "ctrl+t",
  "meta+t",
]);

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ShortcutRegistryEntry {
  shortcut: Shortcut;
  normalizedKeys: string;
}

interface ShortcutContextValue {
  registerShortcut: (s: Shortcut) => () => void;
  unregisterShortcut: (id: string) => void;
  pushScope: (scope: ShortcutScope) => void;
  popScope: (scope: ShortcutScope) => void;
  activeScope: ShortcutScope;
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const shortcutsRef = useRef<Map<string, ShortcutRegistryEntry>>(new Map());
  const [scopeStack, setScopeStack] = useState<ShortcutScope[]>(["global"]);

  const activeScope: ShortcutScope = scopeStack[scopeStack.length - 1] ?? "global";

  const registerShortcut = useCallback((s: Shortcut): (() => void) => {
    const entry: ShortcutRegistryEntry = {
      shortcut: s,
      normalizedKeys: normalizeCombo(s.keys),
    };
    shortcutsRef.current.set(s.id, entry);
    return () => shortcutsRef.current.delete(s.id);
  }, []);

  const unregisterShortcut = useCallback((id: string) => {
    shortcutsRef.current.delete(id);
  }, []);

  const pushScope = useCallback((scope: ShortcutScope) => {
    setScopeStack((prev) => [...prev, scope]);
  }, []);

  const popScope = useCallback((scope: ShortcutScope) => {
    setScopeStack((prev) => {
      const idx = [...prev].lastIndexOf(scope);
      if (idx === -1) return prev;
      const next = [...prev];
      next.splice(idx, 1);
      return next;
    });
  }, []);

  // Global key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e);

      // Block certain browser-reserved combos
      if (BLOCKED_BROWSER_COMBOS.has(combo)) {
        e.preventDefault();
        return;
      }

      // Find matching shortcut respecting scope priority
      for (const entry of shortcutsRef.current.values()) {
        if (entry.normalizedKeys !== combo) continue;

        const scope = entry.shortcut.scope ?? "global";
        // Scope rules: modal > editor > global
        // A global shortcut fires unless a narrower scope is active.
        // A modal shortcut only fires when activeScope === 'modal'.
        if (scope === "modal" && activeScope !== "modal") continue;
        if (scope === "editor" && activeScope !== "editor" && activeScope !== "modal") continue;

        const stop = entry.shortcut.handler(e);
        if (stop !== false) {
          e.preventDefault();
        }
        if (stop === true) {
          e.stopPropagation();
        }
        return; // first match wins
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [activeScope]);

  const value = useMemo<ShortcutContextValue>(
    () => ({ registerShortcut, unregisterShortcut, pushScope, popScope, activeScope }),
    [registerShortcut, unregisterShortcut, pushScope, popScope, activeScope],
  );

  return (
    <ShortcutContext.Provider value={value}>
      {children}
    </ShortcutContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Internal hook — not exported from public barrel
// ---------------------------------------------------------------------------

export function useShortcutContext(): ShortcutContextValue {
  const ctx = useContext(ShortcutContext);
  if (!ctx) {
    throw new Error(
      "useShortcutContext must be called inside <ShortcutProvider>",
    );
  }
  return ctx;
}
