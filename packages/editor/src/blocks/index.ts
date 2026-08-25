// Custom block and inline content specs

export { calloutBlockSpec } from "./callout.js";
export { codeHighlightBlockSpec } from "./codeHighlight.js";
export type { CodeLanguage } from "./codeHighlight.js";
export {
  embedBlockSpec,
  EmbedProvider,
  useEmbedRenderer,
} from "./embed.js";
export type { EmbedRenderProps, EmbedRenderer } from "./embed.js";
export {
  doodleBlockSpec,
  DoodleProvider,
  useDoodleRenderer,
} from "./doodle.js";
export type { DoodleRenderProps, DoodleRenderer } from "./doodle.js";
export { heroCheckListItemSpec } from "./heroCheckListItem.js";
export { htmlArtifactBlockSpec } from "./htmlArtifact.js";
export {
  clampHtmlHeight,
  looksLikeHtmlDocument,
  fenceFor,
  HTML_ARTIFACT_DEFAULT_HEIGHT,
} from "./htmlArtifactUtils.js";
export {
  googleSheetBlockSpec,
  GoogleSheetProvider,
  useGoogleSheetRenderer,
} from "./googleSheet.js";
export type {
  GoogleSheetRenderProps,
  GoogleSheetRenderer,
} from "./googleSheet.js";
export {
  parseGoogleSheetUrl,
  buildPubhtmlUrl,
  buildOpenUrl,
} from "./googleSheetUrl.js";
export type { GoogleSheetRef } from "./googleSheetUrl.js";
export {
  gmailMessageBlockSpec,
  GmailEmbedProvider,
  useGmailEmbed,
} from "./gmailMessage.js";
export type { GmailEmbedApi, GmailEmbedRenderProps } from "./gmailMessage.js";
export { buildGmailThreadUrl } from "./gmailEmbedUrl.js";
export {
  databaseViewBlockSpec,
  DatabaseViewProvider,
  useDatabaseViewRenderer,
  useDatabaseBlockPickListener,
  requestDatabaseBlockReconfigure,
} from "./databaseView.js";
export type {
  DatabaseViewBlockProps,
  DatabaseViewRenderer,
  DatabaseBlockPickDetail,
} from "./databaseView.js";

// Inline content specs
export { wikilinkInlineSpec } from "./wikilink.js";
export { mentionInlineSpec } from "./mention.js";
export { tagInlineSpec } from "./tag.js";

// Formula
export {
  formulaBlockSpec,
  formulaInlineSpec,
  FormulaProvider,
  useFormulaRenderer,
} from "./formula.js";
export type { FormulaRenderProps, FormulaRenderer } from "./formula.js";
