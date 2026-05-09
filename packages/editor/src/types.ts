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

/** Resolver callbacks for entity search/create/get */
export interface EntityResolvers {
  /** Full-text search across entities, optionally filtered by typeId */
  searchEntities: (query: string, typeId?: string) => Promise<EntityRef[]>;
  /** Create a new entity of the given type with a name */
  createEntity?: (typeId: string, name: string) => Promise<EntityRef>;
  /** Fetch a single entity by id */
  getEntity?: (id: string) => Promise<EntityRef | null>;
}

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
  /** Entity resolver callbacks (search, create, get) */
  resolvers?: EntityResolvers;
  /** @deprecated Use resolvers.searchEntities instead */
  resolveEntity?: (idOrName: string) => Promise<EntityRef | null>;
  /** @deprecated Use resolvers.searchEntities instead */
  searchEntities?: (query: string, types?: string[]) => Promise<EntityRef[]>;
  /** Search tags for autocomplete */
  searchTags?: (query: string) => Promise<string[]>;
  /** Additional CSS class for the wrapper element */
  className?: string;
  /** Called when the user triggers the "Demander à l'IA" slash command */
  onAskAi?: () => void;
  /**
   * Called once the editor is ready with an imperative insert function.
   * The function receives markdown text and inserts it at the current cursor
   * position as one paragraph block per double-newline-separated section.
   */
  onEditorReady?: (insert: (md: string) => void) => void;
}
