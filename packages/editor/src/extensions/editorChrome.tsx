// Editor chrome — the floating formatting toolbar and the per-block side
// menu (drag handle + add button). Both are absent by default because the
// app renders BlockNoteViewRaw without a theme package (no
// ComponentsContext), so we provide lightweight, theme-token-styled
// replacements.
//
// Native <button> justification (CLAUDE.md exception): both widgets live
// inside the editor's focus/selection lifecycle. Toolbar buttons must
// preventDefault on mousedown to keep the text selection alive, and the
// drag handle needs the raw `draggable` + DOM drag events that BlockNote's
// blockDragStart expects. HeroUI's react-aria Button intercepts pointer
// events in ways that break both.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  useBlockNoteEditor,
  useEditorSelectionBoundingBox,
  useEditorSelectionChange,
  useExtension,
  useExtensionState,
} from "@blocknote/react";
import { SideMenuExtension, SuggestionMenu } from "@blocknote/core/extensions";
import { ColorMenu, textSwatch } from "./colorMenu.js";
import {
  duplicateBlock,
  type BlockOpsEditorLike,
} from "./blockOpsShortcuts.js";
import { ACTION_META } from "../keymap/actions.js";

// ── Floating formatting toolbar ───────────────────────────────────────────────

interface FloatingFormattingToolbarProps {
  /** The `.sn-editor-wrapper` element the toolbar positions itself against. */
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}

type ToggleableStyle = "bold" | "italic" | "underline" | "strike" | "code";

const STYLE_BUTTONS: Array<{
  style: ToggleableStyle;
  label: string;
  title: string;
  render: React.ReactNode;
}> = [
  { style: "bold", label: "B", title: "Gras (Ctrl+B)", render: <strong>B</strong> },
  { style: "italic", label: "I", title: "Italique (Ctrl+I)", render: <em>I</em> },
  { style: "underline", label: "U", title: "Souligné (Ctrl+U)", render: <span style={{ textDecoration: "underline" }}>U</span> },
  { style: "strike", label: "S", title: "Barré", render: <span style={{ textDecoration: "line-through" }}>S</span> },
  { style: "code", label: "<>", title: "Code inline", render: <code style={{ fontSize: "0.85em" }}>{"<>"}</code> },
];

