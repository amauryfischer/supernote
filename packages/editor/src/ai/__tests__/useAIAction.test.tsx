// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { BlockNoteEditor } from "@blocknote/core";
import { useAIAction, type UseAIActionDeps } from "../useAIAction.js";
import type { OllamaClient, ChatChunk } from "@supernote/ai/ollama";

function fakeOllama(chunks: string[]): OllamaClient {
  return {
    isAvailable: vi.fn().mockResolvedValue(true),
    listModels: vi.fn().mockResolvedValue([]),
    generate: vi.fn(),
    embed: vi.fn(),
    chat: vi.fn().mockImplementation(async function* (): AsyncIterable<ChatChunk> {
      for (const c of chunks) yield { content: c, done: false };
      yield { content: "", done: true };
    }),
  };
}

/** Crée un éditeur avec deux blocs et sélectionne les deux (anchor ≠ head requis par BlockNote). */
function editorWithSelection() {
  const editor = BlockNoteEditor.create({
    initialContent: [
      { type: "paragraph", content: "Texte original." },
      { type: "paragraph", content: "Suite." },
    ],
  });
  const b0 = editor.document[0]!.id;
  const b1 = editor.document[1]!.id;
  editor.setSelection(b0, b1);
  return editor;
}

describe("useAIAction", () => {
  it("remplace la selection avec le texte streamé", async () => {
    const editor = editorWithSelection();
    const ollama = fakeOllama(["Nou", "veau ", "texte."]);
    const promptResolver = vi.fn().mockResolvedValue("PROMPT {{selection}}");

    const deps: UseAIActionDeps = {
      editor,
      ollama,
      promptResolver,
      noteTitle: "T",
      onError: vi.fn(),
    };

    const { result } = renderHook(() => useAIAction(deps));

    await act(async () => {
      await result.current.run("reformat");
    });

    const md = await editor.blocksToMarkdownLossy(editor.document);
    expect(md).toContain("Nouveau texte.");
  });

  it("appelle onError si Ollama échoue", async () => {
    const editor = editorWithSelection();
    const ollama: OllamaClient = {
      isAvailable: vi.fn().mockResolvedValue(true),
      listModels: vi.fn(),
      generate: vi.fn(),
      embed: vi.fn(),
      chat: vi.fn().mockImplementation(async function* () {
        throw new Error("oops");
      }),
    };
    const onError = vi.fn();

    const { result } = renderHook(() =>
      useAIAction({
        editor,
        ollama,
        promptResolver: vi.fn().mockResolvedValue("P"),
        noteTitle: "T",
        onError,
      }),
    );

    await act(async () => {
      await result.current.run("reformat");
    });

    expect(onError).toHaveBeenCalled();
  });

  it("no-op si selection vide", async () => {
    const editor = BlockNoteEditor.create({
      initialContent: [{ type: "paragraph", content: "x" }],
    });
    // Pas de setSelection → selection vide
    const ollama = fakeOllama(["y"]);
    const promptResolver = vi.fn().mockResolvedValue("P");

    const { result } = renderHook(() =>
      useAIAction({ editor, ollama, promptResolver, noteTitle: "T" }),
    );

    await act(async () => {
      await result.current.run("reformat");
    });

    expect(ollama.chat).not.toHaveBeenCalled();
  });
});
