"use client";

export type ShortcutScope = "global" | "editor" | "modal";

export interface Shortcut {
  id: string;
  /** Combo ("mod+k", "esc") ou séquence de deux pas séparés par un espace ("g m"). */
  keys: string;
  scope?: ShortcutScope;
  description: string;
  /**
   * Return `true` to stop event propagation after handling.
   * Return `void` / `false` to allow further handlers.
   */
  handler: (e: KeyboardEvent) => void | boolean;
}
