// Extended slash menu items for Supernote custom blocks

import React, { useCallback, useRef, useState } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps,
} from "@blocknote/react";
import type { CalloutVariant } from "../types.js";
import type { EntityRef, EntityResolvers } from "../types.js";
import { EntityPicker } from "./EntityPicker.js";

// ── Callout items ─────────────────────────────────────────────────────────────

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

// ── Entity link items ─────────────────────────────────────────────────────────

export interface EntityLinkItemConfig {
  /** Title shown in slash menu */
  title: string;
  /** Short description */
  subtext: string;
  /** Entity typeId sent to searchEntities */
  typeId: string;
  /** Human label for picker header and create button */
  typeLabel: string;
  /** Icon character or emoji */
  icon: string;
  /** Slash menu filter keywords (space-separated) */
  keywords: string;
  /** How to insert the selected entity into the editor */
  insert: (
    editor: BlockNoteEditor<any, any, any>,
    entity: EntityRef
  ) => void;
}

const WIKILINK_INSERT =
  (editor: BlockNoteEditor<any, any, any>, entity: EntityRef) => {
    editor.insertInlineContent([
      {
        type: "wikilink" as any,
        props: { target: entity.name, alias: entity.name },
      },
      " ",
    ]);
  };

const MENTION_INSERT =
  (typeId: string) =>
  (editor: BlockNoteEditor<any, any, any>, entity: EntityRef) => {
    editor.insertInlineContent([
      {
        type: "mention" as any,
        props: { id: entity.id, name: entity.name, entityType: typeId },
      },
      " ",
    ]);
  };

const EMBED_INSERT =
  (editor: BlockNoteEditor<any, any, any>, entity: EntityRef) => {
    editor.insertBlocks(
      [{ type: "embed", props: { target: entity.name, alias: entity.name } }],
      editor.getTextCursorPosition().block,
      "after"
    );
  };

const TAG_INSERT =
  (editor: BlockNoteEditor<any, any, any>, entity: EntityRef) => {
    editor.insertInlineContent([
      { type: "tag" as any, props: { path: entity.name } },
      " ",
    ]);
  };

export const ENTITY_LINK_CONFIGS: EntityLinkItemConfig[] = [
  {
    title: "Reference une note",
    subtext: "Lien wikilink vers une note [[Note]]",
    typeId: "note",
    typeLabel: "note",
    icon: "N",
    keywords: "note lien wikilink",
    insert: WIKILINK_INSERT,
  },
  {
    title: "Mentionner un contact",
    subtext: "Mention @Contact vers une personne",
    typeId: "personne",
    typeLabel: "contact",
    icon: "@",
    keywords: "personne mention contact",
    insert: MENTION_INSERT("personne"),
  },
  {
    title: "Lier un projet",
    subtext: "Wikilink vers un projet",
    typeId: "projet",
    typeLabel: "projet",
    icon: "P",
    keywords: "projet",
    insert: WIKILINK_INSERT,
  },
  {
    title: "Lier une organisation",
    subtext: "Wikilink vers une organisation",
    typeId: "organisation",
    typeLabel: "organisation",
    icon: "O",
    keywords: "organisation org societe",
    insert: MENTION_INSERT("organisation"),
  },
  {
    title: "Lier un actif financier",
    subtext: "Wikilink vers un actif ou compte",
    typeId: "actif",
    typeLabel: "actif financier",
    icon: "$",
    keywords: "asset compte finance actif financier",
    insert: WIKILINK_INSERT,
  },
  {
    title: "Inserer un tag",
    subtext: "Tag #chemin inline",
    typeId: "tag",
    typeLabel: "tag",
    icon: "#",
    keywords: "tag",
    insert: TAG_INSERT,
  },
  {
    title: "Embed une note",
    subtext: "Transclusion ![[Note]] d'une autre note",
    typeId: "note",
    typeLabel: "note a embed",
    icon: "E",
    keywords: "embed transclusion",
    insert: EMBED_INSERT,
  },
  {
    title: "Vue / Query",
    subtext: "Insere une vue ou requete live",
    typeId: "vue",
    typeLabel: "vue",
    icon: "V",
    keywords: "vue requete query",
    insert: WIKILINK_INSERT,
  },
];

