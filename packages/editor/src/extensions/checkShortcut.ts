// Single-character markdown shortcut: typing `x ` at the start of an
// otherwise empty paragraph block converts it to a checkListItem. Mirrors
// BlockNote's built-in markdown shortcuts (`# ` → heading, `- ` → bullet,
// `[] ` → checklist) but with a one-character trigger for fast todo capture.
//
// Implementation: rather than fight the Tiptap InputRule lifecycle (which
// races with BlockNote's own block-update commands so an `editor.updateBlock`
// call from the rule handler silently no-ops), we register a lightweight
// `editor.onChange` watcher. After every committed change we look at the
// block under the caret; if it's a paragraph whose only content is the
// literal text "x ", we replace it with an empty checkListItem. This runs
// AFTER the user's keystroke has fully committed, so the BlockNote state
// is consistent and `updateBlock` always takes effect.

interface BlockLike {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string }>;
}

interface BlockNoteEditorLike {
  getTextCursorPosition: () => { block: BlockLike };
  updateBlock: (
    block: BlockLike,
    update: {
      type?: string;
      content?: unknown[];
      props?: Record<string, unknown>;
    },
  ) => void;
  setTextCursorPosition: (
    block: BlockLike | string,
    placement?: "start" | "end",
  ) => void;
  focus: () => void;
  onChange: (cb: () => void) => () => void;
}

/**
 * Wire the `x ` → checkListItem shortcut to a BlockNote editor instance.
 * Returns an unsubscribe function so callers can detach the watcher when
 * the editor is torn down (e.g. on note switch).
 */
export function attachCheckShortcut(editor: BlockNoteEditorLike): () => void {
  // Reentrancy guard: our own `updateBlock` call triggers the onChange
  // listener again; without this flag we'd recurse on every change.
  let converting = false;

  // Track IME composition. Mobile keyboards compose latin input
  // (autocorrect/suggestions), so typing "x " can reach the watcher while a
  // composition is still active; calling `updateBlock` then — which dispatches
  // a ProseMirror transaction that re-creates the node the composition is
  // anchored in — crashes the editor (white screen, no error boundary). We
  // skip conversion while composing; the browser fires a reconciling change at
  // compositionend, and we convert safely on that pass. Composition events
  // bubble to `document`, and only the focused editable composes, so a
  // document-level listener is sufficient. Mirrors SmoothCaret's approach.
  let composing = false;
  const onCompositionStart = () => {
    composing = true;
  };
  const onCompositionEnd = () => {
    composing = false;
  };
  if (typeof document !== "undefined") {
    document.addEventListener("compositionstart", onCompositionStart);
    document.addEventListener("compositionend", onCompositionEnd);
  }

  const unsubscribe = editor.onChange(() => {
    if (converting) return;
    if (composing) return;
    // Defer to the next microtask: BlockNote's onChange fires synchronously
    // during the ProseMirror transaction, before the document state and
    // cursor position are fully observable via the public API. Without the
    // defer, `getTextCursorPosition().block` would return a stale snapshot
    // and the "x " match would silently fail.
    queueMicrotask(() => {
      if (converting || composing) return;
      let block: BlockLike;
      try {
        block = editor.getTextCursorPosition().block;
      } catch {
        return;
      }
      if (block.type !== "paragraph") return;
      const content = block.content;
      if (!Array.isArray(content) || content.length !== 1) return;
      const first = content[0];
      if (!first || first.type !== "text") return;
      if (first.text !== "x ") return;
      converting = true;
      try {
        editor.updateBlock(block, {
          type: "checkListItem",
          content: [],
          props: { checked: false },
        });
        // BlockNote can park the caret at the end of the document after a
        // type swap, which forces the user to click back into the new
        // block. Re-anchor to the converted block (same id, refreshed via
        // start placement) on the next tick so the user can immediately
        // type the todo text.
        const reanchor = () => {
          try {
            editor.setTextCursorPosition(block.id, "start");
          } catch {
            /* ignore — block may have been removed mid-flight */
          }
        };
        setTimeout(() => {
          reanchor();
          // The converted block is a React NodeView whose contentDOM mounts
          // asynchronously. If it wasn't committed yet, ProseMirror leaves
          // the DOM selection at the blockGroup boundary — the visible
          // caret sits before the checkbox and ProseMirror may later adopt
          // the boundary as state, sending keystrokes to the WRONG block.
          // After two animation frames (React has committed by then), if
          // the editor still thinks the cursor is in the converted block
          // but the DOM selection disagrees, re-sync DOM ← state via
          // focus(). NEVER re-set the cursor position here: by now the
          // user may have typed — resetting to "start" would teleport the
          // caret mid-word.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              try {
                if (editor.getTextCursorPosition().block.id !== block.id) return;
                const sel = document.getSelection();
                const target = document.querySelector(`[data-id="${block.id}"]`);
                if (!target) return;
                if (!sel?.anchorNode || !target.contains(sel.anchorNode)) {
                  editor.focus();
                }
              } catch {
                /* editor torn down mid-flight */
              }
            });
          });
        }, 0);
      } catch {
        /* block may have been removed mid-flight; ignore */
      } finally {
        setTimeout(() => {
          converting = false;
        }, 0);
      }
    });
  });

  return () => {
    unsubscribe();
    if (typeof document !== "undefined") {
      document.removeEventListener("compositionstart", onCompositionStart);
      document.removeEventListener("compositionend", onCompositionEnd);
    }
  };
}
