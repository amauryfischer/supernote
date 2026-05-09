"use client";

/**
 * useTodoSync — orchestrates the smart-todos pipeline for a single note.
 *
 * Pipeline (runs on note save / debounce):
 *   1. Parse the body for `- [ ]` / `- [x]` checklist items.
 *   2. Compare the body hash against `note.fields.todoCache.processedBodyHash`.
 *      If unchanged AND the cache covers every detected blockId → skip the
 *      reconciliation step (entities are already in sync).
 *   3. Apply the deterministic heuristic filter (see `heuristicFilter.ts`)
 *      to drop reference-style sections and too-short items.
 *   4. Reconcile against existing `todo` entities for this note:
 *      - upsert each kept item (keyed by `blockId`)
 *      - delete todos whose source line vanished
 *      - flip `done` if the markdown checkbox state changed
 *   5. Persist the new cache blob into the note's `todoCache` field via a
 *      silent `entities.update` (fields-only patch, no body write).
 *
 * The hook is also responsible for the *reverse* sync: when the user toggles
 * a todo from the /todos panel, `toggleTodoDone` flips the box in the note
 * markdown and updates both the note and the todo entity.
 *
 * No external services. Browser-only, deterministic.
 */

import { useCallback, useEffect, useRef } from "react";
import { trpcVanillaClient } from "@/lib/trpc/client";
import {
  extractChecklists,
  hashBody,
  toggleChecklistLine,
} from "@/lib/todos/extractChecklists";
import { filterChecklistsHeuristic } from "@/lib/todos/heuristicFilter";

export const TODO_TYPE_ID = "todo";
const SYNC_DEBOUNCE_MS = 1500;

/** Persisted cache shape stored in `note.fields.todoCache`. */
export interface TodoCacheEntry {
  processedAt: string; // ISO datetime
  processedBodyHash: string;
  todos: Array<{
    blockId: string;
    line: number;
    text: string;
    /** True if the heuristic kept this line as a real todo. */
    isTodo: boolean;
    /** Last-seen done state in the source markdown. */
    done: boolean;
    /** Resolved entity id once the todo has been persisted. */
    todoId?: string;
  }>;
}

/** Best-effort parse of the persisted cache. Returns null if absent or invalid. */
function readCache(fields: Record<string, unknown> | undefined): TodoCacheEntry | null {
  const raw = fields?.["todoCache"];
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as TodoCacheEntry;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.processedBodyHash !== "string") return null;
    if (!Array.isArray(parsed.todos)) return null;
    return parsed;
  } catch {
    return null;
  }
}

interface SyncContext {
  noteId: string;
  noteTitle: string;
  body: string;
  fields: Record<string, unknown>;
}

interface SyncOutcome {
  /** True if reconciliation actually wrote anything this run. */
  reconciled: boolean;
  todosCreated: number;
  todosUpdated: number;
  todosDeleted: number;
}

/**
 * Run the full todo-sync pipeline for one note. Exported so non-hook callers
 * (e.g. a /todos "rescan all" button) can reuse it. Safe to call from any
 * client context — mutations route through the vault worker via tRPC.
 */
