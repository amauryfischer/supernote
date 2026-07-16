// @supernote/editor — public API

// Main component
export { SupernoteEditor } from "./SupernoteEditor.js";

// Types
export type {
  SupernoteEditorProps,
  SupernoteEditorApi,
  EntityRef,
  EntityResolvers,
  CalloutVariant,
  Block,
  StreamingInsertHandle,
} from "./types.js";

// Schema (for advanced usage)
export { supernoteSchema } from "./schema.js";
export type { SupernoteSchema } from "./schema.js";

// Custom block specs
export {
  calloutBlockSpec,
  codeHighlightBlockSpec,
  embedBlockSpec,
  EmbedProvider,
  useEmbedRenderer,
  doodleBlockSpec,
  DoodleProvider,
  useDoodleRenderer,
  wikilinkInlineSpec,
  mentionInlineSpec,
  tagInlineSpec,
  databaseViewBlockSpec,
  DatabaseViewProvider,
  useDatabaseViewRenderer,
  useDatabaseBlockPickListener,
  requestDatabaseBlockReconfigure,
  googleSheetBlockSpec,
  GoogleSheetProvider,
  useGoogleSheetRenderer,
  parseGoogleSheetUrl,
  buildPubhtmlUrl,
  buildOpenUrl,
  gmailMessageBlockSpec,
  GmailEmbedProvider,
  useGmailEmbed,
  buildGmailThreadUrl,
} from "./blocks/index.js";
export type {
  CodeLanguage,
  DatabaseViewBlockProps,
  DatabaseViewRenderer,
  DatabaseBlockPickDetail,
  EmbedRenderProps,
  EmbedRenderer,
  DoodleRenderProps,
  DoodleRenderer,
  GoogleSheetRenderProps,
  GoogleSheetRenderer,
  GoogleSheetRef,
  GmailEmbedApi,
  GmailEmbedRenderProps,
} from "./blocks/index.js";

// Serialization utilities
export { markdownToBlocks, blocksToMarkdown } from "./serialization/index.js";

// AI actions
export { useAIAction, type UseAIActionDeps, type UseAIActionApi } from "./ai/useAIAction.js";
export { AIActionsMenu, type AIActionsMenuProps } from "./ai/AIActionsMenu.js";
export { extractSelection, type ExtractedSelection } from "./ai/extractSelection.js";

// Keymap registry
export { createEditorKeymapExtension } from "./extensions/editorKeymap.js";
export { ACTION_META } from "./keymap/actions.js";
export type { EditorActionMeta, EditorActionCategory } from "./keymap/types.js";

// Demo (for development only)
export { EditorDemo } from "./demo/EditorDemo.js";
