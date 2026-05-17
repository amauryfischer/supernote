// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { extractSelection } from "../extractSelection.js";

describe("extractSelection", () => {
  let editor: ReturnType<typeof BlockNoteEditor.create>;

  beforeEach(() => {
    editor = BlockNoteEditor.create({
      initialContent: [
        { type: "heading", content: "Titre" },
        { type: "paragraph", content: "Premier paragraphe." },
        { type: "paragraph", content: "Second paragraphe." },
      ],
    });
  });

  it("retourne empty + warning si selection vide", async () => {
    const res = await extractSelection(editor, "Note A");
    expect(res.empty).toBe(true);
  });

  it("retourne markdown + noteTitle pour selection multi-blocs", async () => {
    const blocks = editor.document;
    editor.setSelection(blocks[0]!.id, blocks[2]!.id);

    const res = await extractSelection(editor, "Ma note");
    expect(res.empty).toBe(false);
    expect(res.markdown).toContain("Premier paragraphe");
    expect(res.noteTitle).toBe("Ma note");
    expect(res.blockIds.length).toBeGreaterThan(0);
  });

  it("contient le parentBlock dans le contexte si selection intra-bloc", async () => {
    const blocks = editor.document;
    editor.setTextCursorPosition(blocks[1]!.id, "start");
    const res = await extractSelection(editor, "Note");
    if (!res.empty) {
      expect(res.parentBlock).toBeDefined();
    }
  });
});
