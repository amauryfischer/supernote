// Main SupernoteEditor component
// BlockNote wrapper with custom blocks, slash menu, and serialization

import React, { useCallback, useEffect, useRef } from "react";
import type { Block } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import {
  BlockNoteViewRaw,
  SuggestionMenuController,
} from "@blocknote/react";
import { supernoteSchema } from "./schema.js";
import { markdownToBlocks, blocksToMarkdown } from "./serialization/index.js";
import {
  SupernoteSuggestionMenu,
  getSupernoteSlashMenuItems,
  getMentionMenuItems,
  useEntityPickerState,
} from "./extensions/slashMenu.js";
import type { EntityLinkItemConfig } from "./extensions/slashMenu.js";
import { createSaveExtension } from "./extensions/saveShortcut.js";
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
  } = props;

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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

  const editor = useCreateBlockNote(
    {
      schema: supernoteSchema,
      initialContent: initialBlocks,
      _tiptapOptions: {
        extensions: [createSaveExtension(handleSave)],
      },
    },
    []
  );

  // Wire up onChange
  useEffect(() => {
    return editor.onChange(() => {
      const md = blocksToMarkdown(editor.document as Block[]);
      onChangeRef.current?.(md, editor.document as Block[]);
    });
  }, [editor]);

  const { openPicker, pickerElement } = useEntityPickerState(editor, resolvers);

  const getItems = useCallback(
    async (query: string) => {
      const items = getSupernoteSlashMenuItems(editor, openPicker);
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

  return (
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
  );
}