export async function syncNoteTodos(ctx: SyncContext): Promise<SyncOutcome> {
  const outcome: SyncOutcome = {
    reconciled: false,
    todosCreated: 0,
    todosUpdated: 0,
    todosDeleted: 0,
  };

  const items = extractChecklists(ctx.body);
  const cache = readCache(ctx.fields);
  const bodyHash = hashBody(ctx.body);

  // Existing todo entities for this note. We pull them up-front so we can
  // reconcile creates / updates / deletes in one pass.
  const existingList = await trpcVanillaClient.entities.list.query({
    typeId: TODO_TYPE_ID,
    limit: 1000,
    offset: 0,
  });
  const existingForNote = (existingList.items ?? []).filter((e) => {
    const sn = e.fields?.["sourceNoteId"];
    return typeof sn === "string" && sn === ctx.noteId;
  });
  const existingByBlock = new Map<string, (typeof existingForNote)[number]>();
  for (const e of existingForNote) {
    const range = e.fields?.["sourceLineRange"];
    if (typeof range !== "string") continue;
    try {
      const parsed = JSON.parse(range) as { blockId?: string };
      if (parsed?.blockId) existingByBlock.set(parsed.blockId, e);
    } catch {
      /* ignore malformed legacy entries */
    }
  }

  // No checklist syntax in the note → drop any prior todos and clear cache.
  if (items.length === 0) {
    for (const e of existingForNote) {
      try {
        await trpcVanillaClient.entities.delete.mutate({ id: e.id });
        outcome.todosDeleted++;
        outcome.reconciled = true;
      } catch {
        /* ignore — best effort */
      }
    }
    if (cache) {
      try {
        await trpcVanillaClient.entities.update.mutate({
          id: ctx.noteId,
          fields: { todoCache: "" },
        });
      } catch {
        /* ignore */
      }
    }
    return outcome;
  }

  // The cache lets us skip the reconciliation when nothing changed: same
  // body hash AND every detected blockId is already in the cache.
  const cacheCoversAll =
    !!cache &&
    cache.processedBodyHash === bodyHash &&
    items.every((it) => cache.todos.some((c) => c.blockId === it.blockId));

  // Apply the heuristic filter on every run — it's pure & cheap. The cache
  // helps us skip the network round-trips below, not the filter itself.
  const kept = filterChecklistsHeuristic(ctx.body, items);
  const keptByBlock = new Map(kept.map((it) => [it.blockId, it]));

  const verdicts = items.map((it) => ({
    blockId: it.blockId,
    line: it.line,
    text: it.text,
    isTodo: keptByBlock.has(it.blockId),
    done: it.done,
  }));

  if (cacheCoversAll && cache) {
    // Refresh the in-memory `done` state from the freshly-parsed items so a
    // "user manually flipped a box" round-trips into the todo entity even
    // when the cache fast-path triggers.
    for (const v of verdicts) {
      const cached = cache.todos.find((c) => c.blockId === v.blockId);
      if (cached) cached.done = v.done;
    }
  }

  // ── Reconcile entities ───────────────────────────────────────────────────
  const seenBlockIds = new Set<string>();
  const todoIdByBlock: Record<string, string> = {};

  for (const v of verdicts) {
    if (!v.isTodo) continue;
    seenBlockIds.add(v.blockId);
    const existing = existingByBlock.get(v.blockId);
    if (existing) {
      // Patch text + done if they drifted.
      const fieldsPatch: Record<string, string | number | boolean | string[] | null> = {};
      if (existing.fields?.["text"] !== v.text) fieldsPatch["text"] = v.text;
      const prevDone =
        existing.fields?.["done"] === true || existing.fields?.["done"] === "true";
      if (prevDone !== v.done) fieldsPatch["done"] = v.done;
      // Always refresh the line range — line indices shift when the user
      // adds/removes content above the checkbox.
      fieldsPatch["sourceLineRange"] = JSON.stringify({
        start: v.line,
        end: v.line,
        blockId: v.blockId,
      });
      try {
        await trpcVanillaClient.entities.update.mutate({
          id: existing.id,
          fields: fieldsPatch,
        });
        outcome.todosUpdated++;
        outcome.reconciled = true;
        todoIdByBlock[v.blockId] = existing.id;
      } catch {
        /* ignore — single-item failures shouldn't tank the batch */
      }
    } else {
      try {
        const created = await trpcVanillaClient.entities.create.mutate({
          typeId: TODO_TYPE_ID,
          fields: {
            text: v.text,
            done: v.done,
            sourceNoteId: ctx.noteId,
            sourceLineRange: JSON.stringify({
              start: v.line,
              end: v.line,
              blockId: v.blockId,
            }),
            // Sensible defaults; user can adjust from the EditTodoModal.
            // `priority` is numeric (1-9), `importance` is the pastille level.
            priority: 5,
            importance: "medium",
          },
        });
        outcome.todosCreated++;
        outcome.reconciled = true;
        todoIdByBlock[v.blockId] = created.id;
      } catch {
        /* ignore */
      }
    }
  }

  // Drop todos whose source line is gone or no longer flagged as a todo.
  for (const [blockId, ent] of existingByBlock.entries()) {
    if (seenBlockIds.has(blockId)) continue;
    try {
      await trpcVanillaClient.entities.delete.mutate({ id: ent.id });
      outcome.todosDeleted++;
      outcome.reconciled = true;
    } catch {
      /* ignore */
    }
  }

  // ── Persist cache ────────────────────────────────────────────────────────
  const newCache: TodoCacheEntry = {
    processedAt: new Date().toISOString(),
    processedBodyHash: bodyHash,
    todos: verdicts.map((v) => ({
      blockId: v.blockId,
      line: v.line,
      text: v.text,
      isTodo: v.isTodo,
      done: v.done,
      todoId: todoIdByBlock[v.blockId],
    })),
  };
  try {
    await trpcVanillaClient.entities.update.mutate({
      id: ctx.noteId,
      fields: { todoCache: JSON.stringify(newCache) },
    });
  } catch {
    /* the cache is a best-effort optimisation; ignore failures */
  }

  return outcome;
}

