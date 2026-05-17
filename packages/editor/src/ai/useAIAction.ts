// ============================================================
// useAIAction — hook React qui pilote une action IA streaming
// sur la sélection courante d'un BlockNoteEditor.
// ============================================================

import { useCallback, useRef, useState } from "react";
import type { BlockNoteEditor, Block } from "@blocknote/core";
import type { OllamaClient } from "@supernote/ai/ollama";
import {
  runAction,
  type AIActionId,
  type AIActionParams,
} from "@supernote/ai/actions";
import { extractSelection } from "./extractSelection.js";

export interface UseAIActionDeps {
  editor: BlockNoteEditor<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  ollama: OllamaClient;
  /** Résolution prompt côté worker (tRPC `ai.getPrompt`). */
  promptResolver: (actionId: AIActionId) => Promise<string>;
  noteTitle?: string;
  onError?: (err: { code: string; message: string }) => void;
  onWarning?: (msg: string) => void;
}

export interface UseAIActionApi {
  busy: boolean;
  run: (actionId: AIActionId, params?: AIActionParams) => Promise<void>;
}

export function useAIAction(deps: UseAIActionDeps): UseAIActionApi {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = useCallback(
    async (actionId: AIActionId, params?: AIActionParams) => {
      if (busyRef.current) {
        deps.onError?.({
          code: "busy",
          message: "Action IA déjà en cours.",
        });
        return;
      }

      const sel = await extractSelection(deps.editor, deps.noteTitle);
      if (sel.empty) return;
      if (sel.hasCustomBlocks) {
        deps.onWarning?.(
          "Sélection contient un bloc non-éditable, opération sur la partie texte uniquement.",
        );
      }

      busyRef.current = true;
      setBusy(true);

      // Snapshot des blocs touchés pour restore en cas d'erreur.
      const blocksSnapshot: Block<any>[] = sel.blockIds // eslint-disable-line @typescript-eslint/no-explicit-any
        .map((id) => deps.editor.getBlock(id))
        .filter((b): b is Block<any> => Boolean(b)) // eslint-disable-line @typescript-eslint/no-explicit-any
        .map((b) => JSON.parse(JSON.stringify(b)));

      // liveBlockIds tracks the current block IDs in the editor.
      // After the first replaceBlocks the original IDs are gone; BlockNote
      // preserves the first block's ID, so from chunk 2 onwards we work on
      // a single-element array containing that ID.
      let liveBlockIds = [...sel.blockIds];

      let accumulated = "";
      let errored = false;

      try {
        for await (const chunk of runAction(
          {
            actionId,
            selection: sel.markdown,
            context: {
              parentBlock: sel.parentBlock,
              noteTitle: sel.noteTitle,
            },
            ...(params ? { params } : {}),
          },
          {
            ollama: deps.ollama,
            promptResolver: deps.promptResolver,
          },
        )) {
          if (chunk.type === "delta") {
            accumulated += chunk.text;
            const newId = upsertStreamingBlock(
              deps.editor,
              liveBlockIds,
              accumulated,
            );
            // After first replacement, only the single live block remains.
            liveBlockIds = [newId];
          } else if (chunk.type === "error") {
            errored = true;
            deps.onError?.({ code: chunk.code, message: chunk.message });
            break;
          }
        }
      } catch (err) {
        errored = true;
        deps.onError?.({
          code: "unknown",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      if (errored && blocksSnapshot.length > 0) {
        // Restore: replace whatever live block(s) remain with the snapshot.
        try {
          deps.editor.replaceBlocks(liveBlockIds, blocksSnapshot);
          deps.editor.setTextCursorPosition(blocksSnapshot[0]!.id, "start");
        } catch {
          // If restore itself fails (e.g. block already gone), ignore.
        }
      }

      busyRef.current = false;
      setBusy(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps],
  );

  return { busy, run };
}

/**
 * Remplace les blocs identifiés par un unique paragraphe contenant `text`.
 * Retourne l'ID du bloc résultant (pour mettre à jour liveBlockIds).
 *
 * V1 : suffisant pour le MVP (3 actions sur du texte court).
 * Phase 2 : parser le markdown streamé et regénérer des blocs typés.
 */
function upsertStreamingBlock(
  editor: BlockNoteEditor<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  blockIds: string[],
  text: string,
): string {
  if (blockIds.length === 0) {
    throw new Error("upsertStreamingBlock: blockIds is empty");
  }
  // Use the first ID as the stable ID for the replacement block so BlockNote
  // keeps the same node in the document tree.
  const targetId = blockIds[0]!;
  editor.replaceBlocks(blockIds, [
    {
      id: targetId,
      type: "paragraph",
      content: text,
    },
  ] as never);
  return targetId;
}
