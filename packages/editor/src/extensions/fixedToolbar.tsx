// Fixed top toolbar — a Word-style mini toolbox pinned (sticky) above the
// note while writing. Block type switcher, inline marks, colors, link and
// undo/redo. Complements the floating selection toolbar in editorChrome.tsx
// (which handles the "select then format" flow); this one is always at hand.
//
// Receives the editor instance as a prop (structural typing, same pattern
// as checkShortcut.ts) instead of useBlockNoteEditor(): the toolbar is
// rendered OUTSIDE BlockNoteViewRaw so it can sit above the editor in the
// DOM and use `position: sticky` against the note's scroll container.
//
// Native <button> justification (CLAUDE.md exception): same as the floating
// toolbar — every control must preventDefault on mousedown so the caret /
// selection in the editor survives the click. react-aria's Button focus
// handling breaks that contract.

import React, { useEffect, useRef, useState } from "react";
import { ColorMenu, textSwatch, highlightSwatch } from "./colorMenu.js";

// ── Minimal editor surface the toolbar needs ─────────────────────────────────

interface BlockLike {
  id: string;
  type: string;
  props?: Record<string, unknown>;
}

export interface FixedToolbarEditorLike {
  onChange: (cb: () => void) => (() => void) | undefined;
  onSelectionChange: (cb: () => void) => () => void;
  getTextCursorPosition: () => { block: BlockLike };
  updateBlock: (
    block: BlockLike,
    update: { type?: string; props?: Record<string, unknown> },
  ) => void;
  getActiveStyles: () => Record<string, unknown>;
  toggleStyles: (styles: Record<string, boolean>) => void;
  addStyles: (styles: Record<string, string>) => void;
  removeStyles: (styles: Record<string, string>) => void;
  getSelectedLinkUrl: () => string | undefined;
  createLink: (url: string) => void;
  focus: () => void;
  undo: () => void;
  redo: () => void;
}

// ── Block type catalogue ──────────────────────────────────────────────────────

interface BlockTypeEntry {
  key: string;
  label: string;
  /** Compact glyph shown in the dropdown trigger + rows. */
  glyph: string;
  type: string;
  props?: Record<string, unknown>;
}

const BLOCK_TYPES: BlockTypeEntry[] = [
  { key: "paragraph", label: "Texte", glyph: "¶", type: "paragraph" },
  { key: "h1", label: "Titre 1", glyph: "H1", type: "heading", props: { level: 1 } },
  { key: "h2", label: "Titre 2", glyph: "H2", type: "heading", props: { level: 2 } },
  { key: "h3", label: "Titre 3", glyph: "H3", type: "heading", props: { level: 3 } },
  { key: "bullet", label: "Liste à puces", glyph: "•", type: "bulletListItem" },
  { key: "numbered", label: "Liste numérotée", glyph: "1.", type: "numberedListItem" },
  { key: "todo", label: "À faire", glyph: "☐", type: "checkListItem", props: { checked: false } },
  { key: "quote", label: "Citation", glyph: "❝", type: "quote" },
];

function matchBlockType(block: BlockLike | null): BlockTypeEntry {
  if (!block) return BLOCK_TYPES[0]!;
  const found = BLOCK_TYPES.find((bt) => {
    if (bt.type !== block.type) return false;
    if (bt.type === "heading") return block.props?.level === bt.props?.level;
    return true;
  });
  return found ?? BLOCK_TYPES[0]!;
}

// ── Small inline icons (stroke follows currentColor) ─────────────────────────

function UndoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 14 4 9l5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m15 14 5-5-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function HighlighterIcon({ tint }: { tint?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="m9 11-4.5 4.5L3 21l5.5-1.5L13 15M9 11l6.5-6.5a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3L13 15M9 11l4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Ink bar under the pen — reflects the active highlight color. */}
      <rect x="3" y="22" width="18" height="2" rx="1" fill={tint ?? "currentColor"} opacity={tint ? 1 : 0.25} />
    </svg>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

type ToggleableStyle = "bold" | "italic" | "underline" | "strike" | "code";

const STYLE_BUTTONS: Array<{ style: ToggleableStyle; title: string; render: React.ReactNode }> = [
  { style: "bold", title: "Gras (Ctrl+B)", render: <strong>B</strong> },
  { style: "italic", title: "Italique (Ctrl+I)", render: <em>I</em> },
  { style: "underline", title: "Souligné (Ctrl+U)", render: <span style={{ textDecoration: "underline" }}>U</span> },
  { style: "strike", title: "Barré", render: <span style={{ textDecoration: "line-through" }}>S</span> },
  { style: "code", title: "Code inline", render: <code style={{ fontSize: "0.85em" }}>{"<>"}</code> },
];

type OpenMenu = "type" | "color" | null;

interface FixedToolbarProps {
  editor: FixedToolbarEditorLike;
}

export function FixedToolbar({ editor }: FixedToolbarProps) {
  // Re-render on every selection AND content change so the block-type label,
  // active marks and color indicators stay current (content changes matter
  // for undo/redo and programmatic style application).
  const [, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const offChange = editor.onChange(bump);
    const offSelection = editor.onSelectionChange(bump);
    return () => {
      offChange?.();
      offSelection();
    };
  }, [editor]);

  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close any open dropdown on outside mousedown or Escape.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  let currentBlock: BlockLike | null = null;
  try {
    currentBlock = editor.getTextCursorPosition().block;
  } catch {
    /* document replacement in flight — render with defaults */
  }
  const currentType = matchBlockType(currentBlock);

  let activeStyles: Partial<Record<ToggleableStyle, boolean>> & {
    textColor?: string;
    backgroundColor?: string;
  } = {};
  try {
    activeStyles = editor.getActiveStyles() as typeof activeStyles;
  } catch {
    /* same — transient states */
  }

  const setBlockType = (bt: BlockTypeEntry) => {
    if (!currentBlock) return;
    try {
      editor.updateBlock(currentBlock, { type: bt.type, props: bt.props ?? {} });
    } catch {
      /* schema may reject during transient states */
    }
    setOpenMenu(null);
    editor.focus();
  };

  const handleLink = () => {
    const current = editor.getSelectedLinkUrl() ?? "";
    const url = window.prompt("URL du lien :", current);
    if (url === null || url.trim() === "") return;
    editor.createLink(url.trim());
  };

  const textTint = textSwatch(activeStyles.textColor);
  const highlightTint = highlightSwatch(activeStyles.backgroundColor);

  return (
    <div
      ref={rootRef}
      className="sn-top-toolbar"
      role="toolbar"
      aria-label="Mise en forme de la note"
      // Keep the editor's caret/selection alive for every control.
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Block type dropdown */}
      <div className="sn-top-toolbar__group">
        <button
          type="button"
          className="sn-top-toolbar__btn sn-top-toolbar__type"
          title="Type de bloc"
          aria-haspopup="menu"
          aria-expanded={openMenu === "type"}
          data-active={openMenu === "type" ? "true" : undefined}
          onClick={() => setOpenMenu(openMenu === "type" ? null : "type")}
        >
          <span className="sn-top-toolbar__type-glyph">{currentType.glyph}</span>
          <span className="sn-top-toolbar__type-label">{currentType.label}</span>
          <span className="sn-top-toolbar__caret" aria-hidden>
            ▾
          </span>
        </button>
        {openMenu === "type" && (
          <div className="sn-top-toolbar__menu" role="menu" aria-label="Type de bloc">
            {BLOCK_TYPES.map((bt) => (
              <button
                key={bt.key}
                type="button"
                role="menuitem"
                className="sn-top-toolbar__menu-item"
                data-active={bt.key === currentType.key ? "true" : undefined}
                onClick={() => setBlockType(bt)}
              >
                <span className="sn-top-toolbar__menu-glyph">{bt.glyph}</span>
                {bt.label}
                {bt.key === currentType.key && (
                  <span className="sn-top-toolbar__menu-check" aria-hidden>
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="sn-top-toolbar__sep" />

      {/* Inline marks */}
      <div className="sn-top-toolbar__group">
        {STYLE_BUTTONS.map((btn) => (
          <button
            key={btn.style}
            type="button"
            className="sn-top-toolbar__btn"
            title={btn.title}
            aria-label={btn.title}
            aria-pressed={!!activeStyles[btn.style]}
            data-active={activeStyles[btn.style] ? "true" : undefined}
            onClick={() => editor.toggleStyles({ [btn.style]: true })}
          >
            {btn.render}
          </button>
        ))}
      </div>

      <span className="sn-top-toolbar__sep" />

      {/* Colors */}
      <div className="sn-top-toolbar__group">
        <button
          type="button"
          className="sn-top-toolbar__btn sn-top-toolbar__color-btn"
          title="Couleur du texte"
          aria-haspopup="menu"
          aria-expanded={openMenu === "color"}
          data-active={openMenu === "color" ? "true" : undefined}
          onClick={() => setOpenMenu(openMenu === "color" ? null : "color")}
        >
          <span className="sn-top-toolbar__color-a" style={{ color: textTint }}>
            A
          </span>
          <span
            className="sn-top-toolbar__color-bar"
            style={{ background: textTint ?? "currentColor" }}
            aria-hidden
          />
        </button>
        <button
          type="button"
          className="sn-top-toolbar__btn"
          title="Surlignage"
          aria-haspopup="menu"
          aria-expanded={openMenu === "color"}
          onClick={() => setOpenMenu(openMenu === "color" ? null : "color")}
        >
          <HighlighterIcon tint={highlightTint} />
        </button>
        {openMenu === "color" && (
          <div className="sn-top-toolbar__menu sn-top-toolbar__menu--colors">
            <ColorMenu editor={editor} onApplied={() => setOpenMenu(null)} />
          </div>
        )}
      </div>

      <span className="sn-top-toolbar__sep" />

      {/* Link + history */}
      <div className="sn-top-toolbar__group">
        <button
          type="button"
          className="sn-top-toolbar__btn"
          title="Créer un lien"
          aria-label="Créer un lien"
          data-active={editor.getSelectedLinkUrl() ? "true" : undefined}
          onClick={handleLink}
        >
          🔗
        </button>
        <button
          type="button"
          className="sn-top-toolbar__btn"
          title="Annuler (Ctrl+Z)"
          aria-label="Annuler"
          onClick={() => editor.undo()}
        >
          <UndoIcon />
        </button>
        <button
          type="button"
          className="sn-top-toolbar__btn"
          title="Rétablir (Ctrl+Shift+Z)"
          aria-label="Rétablir"
          onClick={() => editor.redo()}
        >
          <RedoIcon />
        </button>
      </div>
    </div>
  );
}