export function FloatingFormattingToolbar({ wrapperRef }: FloatingFormattingToolbarProps) {
  const editor = useBlockNoteEditor();
  // Re-render on every selection change so `hasSelection` and the active
  // style states stay current.
  const [, setSelectionVersion] = useState(0);
  useEditorSelectionChange(() => setSelectionVersion((v) => v + 1));

  // Hidden while the mouse button is down — the toolbar appears once the
  // user *finishes* dragging a selection (Notion behaviour), not during.
  const [pointerDown, setPointerDown] = useState(false);
  // Color palette dropdown (text + highlight). Anchored under the toolbar.
  const [colorOpen, setColorOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  // Opening the palette re-renders the toolbar, which mutates DOM inside the
  // BlockNote root and makes ProseMirror re-sync — collapsing the live
  // selection (the format buttons dodge this because toggleStyles re-asserts
  // the selection in a transaction; a pure setState toggle doesn't). So we
  // snapshot the selection (+ its box and active colors) the instant the user
  // opens the palette, keep the toolbar pinned at that box while it's open,
  // and restore the selection right before applying a color.
  const savedSelRef = useRef<{ from: number; to: number } | null>(null);
  const savedBoxRef = useRef<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const savedStylesRef = useRef<{
    textColor?: string;
    backgroundColor?: string;
  } | null>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      // A mousedown inside the toolbar (it preventDefaults) never reaches
      // here as a selection-killer; outside clicks close the palette.
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setColorOpen(false);
        setPointerDown(true);
      }
    };
    const up = () => setPointerDown(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setColorOpen(false);
    };
    document.addEventListener("mousedown", down);
    document.addEventListener("mouseup", up);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("mouseup", up);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  let hasSelection = false;
  try {
    hasSelection = editor.getSelectedText().length > 0;
  } catch {
    /* transient editor states (doc replacement) — treat as no selection */
  }
  const box = useEditorSelectionBoundingBox(hasSelection && !pointerDown);

  const handleLink = useCallback(() => {
    const current = editor.getSelectedLinkUrl() ?? "";
    // window.prompt keeps the selection alive (unlike a focus-stealing
    // modal) and is good enough for a v1 link affordance.
    const url = window.prompt("URL du lien :", current);
    if (url === null) return; // cancelled
    if (url.trim() === "") return;
    editor.createLink(url.trim());
  }, [editor]);

  // Snapshot the selection (+ active colors) before opening the palette, while
  // it's still alive. Box is captured separately during render below.
  const openColorMenu = useCallback(() => {
    try {
      const { from, to } = editor.prosemirrorState.selection;
      savedSelRef.current = from === to ? null : { from, to };
    } catch {
      savedSelRef.current = null;
    }
    savedStylesRef.current = editor.getActiveStyles() as {
      textColor?: string;
      backgroundColor?: string;
    };
    setColorOpen(true);
  }, [editor]);

  // Re-assert the snapshotted selection so the color lands on the text the
  // user picked, even though opening the palette collapsed the live selection.
  const restoreColorSelection = useCallback(() => {
    const sel = savedSelRef.current;
    if (!sel) return;
    try {
      editor._tiptapEditor.commands.setTextSelection(sel);
      editor._tiptapEditor.commands.focus();
    } catch {
      /* editor torn down between open and apply */
    }
  }, [editor]);

  const closeColorMenu = useCallback(() => {
    setColorOpen(false);
    savedSelRef.current = null;
    savedStylesRef.current = null;
    setSelectionVersion((v) => v + 1);
  }, []);

  // Keep the last valid selection box so the toolbar stays pinned while the
  // palette is open even if the selection momentarily collapses.
  if (box) {
    savedBoxRef.current = {
      top: box.top,
      left: box.left,
      width: box.width,
      height: box.height,
    };
  }
  const anchorBox = box ?? savedBoxRef.current;
  if (!colorOpen && (!hasSelection || pointerDown || !box)) return null;
  if (!anchorBox) return null;
  const wrapper = wrapperRef.current;
  if (!wrapper) return null;
  const wRect = wrapper.getBoundingClientRect();

  const activeStyles = editor.getActiveStyles() as Partial<
    Record<ToggleableStyle, boolean>
  > & { textColor?: string; backgroundColor?: string };
  const textTint = textSwatch(
    activeStyles.textColor ?? savedStylesRef.current?.textColor,
  );

  // Selections near the top of the editor flip the toolbar BELOW the text:
  // above would land on (or outside into) the fixed top toolbar.
  const flipBelow = anchorBox.top - wRect.top < 96;

  return (
    <div
      ref={toolbarRef}
      className={`sn-fmt-toolbar${flipBelow ? " sn-fmt-toolbar--below" : ""}`}
      style={{
        left: anchorBox.left - wRect.left + anchorBox.width / 2,
        top: flipBelow
          ? anchorBox.top - wRect.top + anchorBox.height + 8
          : anchorBox.top - wRect.top - 8,
      }}
      role="toolbar"
      aria-label="Mise en forme"
      // Keep the text selection: never let the toolbar steal focus.
      onMouseDown={(e) => e.preventDefault()}
    >
      {STYLE_BUTTONS.map((btn) => (
        <button
          key={btn.style}
          type="button"
          title={btn.title}
          aria-label={btn.title}
          aria-pressed={!!activeStyles[btn.style]}
          className="sn-fmt-toolbar__btn"
          data-active={activeStyles[btn.style] ? "true" : undefined}
          onClick={() => {
            editor.toggleStyles({ [btn.style]: true } as never);
            setSelectionVersion((v) => v + 1);
          }}
        >
          {btn.render}
        </button>
      ))}
      <span className="sn-fmt-toolbar__sep" />
      <button
        type="button"
        title="Couleur du texte et surlignage"
        aria-label="Couleur du texte et surlignage"
        aria-haspopup="menu"
        aria-expanded={colorOpen}
        className="sn-fmt-toolbar__btn sn-fmt-toolbar__color"
        data-active={colorOpen ? "true" : undefined}
        onClick={() => (colorOpen ? closeColorMenu() : openColorMenu())}
      >
        <span className="sn-fmt-toolbar__color-a" style={{ color: textTint }}>
          A
        </span>
        <span
          className="sn-fmt-toolbar__color-bar"
          style={{ background: textTint ?? "currentColor" }}
          aria-hidden
        />
      </button>
      <span className="sn-fmt-toolbar__sep" />
      <button
        type="button"
        title="Lien"
        aria-label="Créer un lien"
        className="sn-fmt-toolbar__btn"
        data-active={editor.getSelectedLinkUrl() ? "true" : undefined}
        onClick={handleLink}
      >
        🔗
      </button>
      {colorOpen && (
        <div className="sn-fmt-toolbar__colors">
          <ColorMenu
            editor={{
              // Show the colors active on the original selection, not the
              // collapsed one the palette open left behind.
              getActiveStyles: () =>
                savedStylesRef.current ??
                (editor.getActiveStyles() as {
                  textColor?: string;
                  backgroundColor?: string;
                }),
              // Put the user's selection back before colouring it.
              addStyles: (styles) => {
                restoreColorSelection();
                editor.addStyles(styles as Parameters<typeof editor.addStyles>[0]);
              },
              removeStyles: (styles) => {
                restoreColorSelection();
                editor.removeStyles(
                  styles as Parameters<typeof editor.removeStyles>[0],
                );
              },
            }}
            onApplied={closeColorMenu}
          />
        </div>
      )}
    </div>
  );
}

