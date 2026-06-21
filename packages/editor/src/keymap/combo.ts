const MODIFIERS: Record<string, string> = {
  mod: "Mod",
  ctrl: "Ctrl",
  meta: "Mod", // Tiptap résout Mod selon la plateforme
  alt: "Alt",
  shift: "Shift",
};

const KEY_ALIASES: Record<string, string> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

/** "mod+shift+s" -> "Mod-Shift-s" (format keymap Tiptap). "" -> "". */
export function canonicalToTiptap(combo: string): string {
  if (!combo) return "";
  return combo
    .toLowerCase()
    .split("+")
    .map((p) => MODIFIERS[p] ?? KEY_ALIASES[p] ?? p)
    .join("-");
}
