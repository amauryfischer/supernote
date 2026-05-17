// ============================================================
// extractSelection — convertit la sélection BlockNote en markdown
// + contexte (parent block, note title) pour les actions IA.
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { BlockNoteEditor, Block } from "@blocknote/core";

export interface ExtractedSelection {
  empty: boolean;
  markdown: string;
  blockIds: string[];
  parentBlock?: string;
  noteTitle?: string;
  hasCustomBlocks: boolean;
}

const CUSTOM_NON_TEXT_TYPES = new Set([
  "wikilink",
  "mention",
  "tag",
  "formula",
  "excalidrawInline",
  "canvasInline",
  "databaseView",
  "queryBlock",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectBlocksInSelection(editor: BlockNoteEditor<any>): Block<any>[] {
  const sel = editor.getSelection();
  if (!sel) return [];
  return sel.blocks ?? [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasCustom(blocks: Block<any>[]): boolean {
  return blocks.some((b) => CUSTOM_NON_TEXT_TYPES.has(String(b.type)));
}

export async function extractSelection(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: BlockNoteEditor<any>,
  noteTitle: string | undefined,
): Promise<ExtractedSelection> {
  const blocks = collectBlocksInSelection(editor);

  if (blocks.length === 0) {
    const text = editor.getSelectedText?.() ?? "";
    if (!text) {
      return {
        empty: true,
        markdown: "",
        blockIds: [],
        hasCustomBlocks: false,
        noteTitle,
      };
    }
    return {
      empty: false,
      markdown: text,
      blockIds: [],
      noteTitle,
      parentBlock: text,
      hasCustomBlocks: false,
    };
  }

  const markdown = await editor.blocksToMarkdownLossy(blocks);
  const parentBlock =
    blocks.length === 1
      ? await editor.blocksToMarkdownLossy([blocks[0]!])
      : undefined;

  return {
    empty: false,
    markdown,
    blockIds: blocks.map((b) => b.id),
    parentBlock,
    noteTitle,
    hasCustomBlocks: hasCustom(blocks),
  };
}