// ── Wikilink hover preview ────────────────────────────────────────────────────

const HOVER_PREVIEW_DELAY_MS = 400;

interface WikilinkHoverPreviewProps {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  previewEntity: (
    name: string,
  ) => Promise<{ title: string; excerpt: string } | null>;
}

interface PreviewState {
  x: number;
  y: number;
  title: string;
  excerpt: string;
}

/**
 * Notion-style hover card on `[[wikilinks]]`. Event delegation on the
 * wrapper (the pills are raw DOM nodes created by the inline spec, so a
 * React handler per pill isn't possible). 400ms intent delay, per-target
 * result cache, dismissed on mouse-out / scroll / click.
 */
export function WikilinkHoverPreview({
  wrapperRef,
  previewEntity,
}: WikilinkHoverPreviewProps) {
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const cacheRef = useRef(new Map<string, { title: string; excerpt: string } | null>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const clear = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    const hide = () => {
      clear();
      setPreview(null);
    };

    const onOver = (e: MouseEvent) => {
      const pill = (e.target as HTMLElement | null)?.closest?.(".sn-wikilink");
      if (!pill || !wrapper.contains(pill)) return;
      const target = pill.getAttribute("data-wikilink-target");
      if (!target) return;
      clear();
      timerRef.current = setTimeout(() => {
        void (async () => {
          let data = cacheRef.current.get(target);
          if (data === undefined) {
            try {
              data = await previewEntity(target);
            } catch {
              data = null;
            }
            cacheRef.current.set(target, data);
          }
          if (!data) return;
          // Position below the pill, wrapper-relative.
          const pillRect = pill.getBoundingClientRect();
          const wRect = wrapper.getBoundingClientRect();
          setPreview({
            x: pillRect.left - wRect.left,
            y: pillRect.bottom - wRect.top + 6,
            title: data.title,
            excerpt: data.excerpt,
          });
        })();
      }, HOVER_PREVIEW_DELAY_MS);
    };

    const onOut = (e: MouseEvent) => {
      const from = e.target as HTMLElement | null;
      const to = e.relatedTarget as HTMLElement | null;
      // Leaving a pill without entering the card (or vice versa) → hide.
      const fromRelevant = from?.closest?.(".sn-wikilink, .sn-wikilink-preview");
      if (!fromRelevant) return;
      if (to?.closest?.(".sn-wikilink, .sn-wikilink-preview")) return;
      hide();
    };

    wrapper.addEventListener("mouseover", onOver);
    wrapper.addEventListener("mouseout", onOut);
    wrapper.addEventListener("mousedown", hide);
    document.addEventListener("scroll", hide, true);
    return () => {
      wrapper.removeEventListener("mouseover", onOver);
      wrapper.removeEventListener("mouseout", onOut);
      wrapper.removeEventListener("mousedown", hide);
      document.removeEventListener("scroll", hide, true);
      clear();
    };
  }, [wrapperRef, previewEntity]);

  if (!preview) return null;
  return (
    <div
      className="sn-wikilink-preview"
      style={{ left: preview.x, top: preview.y }}
      role="tooltip"
    >
      <p className="sn-wikilink-preview__title">{preview.title}</p>
      {preview.excerpt && (
        <p className="sn-wikilink-preview__excerpt">{preview.excerpt}</p>
      )}
    </div>
  );
}

