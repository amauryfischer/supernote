import { useMemo } from "react";
import { trpc } from "@/lib/trpc/client";
import { extractChecklists } from "@/lib/todos/extractChecklists";
import { filterChecklistsHeuristic } from "@/lib/todos/heuristicFilter";
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
  const notesQuery = trpc.entities.list.useQuery(
    { typeId: "note", limit: 5000, offset: 0 },
    { staleTime: 30_000, refetchOnMount: "always", enabled },
  );

  /**
   * Materialize one UiTodoRow per checklist line across every note. Pure
   * projection; cheap to recompute (a single string scan per note + a sort).
   */
  const noteRows: UiTodoRow[] = useMemo(() => {
    const notes = notesQuery.data?.items ?? [];
    const out: UiTodoRow[] = [];
    for (const n of notes) {
      // Skip archived notes — their checklists are out of scope until the
      // user explicitly restores them. Mirrors the NoteList default and
      // keeps "stale" projects from cluttering the active todo board.
      const archivedAt = n.fields?.["archivedAt"];
      if (typeof archivedAt === "string" && archivedAt.length > 0) continue;
      const body = typeof n.body === "string" ? n.body : "";
      if (!body || !body.includes("[")) continue;
      const items = extractChecklists(body);
      if (items.length === 0) continue;
      const kept = filterChecklistsHeuristic(body, items);
      if (kept.length === 0) continue;
      const title =
        typeof n.fields?.["title"] === "string"
          ? (n.fields["title"] as string)
          : n.filePath.split("/").pop()?.replace(/\.md$/, "") ?? "Sans titre";
      const tags = Array.isArray((n as { tags?: unknown }).tags)
        ? ((n as { tags: unknown[] }).tags.filter((t) => typeof t === "string") as string[])
        : [];
      for (const it of kept) {
        out.push({
          kind: "note",
          id: `note:${n.id}:${it.blockId}`,
          text: it.text,
          done: it.done,
          sourceNoteId: n.id,
          line: it.line,
          blockId: it.blockId,
          startDate: it.startDate,
          dueDate: it.dueDate,
          priority: it.priority,
          importance: it.importance,
          urgent: it.urgent,
          sourceNoteTitle: title,
          sourceNoteTags: tags,
          createdAt: n.updatedAt,
          sortOrder: null,
        });
      }
    }
    return out;
  }, [notesQuery.data]);

  return { rows: noteRows, isLoading: notesQuery.isLoading };
}
