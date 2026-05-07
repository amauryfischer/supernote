// BlockNote schema with default blocks + custom Supernote blocks

import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from "@blocknote/core";
import {
  calloutBlockSpec,
  codeHighlightBlockSpec,
  embedBlockSpec,
  wikilinkInlineSpec,
  mentionInlineSpec,
  tagInlineSpec,
} from "./blocks/index.js";

/** Full schema combining defaults + Supernote custom blocks */
export const supernoteSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    callout: calloutBlockSpec(),
    codeHighlight: codeHighlightBlockSpec(),
    embed: embedBlockSpec(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    wikilink: wikilinkInlineSpec,
    mention: mentionInlineSpec,
    tag: tagInlineSpec,
  },
  styleSpecs: {
    ...defaultStyleSpecs,
  },
});

export type SupernoteSchema = typeof supernoteSchema;