// ── Block menu (click on the ⠿ drag handle) ───────────────────────────────────
//
// The gesture #1 of Notion: clicking the drag handle opens a floating menu to
// transform / duplicate / colour / delete the block. Everything mutates the
// document through the BlockNote API (updateBlock / removeBlocks / insertBlocks)
// — NEVER by touching the ProseMirror DOM, which would trip its MutationObserver
// and loop. The menu itself is portalled to <body>, i.e. entirely OUTSIDE the
// editor subtree, so its own DOM churn is invisible to ProseMirror.

/** Minimal, schema-agnostic block shape the menu manipulates. */
interface BlockMenuBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

/**
 * Minimal slice of the BlockNote editor the menu drives. Cast from the strictly
 * (default-schema) typed `useBlockNoteEditor()` handle — same decoupling trick
 * as `BlockOpsEditorLike` — so we can target custom block types (callout,
 * codeBlock…) that the default schema type doesn't know about.
 */
interface BlockMenuEditor {
  updateBlock: (
    block: BlockMenuBlock,
    update: { type?: string; props?: Record<string, unknown> },
  ) => void;
  removeBlocks: (blocks: BlockMenuBlock[]) => void;
  getBlock: (blockId: string) => { props: Record<string, unknown> } | undefined;
}

/** "Transformer en" targets. Every type here keeps `content: "inline"`, so the
 *  block text is carried over by updateBlock (codeBlock is BlockNote's default
 *  inline-content code block, NOT our `codeHighlight` which stores code in a
 *  prop and would drop the text). */
interface TransformTarget {
  label: string;
  glyph: string;
  type: string;
  props?: Record<string, unknown>;
}

const TRANSFORM_TARGETS: readonly TransformTarget[] = [
  { label: "Texte", glyph: "¶", type: "paragraph" },
  { label: "Titre 1", glyph: "H1", type: "heading", props: { level: 1 } },
  { label: "Titre 2", glyph: "H2", type: "heading", props: { level: 2 } },
  { label: "Titre 3", glyph: "H3", type: "heading", props: { level: 3 } },
  { label: "Liste à puces", glyph: "•", type: "bulletListItem" },
  { label: "Liste numérotée", glyph: "1.", type: "numberedListItem" },
  { label: "Case à cocher", glyph: "☑", type: "checkListItem" },
  { label: "Citation", glyph: "❝", type: "quote" },
  { label: "Callout", glyph: "ℹ", type: "callout", props: { variant: "info" } },
  { label: "Bloc de code", glyph: "</>", type: "codeBlock" },
];

