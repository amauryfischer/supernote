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
  databaseViewBlockSpec,
  doodleBlockSpec,
  embedBlockSpec,
  googleSheetBlockSpec,
  gmailMessageBlockSpec,
  heroCheckListItemSpec,
  htmlArtifactBlockSpec,
  wikilinkInlineSpec,
  mentionInlineSpec,
  tagInlineSpec,
  formulaBlockSpec,
  formulaInlineSpec,
} from "./blocks/index.js";

// Drop BlockNote's default checkListItem so our HeroUI-rendered version
// takes its slot. We keep the `checkListItem` block name so existing
// markdown serialization (`- [x]` / `- [ ]`) round-trips unchanged.
const { checkListItem: _defaultCheckListItem, ...defaultsWithoutCheck } =
  defaultBlockSpecs;

/** Full schema combining defaults + Supernote custom blocks */
export const supernoteSchema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultsWithoutCheck,
    checkListItem: heroCheckListItemSpec(),
    callout: calloutBlockSpec(),
    codeHighlight: codeHighlightBlockSpec(),
    embed: embedBlockSpec(),
    doodle: doodleBlockSpec(),
    databaseView: databaseViewBlockSpec(),
    formula: formulaBlockSpec(),
    googleSheet: googleSheetBlockSpec(),
    htmlArtifact: htmlArtifactBlockSpec(),
    gmailMessage: gmailMessageBlockSpec(),
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    wikilink: wikilinkInlineSpec,
    mention: mentionInlineSpec,
    tag: tagInlineSpec,
    formulaInline: formulaInlineSpec,
  },
  styleSpecs: {
    ...defaultStyleSpecs,
  },
});

export type SupernoteSchema = typeof supernoteSchema;
