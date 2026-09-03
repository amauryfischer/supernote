// Headless markdown → HTML export, used to build public note shares.
//
// A headless `BlockNoteEditor` (no DOM mount, no React) parses the note's
// markdown with the SAME schema the live editor uses, so every custom block
// (formula, databaseView, doodle, callout, wikilink…) round-trips through
// its own `toExternalHTML` exactly like it would inside the app.

import { BlockNoteEditor } from "@blocknote/core";
import { supernoteSchema } from "../schema.js";
import { markdownToBlocks } from "../serialization/index.js";

/**
 * Renders a note's markdown body to lossy HTML via the shared schema.
 * Custom blocks without visual data (formula values, base rows, canvas
 * scenes) emit placeholder markup — see each block's `toExternalHTML` — for
 * a caller to enrich with live data before sanitizing/publishing.
 */
export function markdownToHtmlLossy(markdown: string): string {
  const blocks = markdownToBlocks(markdown);
  const editor = BlockNoteEditor.create({ schema: supernoteSchema });
  return editor.blocksToHTMLLossy(blocks);
}
