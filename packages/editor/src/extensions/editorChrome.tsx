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

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useBlockNoteEditor,
  useEditorSelectionBoundingBox,
  useEditorSelectionChange,
  useExtension,
  useExtensionState,
} from "@blocknote/react";
import { SideMenuExtension, SuggestionMenu } from "@blocknote/core/extensions";
import { ColorMenu, textSwatch } from "./colorMenu.js";

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

  if (!hasSelection || pointerDown || !box) return null;
  const wrapper = wrapperRef.current;
  if (!wrapper) return null;
  const wRect = wrapper.getBoundingClientRect();

  const activeStyles = editor.getActiveStyles() as Partial<
    Record<ToggleableStyle, boolean>
  > & { textColor?: string; backgroundColor?: string };
  const textTint = textSwatch(activeStyles.textColor);

  // Selections near the top of the editor flip the toolbar BELOW the text:
  // above would land on (or outside into) the fixed top toolbar.
  const flipBelow = box.top - wRect.top < 96;

  return (
    <div
      ref={toolbarRef}
      className={`sn-fmt-toolbar${flipBelow ? " sn-fmt-toolbar--below" : ""}`}
      style={{
        left: box.left - wRect.left + box.width / 2,
        top: flipBelow
          ? box.top - wRect.top + box.height + 8
          : box.top - wRect.top - 8,
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
        onClick={() => setColorOpen((o) => !o)}
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
            editor={editor as never}
            onApplied={() => {
              setColorOpen(false);
              setSelectionVersion((v) => v + 1);
            }}
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

// ── Side menu (drag handle + add block) ───────────────────────────────────────

/**
 * Custom side-menu body rendered by BlockNote's <SideMenuController> next to
 * the hovered block. Two affordances, Notion-style:
 *   - `+` inserts a paragraph after the block (or reuses it when empty) and
 *     opens the slash menu so the user picks a block type immediately.
 *   - `⠿` drags the block (BlockNote's own drag machinery via
 *     blockDragStart/blockDragEnd).
 */
export function SupernoteSideMenu() {
  const editor = useBlockNoteEditor();
  const sideMenu = useExtension(SideMenuExtension);
  const suggestionMenu = useExtension(SuggestionMenu);
  const block = useExtensionState(SideMenuExtension, {
    selector: (state) => state?.block,
  });

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
        type="button"
        className="sn-side-menu__btn sn-side-menu__drag"
        aria-label="Déplacer le bloc"
        title="Glisser pour déplacer"
        draggable
        onDragStart={(e) => sideMenu.blockDragStart(e, block)}
        onDragEnd={() => sideMenu.blockDragEnd()}
      >
        ⠿
      </button>
    </div>
  );
}
