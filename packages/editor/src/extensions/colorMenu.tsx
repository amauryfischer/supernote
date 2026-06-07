// Color palette menu — shared by the floating formatting toolbar and the
// fixed top toolbar. Lets the user set the text color and the highlight
// (background) color of the current selection.
//
// The color VALUES are BlockNote's built-in named colors (gray…pink): the
// default styleSpecs render `[data-style-type=textColor][data-value=…]`
// spans whose actual colors ship with @blocknote/react/style.css. Keeping
// the names means zero custom serialization work and markdown round-trips
// stay stable.
//
// Native <button> justification (CLAUDE.md exception): the menu lives inside
// the editor's selection lifecycle — every control preventDefaults on
// mousedown so the text selection (what the user is colouring) survives the
// click. HeroUI/react-aria buttons intercept pointer events and steal focus.

import React from "react";
import { TEXT_COLOR_HEX, HIGHLIGHT_COLOR_HEX } from "../serialization/colors.js";

export interface NamedColor {
  /** BlockNote style value (also the CSS hook in their stylesheet). */
  value: string;
  /** French label for the tooltip. */
  label: string;
  /** Swatch color shown in the picker (mirrors BlockNote's stylesheet). */
  swatch: string;
}

/** French labels for BlockNote's named colors. */
const COLOR_LABELS: Record<string, string> = {
  gray: "Gris",
  brown: "Brun",
  red: "Rouge",
  orange: "Orange",
  yellow: "Jaune",
  green: "Vert",
  blue: "Bleu",
  purple: "Violet",
  pink: "Rose",
};

function toNamedColors(hexByName: Record<string, string>): NamedColor[] {
  return Object.entries(hexByName).map(([value, swatch]) => ({
    value,
    label: COLOR_LABELS[value] ?? value,
    swatch,
  }));
}

// Hex values live in serialization/colors.ts (shared with the markdown
// round-trip) so picker and persistence can never drift apart.
export const TEXT_COLORS: NamedColor[] = toNamedColors(TEXT_COLOR_HEX);

export const HIGHLIGHT_COLORS: NamedColor[] = toNamedColors(HIGHLIGHT_COLOR_HEX);

/** Resolve a named text color to its swatch hex (for button indicators). */
export function textSwatch(value: string | undefined): string | undefined {
  return TEXT_COLORS.find((c) => c.value === value)?.swatch;
}

/** Resolve a named highlight color to its swatch hex. */
export function highlightSwatch(value: string | undefined): string | undefined {
  return HIGHLIGHT_COLORS.find((c) => c.value === value)?.swatch;
}

/** Minimal slice of the BlockNote editor the menu needs. */
interface ColorMenuEditorLike {
  getActiveStyles: () => { textColor?: string; backgroundColor?: string };
  addStyles: (styles: Record<string, string>) => void;
  removeStyles: (styles: Record<string, string>) => void;
}

interface ColorMenuProps {
  editor: ColorMenuEditorLike;
  /** Called after a color is applied (host usually closes the menu). */
  onApplied?: () => void;
}

/**
 * Two labeled swatch rows: text color, then highlight. Designed to be
 * rendered inside a `.sn-color-menu` positioned container by the host
 * toolbar (which also owns open/close + outside-click logic).
 */
export function ColorMenu({ editor, onApplied }: ColorMenuProps) {
  let active: { textColor?: string; backgroundColor?: string } = {};
  try {
    active = editor.getActiveStyles();
  } catch {
    /* transient editor states — treat as no active color */
  }

  const applyText = (value: string | null) => {
    if (value) {
      editor.addStyles({ textColor: value });
    } else {
      editor.removeStyles({ textColor: "" });
    }
    onApplied?.();
  };

  const applyHighlight = (value: string | null) => {
    if (value) {
      editor.addStyles({ backgroundColor: value });
    } else {
      editor.removeStyles({ backgroundColor: "" });
    }
    onApplied?.();
  };

  return (
    <div className="sn-color-menu" role="menu" aria-label="Couleurs">
      <p className="sn-color-menu__label">Texte</p>
      <div className="sn-color-menu__row">
        <button
          type="button"
          className="sn-color-menu__swatch sn-color-menu__swatch--none"
          title="Couleur par défaut"
          aria-label="Couleur de texte par défaut"
          data-active={!active.textColor || undefined}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyText(null)}
        >
          A
        </button>
        {TEXT_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            className="sn-color-menu__swatch sn-color-menu__swatch--text"
            style={{ color: c.swatch }}
            title={c.label}
            aria-label={`Texte ${c.label.toLowerCase()}`}
            data-active={active.textColor === c.value || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyText(c.value)}
          >
            A
          </button>
        ))}
      </div>
      <p className="sn-color-menu__label">Surlignage</p>
      <div className="sn-color-menu__row">
        <button
          type="button"
          className="sn-color-menu__swatch sn-color-menu__swatch--none"
          title="Aucun surlignage"
          aria-label="Aucun surlignage"
          data-active={!active.backgroundColor || undefined}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => applyHighlight(null)}
        >
          <span className="sn-color-menu__slash" aria-hidden />
        </button>
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            className="sn-color-menu__swatch sn-color-menu__swatch--bg"
            style={{ background: c.swatch }}
            title={c.label}
            aria-label={`Surlignage ${c.label.toLowerCase()}`}
            data-active={active.backgroundColor === c.value || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyHighlight(c.value)}
          />
        ))}
      </div>
    </div>
  );
}
