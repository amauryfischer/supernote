// Main SupernoteEditor component
// BlockNote wrapper with custom blocks, slash menu, and serialization

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Block } from "@blocknote/core";
import { fr as blocknoteFr } from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import {
  BlockNoteViewRaw,
  SideMenuController,
  SuggestionMenuController,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { supernoteSchema } from "./schema.js";
import {
  DatabaseViewProvider,
  useDatabaseBlockPickListener,
  FormulaProvider,
  EmbedProvider,
  DoodleProvider,
} from "./blocks/index.js";
import { markdownToBlocks, blocksToMarkdown } from "./serialization/index.js";
import {
  SupernoteSuggestionMenu,
  getSupernoteSlashMenuItems,
  getMentionMenuItems,
  useEntityPickerState,
} from "./extensions/slashMenu.js";
import type { EntityLinkItemConfig } from "./extensions/slashMenu.js";
import { createSaveExtension } from "./extensions/saveShortcut.js";
import { blockNavExtension } from "./extensions/blockNavShortcuts.js";
import {
  createBlockOpsExtension,
  type BlockOpsEditorLike,
} from "./extensions/blockOpsShortcuts.js";
import { attachCheckShortcut } from "./extensions/checkShortcut.js";
import { smartTypographyExtension } from "./extensions/smartTypography.js";
import {
  attachContinueChecklistOnEnter,
  enterTagExtension,
} from "./extensions/continueChecklistOnEnter.js";
import type { SupernoteEditorProps } from "./types.js";
import { useAIAction } from "./ai/useAIAction.js";
import { AIActionsMenu } from "./ai/AIActionsMenu.js";
import { SmoothCaret } from "./SmoothCaret.js";
import {
  FloatingFormattingToolbar,
  SupernoteSideMenu,
  WikilinkHoverPreview,
} from "./extensions/editorChrome.js";
import { FixedToolbar } from "./extensions/fixedToolbar.js";
import type { AIActionId } from "@supernote/ai/actions";
import type { StreamingInsertHandle } from "./types.js";

/** Main Supernote rich-text editor */
export function SupernoteEditor(props: SupernoteEditorProps): React.JSX.Element {
  const {
    initialMarkdown,
    onChange,
    onSave,
    readOnly = false,
    className,
    resolvers,
    onAskAi,
    onEditorReady,
    onStreamingInsertReady,
    dimInactiveBlocks = false,
    topToolbar = false,
    placeholder,
    renderDatabaseView,
    renderFormula,
    renderEmbed,
    renderDoodle,
    aiClient,
    aiPromptResolver,
    noteTitle,
    onAIError,
    onAIWarning,
    smartTypography = true,
  } = props;

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const onAskAiRef = useRef(onAskAi);
  onAskAiRef.current = onAskAi;

  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;

  // Wrapper element — anchor for the SmoothCaret overlay (and any future
  // editor-relative chrome).
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Kept for CSS hooks that must not fire during the initial render
  // (e.g. future entry effects). Block-entry animation itself is JS-driven
  // below — see the new-block tracker.
  const [live, setLive] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLive(true), 250);
    return () => clearTimeout(t);
  }, []);

  const handleSave = useCallback(() => {
    onSaveRef.current?.(editor.document ? blocksToMarkdown(editor.document as Block[]) : "");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Guard initialContent: BlockNote throws "Error creating document from
  // blocks passed as 'initialContent'" when the array is empty or the
  // blocks fail validation against the schema. Pass `undefined` to let
  // BlockNote create its own default empty document instead.
  const initialBlocks = (() => {
    if (!initialMarkdown) return undefined;
    try {
      const blocks = markdownToBlocks(initialMarkdown) as any[];
      return blocks.length > 0 ? blocks : undefined;
    } catch (err) {
      console.warn("[SupernoteEditor] markdownToBlocks failed, falling back to empty document", err);
      return undefined;
    }
  })();

  // BlockNote 0.50 ships per-locale dictionaries for every UI string,
  // including the empty-document placeholder. We default to French (the host
  // app's primary language) and swap the `default` placeholder when the
  // caller passes a custom one — that's how the home WritingSurface gets
  // "Commencez à écrire…" while a regular note keeps the verbose default.
  const dictionary = (() => {
    if (!placeholder) return blocknoteFr;
    return {
      ...blocknoteFr,
      placeholders: {
        ...blocknoteFr.placeholders,
        default: placeholder,
      },
    };
  })();

  // Les extensions Tiptap sont instanciées AVANT l'éditeur BlockNote ;
  // blockOps a besoin de son API (move/duplicate) → getter résolu à la frappe.
  const blockNoteRef = useRef<BlockOpsEditorLike | null>(null);

  const editor = useCreateBlockNote(
    {
      schema: supernoteSchema,
      initialContent: initialBlocks,
      dictionary,
      _tiptapOptions: {
        extensions: [
          createSaveExtension(handleSave),
          enterTagExtension,
          blockNavExtension,
          createBlockOpsExtension(() => blockNoteRef.current),
          // Remplacements typographiques à la frappe (->, --, ..., (c)…).
          // Désactivable via la prop `smartTypography`.
          ...(smartTypography ? [smartTypographyExtension] : []),
        ],
      },
    },
    []
  );
  blockNoteRef.current = editor as unknown as BlockOpsEditorLike;

  // `x ` → checkListItem shortcut. Implemented as a post-commit watcher on
  // BlockNote's onChange (rather than a Tiptap input rule) because the
  // input rule's transaction races with BlockNote's own block-update
  // commands, leaving the type swap as a silent no-op.
  useEffect(() => {
    return attachCheckShortcut(editor as unknown as Parameters<typeof attachCheckShortcut>[0]);
  }, [editor]);

  // Pressing Enter inside a checkListItem produces another checkListItem
  // instead of a plain paragraph. Same post-commit watcher pattern as the
  // `x ` shortcut above so we don't fight BlockNote's transaction lifecycle.
  useEffect(() => {
    return attachContinueChecklistOnEnter(
      editor as unknown as Parameters<typeof attachContinueChecklistOnEnter>[0],
    );
  }, [editor]);

  // Wire up onChange
  useEffect(() => {
    return editor.onChange(() => {
      const md = blocksToMarkdown(editor.document as Block[]);
      onChangeRef.current?.(md, editor.document as Block[]);
    });
  }, [editor]);

  // Garantit qu'un block éditable termine toujours le document. Sans ça,
  // un `databaseView` (contentEditable=false) en dernière position bloque
  // tout clic sous le bloc — l'utilisateur ne peut pas créer de nouveau
  // contenu en dessous de la base.
  useEffect(() => {
    const NON_EDITABLE_TRAILING = new Set(["databaseView"]);
    const ensureTrailingParagraph = () => {
      const doc = editor.document as Block[];
      const last = doc[doc.length - 1];
      if (!last) return;
      if (!NON_EDITABLE_TRAILING.has(last.type as string)) return;
      try {
        editor.insertBlocks(
          [{ type: "paragraph" } as any],
          last as any,
          "after",
        );
      } catch {
        /* schema may reject during transient states — best-effort */
      }
    };
    ensureTrailingParagraph();
    return editor.onChange(ensureTrailingParagraph);
  }, [editor]);

  // Flash freshly inserted blocks (accent tint fading out) so the user sees
  // exactly what just landed — used by both the one-shot insert below and
  // the streaming-insert end() path.
  const flashBlocks = useCallback((ids: Array<string | undefined>) => {
    requestAnimationFrame(() => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      for (const id of ids) {
        if (!id) continue;
        const el = wrapper.querySelector(`[data-id="${id}"]`);
        if (!el) continue;
        el.classList.add("sn-block-flash");
        el.addEventListener(
          "animationend",
          () => el.classList.remove("sn-block-flash"),
          { once: true },
        );
      }
    });
  }, []);

  // Expose an imperative insert function to the host once the editor mounts.
  useEffect(() => {
    if (!onEditorReadyRef.current) return;
    const insertAtCursor = (md: string) => {
      const paragraphs = md.split(/\n\n+/).map((s) => s.trim()).filter(Boolean);
      const blocks = paragraphs.map((text) => {
        try {
          const parsed = markdownToBlocks(text) as Block[];
          return parsed.length > 0 ? parsed[0]! : ({ type: "paragraph", content: [{ type: "text", text, styles: {} }] } as unknown as Block);
        } catch {
          return { type: "paragraph", content: [{ type: "text", text, styles: {} }] } as unknown as Block;
        }
      });
      if (blocks.length === 0) return;
      const inserted = editor.insertBlocks(
        blocks as any[],
        editor.getTextCursorPosition().block,
        "after"
      );
      flashBlocks(((inserted ?? []) as Array<{ id?: string }>).map((b) => b.id));
    };
    onEditorReadyRef.current(insertAtCursor);
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Streaming insert — used by the host's "Demander à l'IA" flow to write
  // the model's answer token by token instead of dumping it at the end.
  // The live block holds the raw accumulated text (cheap plain-text updates,
  // rAF-coalesced); end() re-parses it as markdown so headings/lists/etc.
  // get their final rich rendering, then flashes the result.
  const onStreamingInsertReadyRef = useRef(onStreamingInsertReady);
  onStreamingInsertReadyRef.current = onStreamingInsertReady;
  useEffect(() => {
    if (!onStreamingInsertReadyRef.current) return;
    const begin = (): StreamingInsertHandle => {
      const target = editor.getTextCursorPosition().block;
      const inserted = editor.insertBlocks(
        [{ type: "paragraph" } as any],
        target as any,
        "after",
      );
      const live = inserted?.[0] as { id: string } | undefined;
      let buffer = "";
      let raf: number | null = null;
      let closed = false;
      const flush = () => {
        raf = null;
        if (closed || !live) return;
        try {
          editor.updateBlock(live as any, { content: buffer } as any);
        } catch {
          /* block may be gone (undo) — stop pushing */
        }
      };
      return {
        append(chunk: string) {
          if (closed) return;
          buffer += chunk;
          if (raf === null) raf = requestAnimationFrame(flush);
        },
        end() {
          if (closed) return;
          closed = true;
          if (raf !== null) cancelAnimationFrame(raf);
          if (!live) return;
          try {
            const blocks = markdownToBlocks(buffer) as any[];
            if (blocks.length > 0) {
              const replaced = editor.replaceBlocks([live as any], blocks);
              flashBlocks(
                ((replaced?.insertedBlocks ?? blocks) as Array<{ id?: string }>).map(
                  (b) => b.id,
                ),
              );
            }
          } catch {
            /* keep the plain-text block as-is */
          }
        },
        cancel() {
          if (closed) return;
          closed = true;
          if (raf !== null) cancelAnimationFrame(raf);
          if (!live) return;
          try {
            editor.removeBlocks([live as any]);
          } catch {
            /* already gone */
          }
        },
      };
    };
    onStreamingInsertReadyRef.current(begin);
  }, [editor, flashBlocks]);

  // ── New-block entry animation ──────────────────────────────────────────────
  // Diff the document's block IDs on every transaction; IDs absent from the
  // previous snapshot are genuinely NEW blocks (Enter, slash insert, `# `
  // transform creating a node, paste). Only those get the `.sn-block-enter`
  // class. A blanket CSS animation on .bn-block-outer is NOT an option:
  // ProseMirror recreates block DOM during plain typing, which replayed the
  // fade on every keystroke (text visibly blinking while typing).
  useEffect(() => {
    const collectIds = (blocks: Block[]): string[] => {
      const out: string[] = [];
      for (const b of blocks) {
        out.push(b.id);
        if (b.children?.length) out.push(...collectIds(b.children as Block[]));
      }
      return out;
    };
    let known = new Set(collectIds(editor.document as Block[]));
    return editor.onChange(() => {
      const ids = collectIds(editor.document as Block[]);
      const fresh = ids.filter((id) => !known.has(id));
      known = new Set(ids);
      // Bulk arrivals (big paste, undo of a mass delete) would strobe —
      // animate small batches only.
      if (fresh.length === 0 || fresh.length > 8) return;
      requestAnimationFrame(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;
        for (const id of fresh) {
          const el = wrapper.querySelector(`[data-id="${id}"]`);
          if (!el) continue;
          el.classList.add("sn-block-enter");
          el.addEventListener(
            "animationend",
            () => el.classList.remove("sn-block-enter"),
            { once: true },
          );
        }
      });
    });
  }, [editor]);

  // ── Active-block tracking ──────────────────────────────────────────────────
  // Tracks the OUTERMOST `.bn-block-outer` containing the caret and exposes
  // it to the typewriter-focus CSS (`.sn-dim-blocks`) through a dynamic
  // stylesheet keyed on the block's data-id. Top-level only — dimming nested
  // children would multiply opacities.
  //
  // CRITICAL: do NOT mark the block by mutating an attribute on the block
  // element itself (the previous data-sn-active approach). ProseMirror's
  // MutationObserver watches the whole editor subtree including attributes;
  // an attribute write that lands right after a block type swap (e.g. the
  // `x ` → checkListItem conversion) makes PM re-read a block whose React
  // NodeView contentDOM hasn't mounted yet, and the DOM selection gets
  // re-resolved to the blockGroup boundary — every following keystroke then
  // lands in the NEXT block. Writing a rule into a <style> tag in <head>
  // never touches the observed subtree.
  useEffect(() => {
    const styleEl = document.createElement("style");
    document.head.appendChild(styleEl);
    let lastId: string | null = null;
    const onSelectionChange = () => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const sel = document.getSelection();
      const node = sel?.anchorNode;
      let active: Element | null = null;
      if (node && wrapper.contains(node)) {
        // Walk up to the wrapper, remembering the LAST (outermost) block.
        let el: Element | null =
          node instanceof Element ? node : node.parentElement;
        while (el && el !== wrapper) {
          if (el.classList.contains("bn-block-outer")) active = el;
          el = el.parentElement;
        }
      }
      const activeId = active?.getAttribute("data-id") ?? null;
      if (activeId !== lastId) {
        lastId = activeId;
        // data-id is a BlockNote-generated UUID — safe to inline.
        styleEl.textContent = activeId
          ? `.sn-dim-blocks .bn-editor > .bn-block-group > .bn-block-outer[data-id="${activeId}"] { opacity: 1; }`
          : "";
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      styleEl.remove();
    };
  }, []);

  // ── Celebration (all todos checked) ────────────────────────────────────────
  // heroCheckListItem dispatches "supernote:celebrate" on the document when
  // the LAST unchecked checkbox of the doc gets checked. We answer with a
  // full-width confetti burst over the editor.
  const [celebrateKey, setCelebrateKey] = useState(0);
  useEffect(() => {
    const onCelebrate = () => setCelebrateKey((k) => k + 1);
    document.addEventListener("supernote:celebrate", onCelebrate);
    return () => document.removeEventListener("supernote:celebrate", onCelebrate);
  }, []);

  const { openPicker, pickerElement } = useEntityPickerState(editor, resolvers);

  // Install the listener that reacts to <BasePicker> picks from inline
  // database blocks. No-op when no databaseView blocks are present.
  useDatabaseBlockPickListener(editor);

  const getItems = useCallback(
    async (query: string) => {
      const items = getSupernoteSlashMenuItems(editor, openPicker, onAskAiRef.current);
      if (!query) return items;
      const q = query.toLowerCase().trim();

      // Match strict en préfixe de mot (title splité sur espaces / `/`) et
      // sur préfixe d'alias. Évite que "/base" matche par sub-string sur
      // n'importe quel groupe ou titre contenant "base" (ex : "Database",
      // "Vue / Base", etc. côté items entity-link).
      const matches = (item: DefaultReactSuggestionItem): number => {
        const title = item.title.toLowerCase();
        const titleWords = title.split(/[\s/]+/).filter(Boolean);
        const aliases =
          ((item as unknown as { aliases?: string[] }).aliases ?? []).map((a) =>
            a.toLowerCase(),
          );

        // Exact title or alias = top score.
        if (title === q || aliases.includes(q)) return 100;
        // Title starts with query → second.
        if (title.startsWith(q)) return 80;
        // A word in the title starts with query.
        if (titleWords.some((w) => w.startsWith(q))) return 60;
        // An alias starts with query.
        if (aliases.some((a) => a.startsWith(q))) return 40;
        return 0;
      };

      return items
        .map((item) => ({ item, score: matches(item) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.item);
    },
    [editor, openPicker]
  );

  // The `@` trigger opens an inline picker that searches across ALL entity
  // types and inserts a `mention` inline chip directly. Distinct from the
  // slash menu's "Mentionner un contact" item (which opens EntityPicker).
  const getMentionItems = useCallback(
    async (query: string) => {
      return getMentionMenuItems(editor, resolvers, query);
    },
    [editor, resolvers]
  );

  // Wrap the editor in DatabaseViewProvider so every inline `databaseView`
  // block can pull the host-supplied renderer. When no renderer is provided
  // we still mount the provider with a stub (returns null) — the block's
  // built-in fallback will display the offline placeholder.
  const databaseRenderer = renderDatabaseView ?? (() => null);
  const formulaRenderer = renderFormula ?? (() => null);
  // Embed : pas de stub ici — renderer null dans le context déclenche le
  // fallback statique du bloc (rendu identique à l'absence de prop).
  const embedRenderer = renderEmbed ?? null;
  // Doodle : même logique — null → fallback statique du bloc.
  const doodleRenderer = renderDoodle ?? null;

  // ── AI actions ──────────────────────────────────────────────────────────────
  const aiEnabled = Boolean(aiClient && aiPromptResolver);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [aiAnchor, setAiAnchor] = useState<{ x: number; y: number } | null>(null);

  // Hook toujours appelé (règles React). Si IA désactivée, on passe des stubs
  // no-op pour respecter l'invariant d'appel inconditionnel des hooks.
  const noopOllama = useMemo(
    () => ({
      isAvailable: async () => false,
      listModels: async () => [],
      generate: async () => "",
      embed: async () => new Float32Array(),
      async *chat() {},
    }),
    [],
  );
  const noopResolver = useMemo(
    () => async (_id: AIActionId) => "",
    [],
  );
  const aiActionAlways = useAIAction({
    editor: editor as never,
    ollama: aiClient ?? (noopOllama as never),
    promptResolver: aiPromptResolver ?? noopResolver,
    noteTitle,
    onError: onAIError,
    onWarning: onAIWarning,
  });
  const aiAction = aiEnabled ? aiActionAlways : null;

  // Hotkeys Cmd+K Cmd+R (reformat), Cmd+K Cmd+S (summarize),
  //         Cmd+K Cmd+C (fix-spelling), Cmd+K Cmd+P (palette)
  useEffect(() => {
    if (!aiEnabled) return;
    let prefixed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (prefixed && mod) {
        const k = e.key.toLowerCase();
        const map: Record<string, AIActionId | "palette"> = {
          r: "reformat",
          s: "summarize",
          c: "fix-spelling",
          p: "palette",
        };
        if (map[k]) {
          e.preventDefault();
          prefixed = false;
          if (timer) clearTimeout(timer);
          if (map[k] === "palette") setAiMenuOpen(true);
          else aiAction?.run(map[k] as AIActionId);
        }
      } else if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        prefixed = true;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          prefixed = false;
        }, 1500);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (timer) clearTimeout(timer);
    };
  }, [aiEnabled, aiAction]);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (!aiEnabled) return;
      const hasSel =
        (editor.getSelectedText?.() ?? "").length > 0 ||
        (editor.getSelection()?.blocks?.length ?? 0) > 0;
      if (!hasSel) return;
      e.preventDefault();
      setAiAnchor({ x: e.clientX, y: e.clientY });
      setAiMenuOpen(true);
    },
    [aiEnabled, editor],
  );
  // ────────────────────────────────────────────────────────────────────────────

  // Click sur la zone vide sous le dernier block → focus le dernier block
  // éditable. Sans ce handler, BlockNote n'attrape que les clics *dans* la
  // zone d'un block — un clic sous le document (zone padding du wrapper)
  // n'a aucun effet et l'utilisateur reste prisonnier d'un `databaseView`
  // précédent quand il clique loin sous la table.
  const handleWrapperClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (readOnly) return;
      const target = e.target as HTMLElement;
      // Ignore les clics qui ont déjà touché un block / contenu éditable.
      if (target.closest("[data-node-type], [contenteditable='true']")) return;

      const doc = editor.document as Block[];
      if (doc.length === 0) return;
      let last = doc[doc.length - 1];
      // Si dernier block n'est pas éditable, append paragraph et focus dessus.
      if (last && (last.type as string) === "databaseView") {
        try {
          const inserted = editor.insertBlocks(
            [{ type: "paragraph" } as any],
            last as any,
            "after",
          );
          last = (inserted?.[0] as Block) ?? last;
        } catch {
          /* schema may reject during transient state */
        }
      }
      if (last) {
        try {
          editor.setTextCursorPosition(last as any, "end");
          editor.focus();
        } catch {
          /* best-effort */
        }
      }
    },
    [editor, readOnly],
  );

  return (
    <DatabaseViewProvider renderer={databaseRenderer}>
    <FormulaProvider renderer={formulaRenderer}>
    <EmbedProvider renderer={embedRenderer}>
    <DoodleProvider renderer={doodleRenderer}>
    <div
      ref={wrapperRef}
      className={`sn-editor-wrapper${live ? " sn-editor-live" : ""}${dimInactiveBlocks ? " sn-dim-blocks" : ""}${className ? ` ${className}` : ""}`}
      data-readonly={readOnly || undefined}
      onClick={handleWrapperClick}
      onContextMenu={onContextMenu}
    >
      {/* Word-style mini toolbox — sticky above the note while writing.
          Rendered OUTSIDE BlockNoteViewRaw (it takes the editor instance as
          a prop) so it precedes the content in the DOM and can stick to the
          top of the note's scroll container. */}
      {topToolbar && !readOnly && (
        <FixedToolbar
          editor={editor as unknown as Parameters<typeof FixedToolbar>[0]["editor"]}
        />
      )}
      <BlockNoteViewRaw
        editor={editor}
        editable={!readOnly}
        slashMenu={false}
      >
        <SuggestionMenuController
          triggerCharacter="/"
          // Provide our own menu renderer so we never call useComponentsContext(),
          // which returns undefined when no theme package (@blocknote/mantine, etc.)
          // wraps the editor — the root cause of the "SuggestionMenu undefined" crash.
          suggestionMenuComponent={SupernoteSuggestionMenu}
          getItems={getItems}
        />
        <SuggestionMenuController
          triggerCharacter="@"
          suggestionMenuComponent={SupernoteSuggestionMenu}
          getItems={getMentionItems}
        />
        {/* Per-block side menu (⠿ drag + "+" insert) and floating
            formatting toolbar — both are no-shows with BlockNoteViewRaw
            unless we provide our own components. Hidden in read-only. */}
        {!readOnly && <SideMenuController sideMenu={SupernoteSideMenu} />}
        {!readOnly && <FloatingFormattingToolbar wrapperRef={wrapperRef} />}
      </BlockNoteViewRaw>

      {/* Animated caret overlay — hides the native caret while active and
          glides between positions. No-op (native caret kept) when the user
          prefers reduced motion, on touch devices, or in read-only mode. */}
      {!readOnly && <SmoothCaret wrapperRef={wrapperRef} />}

      {/* Wikilink hover card — only when the host wires a preview resolver. */}
      {resolvers?.previewEntity && (
        <WikilinkHoverPreview
          wrapperRef={wrapperRef}
          previewEntity={resolvers.previewEntity}
        />
      )}

      {/* Full-width confetti when the last todo of the note gets checked. */}
      {celebrateKey > 0 && (
        <div key={celebrateKey} className="sn-celebrate" aria-hidden>
          {Array.from({ length: 14 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
      )}

      {/* Entity picker rendered as overlay; null when no item is being picked */}
      {pickerElement && (
        <div className="sn-entity-picker-overlay">{pickerElement}</div>
      )}

      {aiEnabled && (
        <AIActionsMenu
          isOpen={aiMenuOpen}
          onOpenChange={(open) => {
            setAiMenuOpen(open);
            if (!open) setAiAnchor(null);
          }}
          anchorPosition={aiAnchor}
          busy={aiAction?.busy ?? false}
          onRun={(id) => aiAction?.run(id)}
        />
      )}
    </div>
    </DoodleProvider>
    </EmbedProvider>
    </FormulaProvider>
    </DatabaseViewProvider>
  );
}
