"use client";

/**
 * Todo bridge helpers — the legacy "sync entities ↔ markdown" pipeline has
 * been removed. Notes-derived todos are now pure projections of the source
 * markdown (see `extractChecklists` + `inlineMetadata`), which kills the
 * entire class of duplication bugs caused by the previous reconciler.
 *
 * What remains here:
 *   - `TODO_TYPE_ID` constant — kept for *standalone* todos (entities created
 *     manually via the /todos "+" button, with no source note). Those still
 *     live as entities because there is no markdown to project from.
 *   - `toggleTodoDone` — flips a `[ ]` ↔ `[x]` in the source note's body.
 *   - `updateTodoMetadata` — rewrites a checklist line with new inline
 *     metadata (priority / importance / dueDate).
 *
 * No more `syncNoteTodos`, `scheduleSync`, `flushSync`, `useTodoSync` hook,
 * `todoCache` field, or per-line `todo` entity duplicated from a checkbox.
 */

import { trpcVanillaClient } from "@/lib/trpc/client";
import {
  rewriteChecklistLine,
  toggleChecklistLine,
} from "@/lib/todos/extractChecklists";
import {
  formatInlineMetadata,
  type TodoImportance,
} from "@/lib/todos/inlineMetadata";

/** Entity type id — still used for standalone todos (no source note). */
export const TODO_TYPE_ID = "todo";

/**
 * Toggle a todo's done state. For notes-derived todos, rewrites the
 * `[ ]`↔`[x]` in the source note's markdown. Returns the new `done` value
 * on success; throws if the source line cannot be located so the caller
 * can surface that as a toast.
 */
export async function toggleTodoDone(args: {
  sourceNoteId: string;
  text: string;
  line: number;
  done: boolean;
}): Promise<boolean> {
  const { sourceNoteId, text, line, done } = args;

  const note = await trpcVanillaClient.entities.get.query({ id: sourceNoteId });
  const next = toggleChecklistLine(note.body, { line, text }, done);
  if (next === null) {
    throw new Error("Ligne source introuvable dans la note — todo désynchronisée");
  }

  await trpcVanillaClient.entities.update.mutate({
    id: sourceNoteId,
    body: next,
  });

  return done;
}

/**
 * Replace the inline metadata of a notes-derived todo. The source note's
 * markdown line is rewritten to reflect the new priority / importance /
 * dueDate; defaults are stripped from the line so unedited todos stay
 * visually clean.
 */
export async function updateTodoMetadata(args: {
  sourceNoteId: string;
  cleanText: string;
  line: number;
  priority: number;
  importance: TodoImportance;
  startDate?: string | null;
  dueDate: string | null;
}): Promise<void> {
  const { sourceNoteId, cleanText, line, priority, importance, startDate, dueDate } = args;

  const note = await trpcVanillaClient.entities.get.query({ id: sourceNoteId });
  const nextRawText = formatInlineMetadata(cleanText, {
    priority,
    importance,
    startDate: startDate || null,
    dueDate: dueDate || null,
  });
  const nextBody = rewriteChecklistLine(
    note.body,
    { line, cleanText },
    nextRawText,
  );
  if (nextBody === null) {
    throw new Error("Ligne source introuvable dans la note — édition impossible");
  }

  await trpcVanillaClient.entities.update.mutate({
    id: sourceNoteId,
    body: nextBody,
  });
}
