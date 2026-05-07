"use client";

export type ShortcutScope = "global" | "editor" | "modal";

export interface Shortcut {
  id: string;
  /** Keyboard combo, e.g. "mod+k", "mod+shift+p", "esc" */
  keys: string;
  scope?: ShortcutScope;
  description: string;
  /**
   * Return `true` to stop event propagation after handling.
   * Return `void` / `false` to allow further handlers.
   */
  handler: (e: KeyboardEvent) => void | boolean;
}
