// @supernote/editor — public API

// Main component
export { SupernoteEditor } from "./SupernoteEditor.js";

// Types
export type { SupernoteEditorProps, EntityRef, EntityResolvers, CalloutVariant, Block } from "./types.js";

// Schema (for advanced usage)
export { supernoteSchema } from "./schema.js";
export type { SupernoteSchema } from "./schema.js";

// Custom block specs
export {
  calloutBlockSpec,
  codeHighlightBlockSpec,
  embedBlockSpec,
  wikilinkInlineSpec,
  mentionInlineSpec,
  tagInlineSpec,
  databaseViewBlockSpec,
  DatabaseViewProvider,
  useDatabaseViewRenderer,
  useDatabaseBlockPickListener,
  requestDatabaseBlockReconfigure,
} from "./blocks/index.js";
export type {
  CodeLanguage,
  DatabaseViewBlockProps,
  DatabaseViewRenderer,
  DatabaseBlockPickDetail,
} from "./blocks/index.js";

// Serialization utilities
export { markdownToBlocks, blocksToMarkdown } from "./serialization/index.js";

// AI actions
export { useAIAction, type UseAIActionDeps, type UseAIActionApi } from "./ai/useAIAction.js";
export { AIActionsMenu, type AIActionsMenuProps } from "./ai/AIActionsMenu.js";
export { extractSelection, type ExtractedSelection } from "./ai/extractSelection.js";

// Demo (for development only)
export { EditorDemo } from "./demo/EditorDemo.js";
