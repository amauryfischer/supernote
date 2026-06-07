// Named colors shared by the color pickers (UI) and the markdown
// serializer/parser (round-trip). The NAMES are BlockNote's built-in style
// values (its default styleSpecs render them via @blocknote/react/style.css);
// the HEX values mirror that stylesheet exactly so what the user sees in
// the editor is what `<span style="color:…">` renders in Obsidian.
//
// Pure data module — no React — so serialization code can import it without
// dragging UI dependencies.

/** BlockNote text color name → hex (mirrors @blocknote/react/style.css). */
export const TEXT_COLOR_HEX: Record<string, string> = {
  gray: "#9b9a97",
  brown: "#64473a",
  red: "#e03e3e",
  orange: "#d9730d",
  yellow: "#dfab01",
  green: "#4d6461",
  blue: "#0b6e99",
  purple: "#6940a5",
  pink: "#ad1a72",
};

/** BlockNote background (highlight) color name → hex. */
export const HIGHLIGHT_COLOR_HEX: Record<string, string> = {
  gray: "#ebeced",
  brown: "#e9e5e3",
  red: "#fbe4e4",
  orange: "#f6e9d9",
  yellow: "#fbf3db",
  green: "#ddedea",
  blue: "#ddebf1",
  purple: "#eae4f2",
  pink: "#f4dfeb",
};

function invert(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, hex] of Object.entries(record)) out[hex] = name;
  return out;
}

const TEXT_NAME_BY_HEX = invert(TEXT_COLOR_HEX);
const HIGHLIGHT_NAME_BY_HEX = invert(HIGHLIGHT_COLOR_HEX);

/** Hex (any case) → BlockNote text color name, or undefined if unknown. */
export function textColorFromHex(hex: string): string | undefined {
  return TEXT_NAME_BY_HEX[hex.trim().toLowerCase()];
}

/** Hex (any case) → BlockNote highlight color name, or undefined. */
export function highlightColorFromHex(hex: string): string | undefined {
  return HIGHLIGHT_NAME_BY_HEX[hex.trim().toLowerCase()];
}