// ── Slash menu item builder using the picker ─────────────────────────────────

/**
 * Build entity-link slash menu items.
 * openPicker is called with the selected config so the host renders EntityPicker.
 */
function makeEntityLinkItem(
  editor: BlockNoteEditor<any, any, any>,
  config: EntityLinkItemConfig,
  openPicker: (cfg: EntityLinkItemConfig) => void
): DefaultReactSuggestionItem {
  return {
    title: config.title,
    subtext: config.subtext,
    group: "Liens & references",
    // Store keywords on the item for filtering
    aliases: config.keywords.split(" "),
    icon: <span aria-hidden="true" style={{ fontFamily: "monospace" }}>{config.icon}</span>,
    onItemClick() {
      openPicker(config);
    },
  };
}

/** Get default slash menu items extended with Supernote custom blocks */
export function getSupernoteSlashMenuItems(
  editor: BlockNoteEditor<any, any, any>,
  openPicker: (cfg: EntityLinkItemConfig) => void
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

  const entityLinkItems = ENTITY_LINK_CONFIGS.map((cfg) =>
    makeEntityLinkItem(editor, cfg, openPicker)
  );

  return [...defaults, ...calloutItems, codeItem, embedItem, ...entityLinkItems];
}

// ── Suggestion menu renderer ──────────────────────────────────────────────────

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

// ── Wrapper that owns picker state ────────────────────────────────────────────

export interface SlashMenuWithPickerProps {
  editor: BlockNoteEditor<any, any, any>;
  resolvers: EntityResolvers | undefined;
  query: string;
}

interface PickerState {
  config: EntityLinkItemConfig;
}

/**
 * Render the suggestion menu items filtered by query.
 * When an entity-link item is clicked, records which config was picked
 * so the EntityPicker can be shown by the parent.
 */
export function useSlashMenuItems(
  editor: BlockNoteEditor<any, any, any>,
  resolvers: EntityResolvers | undefined,
  onPickerOpen: (cfg: EntityLinkItemConfig) => void
): (query: string) => Promise<DefaultReactSuggestionItem[]> {
  return useCallback(
    async (query: string) => {
      const items = getSupernoteSlashMenuItems(editor, onPickerOpen);
      if (!query) return items;
      const q = query.toLowerCase();
      return items.filter((item) => {
        if (item.title.toLowerCase().includes(q)) return true;
        if (item.group?.toLowerCase().includes(q)) return true;
        // Check aliases (used for keywords on entity-link items)
        if (
          Array.isArray((item as any).aliases) &&
          (item as any).aliases.some((a: string) => a.toLowerCase().includes(q))
        )
          return true;
        return false;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, onPickerOpen]
  );
}

/**
 * Hook that manages entity picker visibility.
 * Returns picker state + open/close handlers.
 */
export function useEntityPickerState(
  editor: BlockNoteEditor<any, any, any>,
  resolvers: EntityResolvers | undefined
) {
  const [pickerState, setPickerState] = useState<PickerState | null>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const openPicker = useCallback((cfg: EntityLinkItemConfig) => {
    setPickerState({ config: cfg });
  }, []);

  const closePicker = useCallback(() => {
    setPickerState(null);
  }, []);

  const handleSelect = useCallback(
    (entity: EntityRef) => {
      if (!pickerState) return;
      pickerState.config.insert(editorRef.current, entity);
      setPickerState(null);
    },
    [pickerState]
  );

  const pickerElement: React.JSX.Element | null = pickerState ? (
    <EntityPicker
      typeId={pickerState.config.typeId}
      typeLabel={pickerState.config.typeLabel}
      resolvers={resolvers}
      onSelect={handleSelect}
      onClose={closePicker}
    />
  ) : null;

  return { openPicker, closePicker, pickerElement };
}
