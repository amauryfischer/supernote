// Main SupernoteEditor component
// BlockNote wrapper with custom blocks, slash menu, and serialization

import React, { useCallback, useEffect, useRef } from "react";
import type { Block } from "@blocknote/core";
import { fr as blocknoteFr } from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import {
  BlockNoteViewRaw,
  SuggestionMenuController,
} from "@blocknote/react";
import { supernoteSchema } from "./schema.js";
import {
  DatabaseViewProvider,
  useDatabaseBlockPickListener,
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
import { attachCheckShortcut } from "./extensions/checkShortcut.js";
import {
  attachContinueChecklistOnEnter,
  enterTagExtension,
} from "./extensions/continueChecklistOnEnter.js";
import type { SupernoteEditorProps } from "./types.js";

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
    placeholder,
    renderDatabaseView,
  } = props;

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const onAskAiRef = useRef(onAskAi);
  onAskAiRef.current = onAskAi;

  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;

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

  const editor = useCreateBlockNote(
    {
      schema: supernoteSchema,
      initialContent: initialBlocks,
      dictionary,
      _tiptapOptions: {
        extensions: [createSaveExtension(handleSave), enterTagExtension],
      },
    },
    []
  );

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
      editor.insertBlocks(
        blocks as any[],
        editor.getTextCursorPosition().block,
        "after"
      );
    };
    onEditorReadyRef.current(insertAtCursor);
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  const { openPicker, pickerElement } = useEntityPickerState(editor, resolvers);

  // Install the listener that reacts to <BasePicker> picks from inline
  // database blocks. No-op when no databaseView blocks are present.
  useDatabaseBlockPickListener(editor);

  const getItems = useCallback(
    async (query: string) => {
      const items = getSupernoteSlashMenuItems(editor, openPicker, onAskAiRef.current);
      if (!query) return items;
      const q = query.toLowerCase();
      return items.filter((item) => {
        if (item.title.toLowerCase().includes(q)) return true;
        if (item.group?.toLowerCase().includes(q)) return true;
        // aliases hold the keyword strings for entity-link items
        const aliases = (item as any).aliases as string[] | undefined;
        if (aliases?.some((a) => a.toLowerCase().includes(q))) return true;
        return false;
      });
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

  return (
    <DatabaseViewProvider renderer={databaseRenderer}>
    <div
      className={`sn-editor-wrapper${className ? ` ${className}` : ""}`}
      data-readonly={readOnly || undefined}
    >
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
      </BlockNoteViewRaw>

      {/* Entity picker rendered as overlay; null when no item is being picked */}
      {pickerElement && (
        <div className="sn-entity-picker-overlay">{pickerElement}</div>
      )}
    </div>
    </DatabaseViewProvider>
  );
}
