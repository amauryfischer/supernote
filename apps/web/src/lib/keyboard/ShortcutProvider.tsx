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

const BLOCKED_BROWSER_COMBOS = new Set([
  "ctrl+w",
  "ctrl+shift+w",
  "meta+w",
  "meta+shift+w",
  "ctrl+t",
  "meta+t",
]);

const SEQUENCE_MS = 1500;

interface ShortcutRegistryEntry {
  shortcut: Shortcut;
  /** Un pas par élément : "g m" → ["g", "m"]. */
  steps: string[];
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    !!target.closest(
      "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]), textarea, select",
    ));

// Touche imprimable sans Ctrl/Cmd/Alt : appartient au champ focalisé ou à la modale ouverte.
const isBareKey = (combo: string) => !/(^|\+)(ctrl|meta|alt)\+/.test(combo) && combo.replace(/^shift\+/, "").length === 1;

interface ShortcutContextValue {
  registerShortcut: (s: Shortcut) => () => void;
  unregisterShortcut: (id: string) => void;
  listShortcuts: () => Shortcut[];
  pushScope: (scope: ShortcutScope) => void;
  popScope: (scope: ShortcutScope) => void;
  activeScope: ShortcutScope;
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

export function ShortcutProvider({ children }: { children: React.ReactNode }) {
  const shortcutsRef = useRef<Map<string, ShortcutRegistryEntry>>(new Map());
  const [scopeStack, setScopeStack] = useState<ShortcutScope[]>(["global"]);

  const activeScope: ShortcutScope = scopeStack[scopeStack.length - 1] ?? "global";

  const registerShortcut = useCallback((s: Shortcut): (() => void) => {
    const entry: ShortcutRegistryEntry = {
      shortcut: s,
      steps: s.keys.split(" ").filter(Boolean).map(normalizeCombo),
    };
    shortcutsRef.current.set(s.id, entry);
    return () => shortcutsRef.current.delete(s.id);
  }, []);

  const unregisterShortcut = useCallback((id: string) => {
    shortcutsRef.current.delete(id);
  }, []);

  const listShortcuts = useCallback(() => [...shortcutsRef.current.values()].map((e) => e.shortcut), []);

  const pendingRef = useRef<{ step: string; at: number } | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const setPending = useCallback((step: string | null, at = 0) => {
    pendingRef.current = step ? { step, at } : null;
    clearTimeout(pendingTimerRef.current);
    if (step) pendingTimerRef.current = setTimeout(() => setPending(null), SEQUENCE_MS);
    setPendingLabel(step);
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
      if (e.isComposing) return;
      const combo = comboFromEvent(e);

      if (BLOCKED_BROWSER_COMBOS.has(combo)) {
        e.preventDefault();
        return;
      }

      // Menu, liste ou popover ouvert (non modal) : les lettres y font de la recherche par frappe.
      const typing =
        isTyping(e.target) ||
        (e.target instanceof HTMLElement && !!e.target.closest("[role='menu'], [role='listbox'], [role='dialog']:not([aria-modal='true'])"));
      const modalOpen = !!document.querySelector("[aria-modal='true']");
      const eligible = (entry: ShortcutRegistryEntry) => {
        const scope = entry.shortcut.scope ?? "global";
        if (scope === "modal" && activeScope !== "modal") return false;
        if (scope === "editor" && activeScope !== "editor" && activeScope !== "modal") return false;
        const bare = entry.steps.every(isBareKey);
        return !bare || (!typing && (!modalOpen || scope === "modal"));
      };
      const run = (entry: ShortcutRegistryEntry) => {
        const stop = entry.shortcut.handler(e);
        if (stop !== false) e.preventDefault();
        if (stop === true) e.stopPropagation();
        return stop !== false;
      };

      const prefix = pendingRef.current && e.timeStamp - pendingRef.current.at < SEQUENCE_MS ? pendingRef.current.step : null;
      if (["control", "meta", "alt", "shift"].includes(e.key.toLowerCase())) return;
      setPending(null);
      const entries = [...shortcutsRef.current.values()].filter(eligible);
      if (prefix) {
        const seq = entries.find((en) => en.steps.length === 2 && en.steps[0] === prefix && en.steps[1] === combo);
        if (seq && run(seq)) return;
      }
      for (const entry of entries) {
        if (entry.steps.length === 1 && entry.steps[0] === combo && run(entry)) return;
      }
      // Préfixe non consommé : le mail garde ses propres accords `g i`, `g t`, `g s`.
      if (entries.some((en) => en.steps.length === 2 && en.steps[0] === combo)) setPending(combo, e.timeStamp);
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [activeScope, setPending]);

  const value = useMemo<ShortcutContextValue>(
    () => ({ registerShortcut, unregisterShortcut, listShortcuts, pushScope, popScope, activeScope }),
    [registerShortcut, unregisterShortcut, listShortcuts, pushScope, popScope, activeScope],
  );

  return (
    <ShortcutContext.Provider value={value}>
      {children}
      {pendingLabel && (
        <kbd
          aria-live="polite"
          className="pointer-events-none fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 rounded-md px-2 py-1 font-mono text-xs"
          style={{ backgroundColor: "var(--surface-3)", color: "var(--text-primary)", border: "1px solid var(--border)" }}
        >
          {pendingLabel} …
        </kbd>
      )}
    </ShortcutContext.Provider>
  );
}

export function useShortcutContext(): ShortcutContextValue {
  const ctx = useContext(ShortcutContext);
  if (!ctx) {
    throw new Error(
      "useShortcutContext must be called inside <ShortcutProvider>",
    );
  }
  return ctx;
}
