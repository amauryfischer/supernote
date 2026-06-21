import { normalizeCombo } from "@/lib/keyboard/normalize";

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPod|iPad/.test(navigator.platform);

const GLYPH: Record<string, string> = isMac
  ? {
      meta: "⌘",
      mod: "⌘",
      ctrl: "⌃",
      alt: "⌥",
      shift: "⇧",
      arrowup: "↑",
      arrowdown: "↓",
      arrowleft: "←",
      arrowright: "→",
    }
  : {
      meta: "Win",
      mod: "Ctrl",
      ctrl: "Ctrl",
      alt: "Alt",
      shift: "Shift",
      arrowup: "↑",
      arrowdown: "↓",
      arrowleft: "←",
      arrowright: "→",
    };

/** Canonical combo ("mod+shift+s") → human glyph string ("⌘⇧S" / "Ctrl+Shift+S"). */
export function prettyCombo(canonical: string): string {
  if (!canonical) return "";
  const parts = normalizeCombo(canonical)
    .split("+")
    .map((p) => GLYPH[p] ?? p.toUpperCase());
  return isMac ? parts.join("") : parts.join("+");
}

/** Capture from ShortcutRow ("Cmd+Shift+S") → canonical ("mod+shift+s"). */
export function toCanonicalCombo(captured: string): string {
  return captured
    .toLowerCase()
    .split("+")
    .map((p) => (p === "cmd" || p === "ctrl" || p === "meta" ? "mod" : p))
    .join("+");
}
