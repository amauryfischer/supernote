"use client";

/**
 * useTodoSync — orchestrates the smart-todos pipeline for a single note.
 *
 * Pipeline (runs on note save / debounce):
 *   1. Parse the body for `- [ ]` / `- [x]` checklist items.
 *   2. Compare the body hash against `note.fields.todoCache.processedBodyHash`.
 *      If unchanged → reuse the cached AI verdicts, skip the LLM call.
 *   3. Otherwise call Ollama (`aiVerifyTodos`) to filter out rhetorical
 *      checkboxes; on any failure, fall back to "every checkbox is a todo".
 *   4. Reconcile against existing `todo` entities for this note:
 *      - upsert each verified todo (keyed by `blockId`)
 *      - delete todos whose source line vanished
 *      - flip `done` if the markdown checkbox state changed
 *   5. Persist the new cache blob into the note's `todoCache` field via a
 *      silent `entities.update` (fields-only patch, no body write).
 *
 * The hook is also responsible for the *reverse* sync: when the user toggles
 * a todo from the /todos panel, `toggleTodoDone` flips the box in the note
 * markdown and updates both the note and the todo entity.
 *
 * Opt-in via the localStorage flag `supernote.ai.autoTodos` (set from
 * Settings → IA & Ollama). When disabled the hook is an inert no-op.
 *
 * No npm deps. Browser-only.
 */

import { useCallback, useEffect, useRef } from "react";
import { trpcVanillaClient } from "@/lib/trpc/client";
import {
  extractChecklists,
  hashBody,
  toggleChecklistLine,
  type ChecklistItem,
} from "@/lib/todos/extractChecklists";
import { aiVerifyTodos } from "@/lib/todos/aiVerify";

export const AUTO_TODOS_ENABLED_KEY = "supernote.ai.autoTodos";
export const TODO_TYPE_ID = "todo";
const SYNC_DEBOUNCE_MS = 1500;

/** Persisted cache shape stored in `note.fields.todoCache`. */
export interface TodoCacheEntry {
  processedAt: string; // ISO datetime
  processedBodyHash: string;
  /** Snapshot of the LLM verdicts so we can re-render without re-asking. */
  todos: Array<{
    blockId: string;
    line: number;
    text: string;
    isTodo: boolean;
    /** Last-seen done state in the source markdown. */
    done: boolean;
    /** Resolved entity id once the todo has been persisted. */
    todoId?: string;
  }>;
}

export function isAutoTodosEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(AUTO_TODOS_ENABLED_KEY) === "1";
  } catch {
    return false;
  }
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
  /** True if the AI was actually called this run. */
  aiCalled: boolean;
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
    aiCalled: false,
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

  // Decide whether to hit the LLM. We can reuse the cache when:
  //   - the body hash matches, AND
  //   - the cache covers every detected blockId (so a freshly-added line
  //     forces a re-verify even if the rest is unchanged).
  let verdicts: Array<{ blockId: string; line: number; text: string; isTodo: boolean; done: boolean }> = [];
  const cacheCoversAll =
    !!cache &&
    cache.processedBodyHash === bodyHash &&
    items.every((it) =>
      cache.todos.some((c) => c.blockId === it.blockId),
    );

  if (cacheCoversAll && cache) {
    // Reuse cache; refresh `done` state from the freshly-parsed items so a
    // "user manually flipped a box" round-trips into the todo entity.
    verdicts = items.map((it) => {
      const hit = cache.todos.find((c) => c.blockId === it.blockId);
      return {
        blockId: it.blockId,
        line: it.line,
        text: it.text,
        isTodo: hit?.isTodo ?? true,
        done: it.done,
      };
    });
  } else {
    outcome.aiCalled = true;
    const aiResults = await aiVerifyTodos(
      items.map((it) => ({ line: it.line, text: it.text })),
    );
    // Re-pair AI verdicts with our items by line+text. aiVerifyTodos
    // guarantees one result per input in input order, so a positional zip
    // is safe — but we double-check to be defensive.
    verdicts = items.map((it, idx) => {
      const r = aiResults[idx];
      const isTodo =
        r && r.line === it.line && r.text === it.text ? r.isTodo : true;
      return {
        blockId: it.blockId,
        line: it.line,
        text: it.text,
        isTodo,
        done: it.done,
      };
    });
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
   * Ollama during continuous typing. No-op when the feature toggle is off.
   */
  scheduleSync: (body: string) => void;
  /**
   * Force-flush any pending sync (e.g. on manual save). Returns the outcome
   * of the run, or null when the feature is disabled / no work was scheduled.
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
    if (!isAutoTodosEnabled()) return null;
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
      if (!isAutoTodosEnabled()) return;
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
