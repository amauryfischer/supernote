// Pressing Enter inside a checkListItem should produce another checkListItem,
// not a plain paragraph — same UX as Notion / Obsidian.
//
// We could intercept Enter via a Tiptap keymap extension and re-implement
// the split, but BlockNote's default Enter behavior already does the heavy
// lifting. So we let BlockNote do its thing and convert the resulting
// paragraph after the fact — same trick as `checkShortcut.ts`.
//
// CRITICAL: the conversion must ONLY fire when the user actually pressed
// Enter. Otherwise Backspace in an empty checkListItem (which BlockNote
// converts to a paragraph as its standard "exit list" gesture) would be
// reverted back to a checkListItem — making it impossible to delete a
// checklist item by backspacing on its empty line. We tag the Enter key
// via a tiny Tiptap extension that flips a module-level flag; the
// post-commit watcher only acts when the flag is set.

import { Extension } from "@tiptap/core";
import { trace } from "../freeze-trace.js";

// Module-scope flag — set by the Enter keymap extension below, read+cleared
// by the post-commit watcher. Set to a timestamp so a stale flag from
// >150ms ago is ignored (defensive against a missed clear in error paths).
let lastEnterAt = 0;

/**
 * Tiptap extension that tags every Enter keypress so the watcher can
 * distinguish Enter-driven block changes from any other change (Backspace
 * in particular). Returns `false` so BlockNote's default Enter handling
 * still runs — we don't want to intercept the actual key behavior.
 */
export const enterTagExtension = Extension.create({
  name: "supernoteEnterTag",
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        lastEnterAt = Date.now();
        return false;
      },
    };
  },
});

interface BlockLike {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: Array<{ type?: string; text?: string }>;
}

interface BlockNoteEditorLike {
  getTextCursorPosition: () => { block: BlockLike; prevBlock: BlockLike | null };
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

/** True when a block carries no real text (empty content or only blank text nodes). */
function isBlockEmpty(block: BlockLike): boolean {
  const c = block.content;
  if (!Array.isArray(c) || c.length === 0) return true;
  return c.every(
    (n) => n?.type === "text" && (typeof n.text !== "string" || n.text.length === 0),
  );
}

/**
 * Wire the "Enter continues the checklist" behavior to a BlockNote editor.
 * Returns an unsubscribe function so callers can detach the watcher when
 * the editor is torn down (e.g. on note switch).
 */
export function attachContinueChecklistOnEnter(
  editor: BlockNoteEditorLike,
): () => void {
  // Re-entrancy guard: our own `updateBlock` triggers onChange again.
  let converting = false;

  // Skip conversion while an IME composition is active — mutating the doc
  // mid-composition crashes ProseMirror on mobile keyboards. See the detailed
  // note in checkShortcut.ts. compositionend fires a reconciling change and we
  // convert safely then.
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
    // Only act when the change was driven by Enter — Backspace, paste,
    // formatting toggles etc. would otherwise also flip a freshly-created
    // paragraph back into a checkListItem and break those interactions.
    // 150ms is a generous window covering React's commit + microtask drain
    // without ever spilling into a subsequent unrelated change.
    if (Date.now() - lastEnterAt > 150) return;
    queueMicrotask(() => {
      if (converting || composing) return;
      if (Date.now() - lastEnterAt > 150) return;
      let cursor: { block: BlockLike; prevBlock: BlockLike | null };
      try {
        cursor = editor.getTextCursorPosition();
      } catch {
        return;
      }
      const { block, prevBlock } = cursor;
      // The block we want to convert is the freshly-created paragraph that
      // landed under the cursor right after the user pressed Enter.
      if (block.type !== "paragraph") return;
      if (!prevBlock || prevBlock.type !== "checkListItem") return;
      // Don't convert if the previous checkListItem ended up empty — that
      // means the user pressed Enter on an empty line to exit the list,
      // which is the standard "leave the list" gesture in every editor.
      if (isBlockEmpty(prevBlock)) return;
      // Consume the flag so a subsequent unrelated change doesn't trigger
      // another conversion (one Enter → one conversion).
      lastEnterAt = 0;

      converting = true;
      trace("editor:continueChecklist");
      try {
        editor.updateBlock(block, {
          type: "checkListItem",
          // Preserve any text the user split off mid-line.
          content: block.content as unknown[] | undefined,
          props: { checked: false },
        });
        // Re-anchor the caret AT THE START of the converted block. After
        // a type swap BlockNote sometimes parks the cursor at the document
        // end; without this the user has to click back into the new item.
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
          // Drop the guard on the next tick so a real subsequent Enter
          // can be processed.
          setTimeout(() => {
            converting = false;
          }, 0);
        }, 0);
      } catch {
        converting = false;
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
