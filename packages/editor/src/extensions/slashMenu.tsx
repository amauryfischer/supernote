// Extended slash menu items for Supernote custom blocks

import React from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps,
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

/**
 * Plain-HTML suggestion menu component that does NOT rely on ComponentsContext.
 *
 * BlockNote 0.50.0 separated the view layer into theme packages (@blocknote/mantine,
 * @blocknote/ariakit, etc.). The built-in `SuggestionMenu` component inside
 * `@blocknote/react` calls `useComponentsContext()`, which returns `undefined`
 * when no theme provider wraps the editor — causing the runtime crash
 * "Cannot read properties of undefined (reading 'SuggestionMenu')".
 *
 * Passing this custom component to `SuggestionMenuController` bypasses the
 * broken codepath entirely.
 */
export function SupernoteSuggestionMenu(
  props: SuggestionMenuProps<DefaultReactSuggestionItem>
): React.JSX.Element {
  const { items, loadingState, selectedIndex, onItemClick } = props;

  // Group items by their "group" label
  let currentGroup: string | undefined;
  const rows: React.ReactNode[] = [];

  items.forEach((item, i) => {
    if (item.group !== currentGroup) {
      currentGroup = item.group;
      rows.push(
        <div key={`group-${currentGroup}`} className="sn-slash-menu__label">
          {currentGroup}
        </div>
      );
    }

    const isSelected = i === selectedIndex;
    rows.push(
      <div
        key={item.title}
        id={`bn-suggestion-menu-item-${i}`}
        role="option"
        aria-selected={isSelected}
        className={`sn-slash-menu__item${isSelected ? " sn-slash-menu__item--selected" : ""}`}
        onMouseDown={(e) => {
          // Prevent blur before click fires
          e.preventDefault();
          onItemClick?.(item);
        }}
      >
        {item.icon && (
          <span className="sn-slash-menu__icon" aria-hidden="true">
            {item.icon}
          </span>
        )}
        <span className="sn-slash-menu__text">
          <span className="sn-slash-menu__title">{item.title}</span>
          {item.subtext && (
            <span className="sn-slash-menu__subtext">{item.subtext}</span>
          )}
        </span>
      </div>
    );
  });

  if (loadingState === "loading-initial" || loadingState === "loading") {
    rows.push(
      <div key="loader" className="sn-slash-menu__loader">
        …
      </div>
    );
  }

  if (rows.length === 0 && loadingState === "loaded") {
    rows.push(
      <div key="empty" className="sn-slash-menu__empty">
        No results
      </div>
    );
  }

  return (
    <div
      id="bn-suggestion-menu"
      role="listbox"
      className="sn-slash-menu"
    >
      {rows}
    </div>
  );
}
