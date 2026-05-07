"use client";

import { useEffect } from "react";

import { useShortcutContext } from "./ShortcutProvider";
import type { Shortcut } from "./types";

/** Register a single shortcut, cleaned up on unmount. */
export function useShortcut(shortcut: Shortcut): void {
  const { registerShortcut } = useShortcutContext();

  useEffect(() => {
    const unregister = registerShortcut(shortcut);
    return unregister;
    // We intentionally only register once — callers should memoize the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcut.id, shortcut.keys, shortcut.scope]);
}

/** Register multiple shortcuts at once, all cleaned up on unmount. */
export function useShortcuts(shortcuts: Shortcut[]): void {
  const { registerShortcut } = useShortcutContext();

  useEffect(() => {
    const unregisters = shortcuts.map((s) => registerShortcut(s));
    return () => unregisters.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcuts.map((s) => s.id + s.keys + (s.scope ?? "global")).join(",")]);
}