const IS_MAC =
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

/** Canonical combo ("mod+d") → display string ("⌘D" on mac, "Ctrl+D" else). */
function formatCombo(combo: string): string {
  if (!combo) return "";
  const map: Record<string, string> = IS_MAC
    ? { mod: "⌘", meta: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" }
    : { mod: "Ctrl", meta: "Ctrl", ctrl: "Ctrl", alt: "Alt", shift: "Shift" };
  const sep = IS_MAC ? "" : "+";
  return combo
    .toLowerCase()
    .split("+")
    .map((p) => map[p] ?? p.toUpperCase())
    .join(sep);
}

/** Display shortcut for a keymap action id, or "" when it has none. */
function shortcutFor(actionId: string): string {
  const meta = ACTION_META.find((a) => a.id === actionId);
  return meta ? formatCombo(meta.defaultCombo) : "";
}

/** Colour prop → active named colour (BlockNote stores "default" for none). */
function activeNamedColor(value: unknown): string | undefined {
  return typeof value === "string" && value !== "default" ? value : undefined;
}

type BlockMenuView = "root" | "transform" | "color";

interface BlockMenuProps {
  editor: BlockMenuEditor;
  opsEditor: BlockOpsEditorLike;
  block: BlockMenuBlock;
  /** Handle rect (viewport coords) the floating menu anchors against. */
  anchorRect: DOMRect;
  onClose: () => void;
}

/**
 * Floating menu anchored to a block's drag handle. Portalled to <body>, closes
 * on outside-click / Escape. Under 768px it presents as a bottom-sheet.
 */
function SupernoteBlockMenu({
  editor,
  opsEditor,
  block,
  anchorRect,
  onClose,
}: BlockMenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<BlockMenuView>("root");
  // Bumped after a colour is applied so the active swatch ring re-reads props.
  const [, setColorTick] = useState(0);

  const isSheet =
    typeof window !== "undefined" && window.innerWidth < 768;

  // Desktop floating position — measured then clamped to the viewport. The
  // sheet variant ignores this (pinned to the bottom by CSS).
  const [pos, setPos] = useState<{ left: number; top: number }>(() => ({
    left: anchorRect.right + 6,
    top: anchorRect.top,
  }));
  useLayoutEffect(() => {
    if (isSheet) return;
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchorRect.right + gap;
    if (left + r.width > vw - 8) left = anchorRect.left - r.width - gap;
    if (left < 8) left = 8;
    let top = anchorRect.top;
    if (top + r.height > vh - 8) top = Math.max(8, vh - r.height - 8);
    setPos({ left, top });
  }, [anchorRect, view, isSheet]);

  // Outside-click + Escape. Escape steps back out of a submenu first.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (view === "root") onClose();
        else setView("root");
      }
    };
    // Defer the down-listener a tick so the opening click doesn't self-close.
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", onDown);
    }, 0);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [view, onClose]);

  const applyTransform = useCallback(
    (t: TransformTarget) => {
      try {
        editor.updateBlock(block, { type: t.type, props: t.props });
      } catch {
        /* schema rejected (transient state) — no-op */
      }
      onClose();
    },
    [editor, block, onClose],
  );

  const handleDuplicate = useCallback(() => {
    try {
      duplicateBlock(opsEditor, block);
    } catch {
      /* best-effort */
    }
    onClose();
  }, [opsEditor, block, onClose]);

  const handleDelete = useCallback(() => {
    try {
      editor.removeBlocks([block]);
    } catch {
      /* best-effort */
    }
    onClose();
  }, [editor, block, onClose]);

  // ColorMenu adapter — operates on the block's own colour props instead of an
  // inline text selection. Reads live props via getBlock so the active ring
  // stays correct across repeated picks.
  const colorAdapter = {
    getActiveStyles: () => {
      const props = editor.getBlock(block.id)?.props ?? block.props;
      return {
        textColor: activeNamedColor(props.textColor),
        backgroundColor: activeNamedColor(props.backgroundColor),
      };
    },
    addStyles: (styles: Record<string, string>) => {
      try {
        editor.updateBlock(block, { props: { ...styles } });
      } catch {
        /* best-effort */
      }
      setColorTick((n) => n + 1);
    },
    removeStyles: (styles: Record<string, string>) => {
      const cleared: Record<string, string> = {};
      for (const key of Object.keys(styles)) cleared[key] = "default";
      try {
        editor.updateBlock(block, { props: cleared });
      } catch {
        /* best-effort */
      }
      setColorTick((n) => n + 1);
    },
  };

  // Keep the block's text selection intact: never let the menu steal focus.
  const noStealMouseDown = (e: React.MouseEvent) => e.preventDefault();

  const panel = (
    <div
      ref={panelRef}
      className={`sn-block-menu${isSheet ? " sn-block-menu--sheet" : ""}`}
      style={isSheet ? undefined : { left: pos.left, top: pos.top }}
      role="menu"
      aria-label="Actions du bloc"
      onMouseDown={noStealMouseDown}
    >
      {view === "root" && (
        <>
          <button
            type="button"
            role="menuitem"
            className="sn-block-menu__item"
            aria-haspopup="menu"
            onMouseDown={noStealMouseDown}
            onClick={() => setView("transform")}
          >
            <span className="sn-block-menu__icon" aria-hidden>
              ⇄
            </span>
            <span className="sn-block-menu__label">Transformer en</span>
            <span className="sn-block-menu__chevron" aria-hidden>
              ›
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="sn-block-menu__item"
            onMouseDown={noStealMouseDown}
            onClick={handleDuplicate}
          >
            <span className="sn-block-menu__icon" aria-hidden>
              ⧉
            </span>
            <span className="sn-block-menu__label">Dupliquer</span>
            {shortcutFor("block-ops.duplicate") && (
              <span className="sn-block-menu__shortcut">
                {shortcutFor("block-ops.duplicate")}
              </span>
            )}
          </button>
          <button
            type="button"
            role="menuitem"
            className="sn-block-menu__item"
            aria-haspopup="menu"
            onMouseDown={noStealMouseDown}
            onClick={() => setView("color")}
          >
            <span className="sn-block-menu__icon" aria-hidden>
              A
            </span>
            <span className="sn-block-menu__label">Couleur</span>
            <span className="sn-block-menu__chevron" aria-hidden>
              ›
            </span>
          </button>
          <div className="sn-block-menu__sep" />
          <button
            type="button"
            role="menuitem"
            className="sn-block-menu__item sn-block-menu__item--danger"
            onMouseDown={noStealMouseDown}
            onClick={handleDelete}
          >
            <span className="sn-block-menu__icon" aria-hidden>
              ✕
            </span>
            <span className="sn-block-menu__label">Supprimer</span>
          </button>
        </>
      )}

      {view === "transform" && (
        <>
          <button
            type="button"
            className="sn-block-menu__back"
            onMouseDown={noStealMouseDown}
            onClick={() => setView("root")}
          >
            <span aria-hidden>‹</span> Transformer en
          </button>
          {TRANSFORM_TARGETS.map((t) => (
            <button
              key={t.label}
              type="button"
              role="menuitem"
              className={`sn-block-menu__item${
                t.type === block.type ? " sn-block-menu__item--current" : ""
              }`}
              onMouseDown={noStealMouseDown}
              onClick={() => applyTransform(t)}
            >
              <span className="sn-block-menu__icon" aria-hidden>
                {t.glyph}
              </span>
              <span className="sn-block-menu__label">{t.label}</span>
            </button>
          ))}
        </>
      )}

      {view === "color" && (
        <>
          <button
            type="button"
            className="sn-block-menu__back"
            onMouseDown={noStealMouseDown}
            onClick={() => setView("root")}
          >
            <span aria-hidden>‹</span> Couleur du bloc
          </button>
          <ColorMenu editor={colorAdapter} />
        </>
      )}
    </div>
  );

  return createPortal(
    isSheet ? (
      <div
        className="sn-block-menu__backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {panel}
      </div>
    ) : (
      panel
    ),
    document.body,
  );
}

