"use client";

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPod|iPad/.test(navigator.platform);

/**
 * Normalizes a key combo string into a canonical form for matching.
 * "mod+k" -> "ctrl+k" on Windows/Linux, "meta+k" on macOS.
 */
export function normalizeCombo(combo: string): string {
  return combo
    .toLowerCase()
    .split("+")
    .map((part) => {
      if (part === "mod") return isMac ? "meta" : "ctrl";
      return part;
    })
    .join("+");
}

/**
 * Builds the canonical key combo from a KeyboardEvent for comparison.
 */
export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.metaKey) parts.push("meta");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");

  const key = e.key.toLowerCase();
  // Avoid double-appending modifier keys themselves
  const modifiers = new Set(["control", "meta", "alt", "shift"]);
  if (!modifiers.has(key)) {
    parts.push(key);
  }
  return parts.join("+");
}