export interface UseTodoSyncResult {
  /**
   * Schedule a todo-sync run for this note. Debounced to avoid hammering
   * the worker during continuous typing.
   */
  scheduleSync: (body: string) => void;
  /**
   * Force-flush any pending sync (e.g. on manual save). Returns the outcome
   * of the run, or null if nothing was pending.
   */
  flushSync: () => Promise<SyncOutcome | null>;
}

/**
 * Wire a NoteEditor instance to the smart-todos pipeline. The caller passes
 * the latest tRPC entity (so we can read `fields.todoCache` without an
 * extra fetch) and feeds the body into `scheduleSync` from its own debounce.
 */
export function useTodoSync(note: {
  id: string;
  title: string;
  fields: Record<string, unknown>;
}): UseTodoSyncResult {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBodyRef = useRef<string | null>(null);
  const noteRef = useRef(note);
  noteRef.current = note;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const runNow = useCallback(async (): Promise<SyncOutcome | null> => {
    const body = pendingBodyRef.current;
    if (body === null) return null;
    pendingBodyRef.current = null;
    try {
      return await syncNoteTodos({
        noteId: noteRef.current.id,
        noteTitle: noteRef.current.title,
        body,
        fields: noteRef.current.fields,
      });
    } catch {
      return null;
    }
  }, []);

  const scheduleSync = useCallback(
    (body: string): void => {
      pendingBodyRef.current = body;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void runNow();
      }, SYNC_DEBOUNCE_MS);
    },
    [runNow],
  );

  const flushSync = useCallback(async (): Promise<SyncOutcome | null> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    return runNow();
  }, [runNow]);

  return { scheduleSync, flushSync };
}

/**
 * Toggle a todo's done state from the /todos panel and propagate the change
 * back into the source note's markdown. Returns the new `done` value (i.e.
 * the requested value) on success; throws if the source note can't be
 * found or rewritten — the caller should surface that as a toast.
 */
export async function toggleTodoDone(args: {
  todoId: string;
  sourceNoteId: string;
  text: string;
  line: number;
  done: boolean;
}): Promise<boolean> {
  const { todoId, sourceNoteId, text, line, done } = args;

  // 1) Read the source note.
  const note = await trpcVanillaClient.entities.get.query({ id: sourceNoteId });
  const next = toggleChecklistLine(note.body, { line, text }, done);
  if (next === null) {
    // Source line gone — still flip the todo so the user isn't stuck, but
    // signal failure so the UI can offer to detach the link.
    await trpcVanillaClient.entities.update.mutate({
      id: todoId,
      fields: { done },
    });
    throw new Error("Ligne source introuvable dans la note — todo désynchronisée");
  }

  // 2) Rewrite the note body. We DON'T re-run sync from here — useTodoSync
  //    will pick up the change next time the user opens the editor (or via
  //    the /todos rescan button). Otherwise a chain of mutations could
  //    fight TanStack Query's invalidation.
  await trpcVanillaClient.entities.update.mutate({
    id: sourceNoteId,
    body: next,
  });

  // 3) Update the todo entity.
  await trpcVanillaClient.entities.update.mutate({
    id: todoId,
    fields: { done },
  });

  return done;
}
