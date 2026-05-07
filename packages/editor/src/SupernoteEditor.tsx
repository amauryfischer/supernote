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
  getSupernoteSlashMenuItems,
  SupernoteSuggestionMenu,
} from "./extensions/slashMenu.js";
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
  } = props;

  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleSave = useCallback(() => {
    onSaveRef.current?.(editor.document ? blocksToMarkdown(editor.document as Block[]) : "");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useCreateBlockNote(
    {
      schema: supernoteSchema,
      initialContent: initialMarkdown
        ? (markdownToBlocks(initialMarkdown) as any[])
        : undefined,
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
          getItems={async (query) => {
            const items = getSupernoteSlashMenuItems(editor);
            if (!query) return items;
            const q = query.toLowerCase();
            return items.filter(
              (item) =>
                item.title.toLowerCase().includes(q) ||
                (item.group?.toLowerCase().includes(q) ?? false)
            );
          }}
        />
      </BlockNoteViewRaw>
    </div>
  );
}
