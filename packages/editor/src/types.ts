// Editor public types

import type { Block as BNBlock } from "@blocknote/core";

// Re-export Block for consumers
export type { Block } from "@blocknote/core";

/** Lightweight reference to a vault entity */
export interface EntityRef {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly icon?: string;
  readonly color?: string;
}

/** Callout variants matching Obsidian callout syntax */
export type CalloutVariant = "info" | "note" | "warning" | "danger" | "quote";

/** Props for the main SupernoteEditor component */
export interface SupernoteEditorProps {
  /** Initial markdown content */
  initialMarkdown?: string;
  /** Called on every change with serialized markdown and raw blocks */
  onChange?: (markdown: string, blocks: BNBlock[]) => void;
  /** Called when user presses Ctrl/Cmd+S */
  onSave?: (markdown: string) => void;
  /** Placeholder text when editor is empty */
  placeholder?: string;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Resolve a single entity by id or name */
  resolveEntity?: (idOrName: string) => Promise<EntityRef | null>;
  /** Search entities for autocomplete */
  searchEntities?: (query: string, types?: string[]) => Promise<EntityRef[]>;
  /** Search tags for autocomplete */
  searchTags?: (query: string) => Promise<string[]>;
  /** Additional CSS class for the wrapper element */
  className?: string;
}
