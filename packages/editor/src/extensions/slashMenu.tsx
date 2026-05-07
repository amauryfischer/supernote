// Extended slash menu items for Supernote custom blocks

import React from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import type { CalloutVariant } from "../types.js";

const CALLOUT_ICON_MAP: Record<CalloutVariant, string> = {
  info: "ℹ",
  note: "✏",
  warning: "⚠",
  danger: "🚫",
  quote: '"',
};

function makeCalloutItem(
  editor: BlockNoteEditor<any, any, any>,
  variant: CalloutVariant
): DefaultReactSuggestionItem {
  return {
    title: `Callout ${variant}`,
    subtext: `Insert a ${variant} callout block`,
    group: "Callouts",
    icon: <span aria-hidden="true">{CALLOUT_ICON_MAP[variant]}</span>,
    onItemClick() {
      editor.insertBlocks(
        [{ type: "callout", props: { variant, title: "" } }],
        editor.getTextCursorPosition().block,
        "after"
      );
    },
  };
}

/** Get default slash menu items extended with Supernote custom blocks */
export function getSupernoteSlashMenuItems(
  editor: BlockNoteEditor<any, any, any>
): DefaultReactSuggestionItem[] {
  const defaults = getDefaultReactSlashMenuItems(editor);

  const calloutItems: DefaultReactSuggestionItem[] = (
    ["info", "note", "warning", "danger", "quote"] as CalloutVariant[]
  ).map((v) => makeCalloutItem(editor, v));

  const codeItem: DefaultReactSuggestionItem = {
    title: "Code (highlighted)",
    subtext: "Code block with syntax highlighting",
    group: "Code",
    icon: <span aria-hidden="true">{"</>"}</span>,
    onItemClick() {
      editor.insertBlocks(
        [{ type: "codeHighlight", props: { language: "typescript", code: "" } }],
        editor.getTextCursorPosition().block,
        "after"
      );
    },
  };

  const embedItem: DefaultReactSuggestionItem = {
    title: "Embed / Transclusion",
    subtext: "Embed another note (![[Note]])",
    group: "Links",
    icon: <span aria-hidden="true">↗</span>,
    onItemClick() {
      editor.insertBlocks(
        [{ type: "embed", props: { target: "", alias: "" } }],
        editor.getTextCursorPosition().block,
        "after"
      );
    },
  };

  return [...defaults, ...calloutItems, codeItem, embedItem];
}