// ── Side menu (drag handle + add block) ───────────────────────────────────────

/**
 * Custom side-menu body rendered by BlockNote's <SideMenuController> next to
 * the hovered block. Three affordances, Notion-style:
 *   - `+` inserts a paragraph after the block (or reuses it when empty) and
 *     opens the slash menu so the user picks a block type immediately.
 *   - `⠿` clicked → opens the block menu (transform / duplicate / colour /
 *     delete); dragged → moves the block (BlockNote's own drag machinery).
 *
 * MOBILE TODO: the hover side menu never appears on touch. To reach the SAME
 * <SupernoteBlockMenu> from a long-press, SupernoteEditor's wrapper
 * `onContextMenu` (already wired for AI) needs to: resolve the block under the
 * pointer (`editor.getBlock` from `event.target.closest("[data-id]")`) and
 * render <SupernoteBlockMenu> with an anchorRect at the pointer. The menu
 * already self-presents as a bottom-sheet under 768px, so no extra UI is
 * needed — only the trigger, which lives outside this file's scope.
 */
export function SupernoteSideMenu() {
  const editor = useBlockNoteEditor();
  const sideMenu = useExtension(SideMenuExtension);
  const suggestionMenu = useExtension(SuggestionMenu);
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  });

  const dragRef = useRef<HTMLButtonElement | null>(null);
  // Non-null while the block menu is open — holds the handle rect to anchor to.
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);

  const handleAdd = useCallback(() => {
    if (!block) return;
    const content = block.content;
    const isEmpty = Array.isArray(content) && content.length === 0;
    if (isEmpty) {
      editor.setTextCursorPosition(block);
    } else {
      const inserted = editor.insertBlocks([{ type: "paragraph" }], block, "after")[0];
      if (inserted) editor.setTextCursorPosition(inserted);
    }
    editor.focus();
    suggestionMenu.openSuggestionMenu("/");
  }, [block, editor, suggestionMenu]);

  // Open the block menu on a plain click of the handle. Freeze the side menu so
  // it stays pinned to this block while the (portalled) menu is open.
  const openBlockMenu = useCallback(() => {
    const el = dragRef.current;
    if (!el) return;
    sideMenu.freezeMenu();
    setMenuAnchor(el.getBoundingClientRect());
  }, [sideMenu]);

  const closeBlockMenu = useCallback(() => {
    setMenuAnchor(null);
    sideMenu.unfreezeMenu();
  }, [sideMenu]);

  if (!block) return null;

  return (
    <div className="sn-side-menu" contentEditable={false}>
      <button
        type="button"
        className="sn-side-menu__btn"
        aria-label="Ajouter un bloc"
        title="Ajouter un bloc"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleAdd}
      >
        +
      </button>
      <button
        ref={dragRef}
        type="button"
        className="sn-side-menu__btn sn-side-menu__drag"
        aria-label="Options du bloc"
        aria-haspopup="menu"
        aria-expanded={menuAnchor != null}
        title="Cliquer pour les options · glisser pour déplacer"
        draggable
        onDragStart={(e) => sideMenu.blockDragStart(e, block)}
        onDragEnd={() => sideMenu.blockDragEnd()}
        onClick={openBlockMenu}
      >
        ⠿
      </button>
      {menuAnchor && (
        <SupernoteBlockMenu
          editor={editor as unknown as BlockMenuEditor}
          opsEditor={editor as unknown as BlockOpsEditorLike}
          block={block as unknown as BlockMenuBlock}
          anchorRect={menuAnchor}
          onClose={closeBlockMenu}
        />
      )}
    </div>
  );
}
