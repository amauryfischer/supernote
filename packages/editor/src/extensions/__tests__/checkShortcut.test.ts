// @vitest-environment jsdom
// Régression : taper "x " dans un paragraphe vide doit le convertir en
// checkListItem vide avec le curseur dedans (prêt à saisir le texte).
import { describe, it, expect } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { supernoteSchema } from "../../schema.js";
import { attachCheckShortcut } from "../checkShortcut.js";

const flush = async (ms = 30) => {
  await Promise.resolve(); // microtasks (watcher onChange)
  await new Promise((r) => setTimeout(r, ms)); // setTimeout(0) du re-anchor
};

describe("checkShortcut", () => {
  it("convertit 'x ' en checkListItem vide et re-ancre le curseur dedans", async () => {
    const editor = BlockNoteEditor.create({
      schema: supernoteSchema,
      initialContent: [{ type: "paragraph", content: "" }],
    });
    const detach = attachCheckShortcut(
      editor as unknown as Parameters<typeof attachCheckShortcut>[0],
    );

    const para = editor.document[0]!;
    editor.setTextCursorPosition(para.id, "start");

    // Simule la frappe : "x" puis " " (deux transactions, comme deux keystrokes)
    editor.insertInlineContent("x");
    await flush();
    editor.insertInlineContent(" ");
    await flush(50);

    const doc = editor.document;
    expect(doc[0]!.type).toBe("checkListItem");
    expect(doc[0]!.content).toEqual([]);
    expect(editor.getTextCursorPosition().block.id).toBe(para.id);

    detach();
  });

  it("ne convertit pas un paragraphe dont le texte n'est pas exactement 'x '", async () => {
    const editor = BlockNoteEditor.create({
      schema: supernoteSchema,
      initialContent: [{ type: "paragraph", content: "" }],
    });
    const detach = attachCheckShortcut(
      editor as unknown as Parameters<typeof attachCheckShortcut>[0],
    );

    const para = editor.document[0]!;
    editor.setTextCursorPosition(para.id, "start");
    editor.insertInlineContent("xy");
    await flush();
    editor.insertInlineContent(" ");
    await flush(50);

    expect(editor.document[0]!.type).toBe("paragraph");

    detach();
  });

  it("ne convertit pas pendant une composition IME, convertit après (anti-crash mobile)", async () => {
    const editor = BlockNoteEditor.create({
      schema: supernoteSchema,
      initialContent: [{ type: "paragraph", content: "" }],
    });
    const detach = attachCheckShortcut(
      editor as unknown as Parameters<typeof attachCheckShortcut>[0],
    );

    const para = editor.document[0]!;
    editor.setTextCursorPosition(para.id, "start");

    // Clavier mobile : compositionstart avant la frappe. Le contenu vaut
    // exactement "x " — sans le garde, ça convertirait (et muter le doc
    // pendant la composition crashe ProseMirror). Le garde doit l'empêcher.
    document.dispatchEvent(new Event("compositionstart"));
    editor.insertInlineContent("x ");
    await flush(50);
    expect(editor.document[0]!.type).toBe("paragraph");

    // Fin de composition → le watcher reprend. On vide puis on retape "x "
    // hors composition : la conversion doit alors avoir lieu.
    document.dispatchEvent(new Event("compositionend"));
    editor.updateBlock(editor.document[0]!, { content: [] });
    editor.setTextCursorPosition(editor.document[0]!.id, "end");
    editor.insertInlineContent("x ");
    await flush(50);
    expect(editor.document[0]!.type).toBe("checkListItem");

    detach();
  });
});
