import { useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import type { TodoRowData } from "./TodoRow";

export interface UiTodoRow extends TodoRowData {
  /** "note" → row materialized from a checklist line in a note's body.
   *  "standalone" → row backed by a `todo` entity with no source note. */
  kind: "note" | "standalone";
  /** Source note title, when applicable. */
  sourceNoteTitle: string | null;
  /** Source note's tags — used by the tag filter. */
  sourceNoteTags: string[];
  /** Sort/group key — `note:${noteId}:${blockId}` or the entity id. */
  createdAt: string;
  /** Manual sort position — only populated for standalone todos. */
  sortOrder: number | null;
}

/** Lignes de checklist de toutes les notes, partagées par /todos et l'agenda (même requête, même cache). */
export function useNoteChecklistTodos(enabled = true): { rows: UiTodoRow[]; isLoading: boolean } {
  // Extraction faite par le worker (notes archivées exclues) : aucun corps de note ne traverse.
  const query = trpc.entities.noteChecklists.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnMount: "always",
    enabled,
  });

  const rows: UiTodoRow[] = useMemo(
    () =>
      (query.data ?? []).map((it) => ({
        kind: "note",
        id: `note:${it.noteId}:${it.blockId}`,
        text: it.text,
        done: it.done,
        sourceNoteId: it.noteId,
        line: it.line,
        blockId: it.blockId,
        startDate: it.startDate,
        dueDate: it.dueDate,
        priority: it.priority,
        importance: it.importance,
        urgent: it.urgent,
        sourceNoteTitle: it.noteTitle,
        sourceNoteTags: it.noteTags,
        createdAt: it.noteUpdatedAt,
        sortOrder: null,
      })),
    [query.data],
  );

  return { rows, isLoading: query.isLoading };
}
