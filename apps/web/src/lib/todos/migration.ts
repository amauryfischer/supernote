/**
 * Legacy `todo` entity → inline-markdown migration.
 *
 * The previous reconciler created one `todo` entity per checklist line in
 * every note, keyed by an unstable blockId (line index + text hash). Any
 * line shift or text edit caused a "create new + delete old" pass, and
 * the slightest race or silent delete failure left orphans behind. Many
 * users have hundreds-to-thousands of duplicates per note.
 *
 * This one-shot pass:
 *   1. Loads every legacy entity (typeId=todo with a sourceNoteId) and
 *      groups them by source note.
 *   2. For each note, deduplicates entities by clean text — keeping the
 *      most recently updated one and merging non-default metadata
 *      (priority, importance, dueDate, done) from every duplicate so we
 *      don't lose user-curated values.
 *   3. Locates the matching markdown line in the note's body and rewrites
 *      it with the inline metadata syntax (`!P3 🔴 📅 …`).
 *   4. Saves the note ONCE per pass, then deletes every legacy entity for
 *      that note, then strips the dead `todoCache` field.
 *
 * Standalone todos (entities with no `sourceNoteId`) are never touched.
 */

import { trpcVanillaClient } from "@/lib/trpc/client";
import {
  formatInlineMetadata,
  parseInlineMetadata,
  type TodoImportance,
} from "./inlineMetadata";

const TODO_TYPE_ID = "todo";

export interface MigrationOutcome {
  /** Number of legacy entities discovered. */
  entitiesScanned: number;
  /** Notes whose body was rewritten. */
  notesUpdated: number;
  /** Legacy entities deleted (always equals entitiesScanned on success). */
  entitiesDeleted: number;
  /** Among the scanned entities, how many were duplicates of another. */
  duplicatesMerged: number;
  /** Notes whose `todoCache` field was cleared. */
  cachesCleared: number;
}

interface LegacyTodo {
  id: string;
  text: string;
  done: boolean;
  priority: number | null;
  importance: TodoImportance | null;
  dueDate: string | null;
  sourceNoteId: string;
  line: number | null;
  blockId: string | null;
  updatedAt: string;
}

/** Cleanly normalize a candidate text for grouping: clean inline metadata
 *  off, strip whitespace runs, lowercase. Two entities with the same
 *  normalized text are treated as duplicates of one another. */
function normalizeText(t: string): string {
  return parseInlineMetadata(t).cleanText.replace(/\s+/g, " ").trim().toLowerCase();
}

function parseImportance(v: unknown): TodoImportance | null {
  if (v === "low" || v === "medium" || v === "high" || v === "critical") return v;
  return null;
}

function parsePriority(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.min(9, Math.max(1, Math.round(v)));
  }
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.min(9, Math.max(1, Math.round(n)));
    if (v === "low") return 7;
    if (v === "medium") return 5;
    if (v === "high") return 3;
  }
  return null;
}

/** Same regex as extractChecklists — duplicated rather than imported to
 *  avoid pulling the heuristic filter and hashing into the migration code path. */
const CHECKLIST_RE = /^(\s*(?:[-*+]|\d+\.)\s+)\[( |x|X)\]\s+(.+?)\s*$/;

/**
 * Locate the markdown line for `legacy` in `body`. Returns the matched
 * line index, or `-1` when none of our heuristics work (line gone, text
 * mutated past recognition).
 *
 * Strategy: try the recorded line index first; then scan the whole body
 * for a checklist line whose normalized text matches.
 */
function locateLine(body: string, legacy: LegacyTodo): number {
  const lines = body.split(/\r?\n/);
  const wantClean = normalizeText(legacy.text);
  if (!wantClean) return -1;

  if (legacy.line !== null && legacy.line >= 0 && legacy.line < lines.length) {
    const m = CHECKLIST_RE.exec(lines[legacy.line] ?? "");
    if (m && normalizeText(m[3] ?? "") === wantClean) return legacy.line;
  }
  for (let i = 0; i < lines.length; i++) {
    const m = CHECKLIST_RE.exec(lines[i] ?? "");
    if (!m) continue;
    if (normalizeText(m[3] ?? "") === wantClean) return i;
  }
  return -1;
}

/** Merge metadata from every duplicate in the group: pick the most recent
 *  non-default value for each field. Done is ORed — if any duplicate was
 *  marked done, the merged todo is done. */
function mergeGroup(group: LegacyTodo[]): {
  text: string;
  priority: number;
  importance: TodoImportance;
  dueDate: string | null;
  done: boolean;
} {
  // Sort newest first so the first non-default we encounter wins.
  const sorted = [...group].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  let priority = 5;
  let importance: TodoImportance = "medium";
  let dueDate: string | null = null;
  let done = false;
  let text = sorted[0]?.text ?? "";
  for (const e of sorted) {
    if (e.done) done = true;
    if (priority === 5 && e.priority !== null && e.priority !== 5) priority = e.priority;
    if (importance === "medium" && e.importance && e.importance !== "medium") {
      importance = e.importance;
    }
    if (!dueDate && e.dueDate) dueDate = e.dueDate;
  }
  return { text: parseInlineMetadata(text).cleanText, priority, importance, dueDate, done };
}

export async function migrateLegacyTodos(): Promise<MigrationOutcome> {
  const outcome: MigrationOutcome = {
    entitiesScanned: 0,
    notesUpdated: 0,
    entitiesDeleted: 0,
    duplicatesMerged: 0,
    cachesCleared: 0,
  };

  // Pull every legacy entity in one shot. 5000 is generous; anyone above
  // that is in deep enough trouble that a second pass is acceptable.
  const list = await trpcVanillaClient.entities.list.query({
    typeId: TODO_TYPE_ID,
    limit: 5000,
    offset: 0,
  });
  const all = (list.items ?? []) as Array<{
    id: string;
    fields?: Record<string, unknown>;
    updatedAt: string;
  }>;

  const legacy: LegacyTodo[] = [];
  for (const e of all) {
    const f = e.fields ?? {};
    const sn = f["sourceNoteId"];
    if (typeof sn !== "string" || !sn) continue;
    let line: number | null = null;
    let blockId: string | null = null;
    const range = f["sourceLineRange"];
    if (typeof range === "string") {
      try {
        const parsed = JSON.parse(range) as { start?: number; blockId?: string };
        if (typeof parsed?.start === "number") line = parsed.start;
        if (typeof parsed?.blockId === "string") blockId = parsed.blockId;
      } catch {
        /* legacy / malformed — that's exactly why we're migrating */
      }
    }
    legacy.push({
      id: e.id,
      text: typeof f["text"] === "string" ? (f["text"] as string) : "",
      done: f["done"] === true || f["done"] === "true",
      priority: parsePriority(f["priority"]),
      importance: parseImportance(f["importance"]),
      dueDate: typeof f["dueDate"] === "string" ? (f["dueDate"] as string) : null,
      sourceNoteId: sn,
      line,
      blockId,
      updatedAt: e.updatedAt,
    });
  }
  outcome.entitiesScanned = legacy.length;
  if (legacy.length === 0) return outcome;

  // Group by sourceNoteId.
  const byNote = new Map<string, LegacyTodo[]>();
  for (const l of legacy) {
    const arr = byNote.get(l.sourceNoteId) ?? [];
    arr.push(l);
    byNote.set(l.sourceNoteId, arr);
  }

  for (const [noteId, items] of byNote.entries()) {
    let note: { id: string; body: string; fields?: Record<string, unknown> };
    try {
      note = await trpcVanillaClient.entities.get.query({ id: noteId });
    } catch {
      // Note gone — just delete the orphan entities.
      for (const it of items) {
        try {
          await trpcVanillaClient.entities.delete.mutate({ id: it.id });
          outcome.entitiesDeleted++;
        } catch {
          /* best-effort */
        }
      }
      continue;
    }

    // Group duplicates of THIS note by normalized text.
    const groupsByText = new Map<string, LegacyTodo[]>();
    for (const it of items) {
      const key = normalizeText(it.text);
      if (!key) continue;
      const arr = groupsByText.get(key) ?? [];
      arr.push(it);
      groupsByText.set(key, arr);
    }

    let body = note.body ?? "";
    let bodyChanged = false;

    for (const group of groupsByText.values()) {
      if (group.length > 1) outcome.duplicatesMerged += group.length - 1;
      const merged = mergeGroup(group);
      // Pick the duplicate whose `line` still locates a real markdown line —
      // try the most recently updated one first.
      let lineIdx = -1;
      for (const it of [...group].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
        lineIdx = locateLine(body, it);
        if (lineIdx !== -1) break;
      }
      if (lineIdx === -1) continue; // source line gone — drop the entities silently below

      const lines = body.split(/\r?\n/);
      const m = CHECKLIST_RE.exec(lines[lineIdx] ?? "");
      if (!m) continue;
      const prefix = m[1] ?? "";
      const mark = merged.done ? "x" : (m[2] ?? " ");
      const nextRawText = formatInlineMetadata(merged.text, {
        priority: merged.priority,
        importance: merged.importance,
        dueDate: merged.dueDate,
      });
      const nextLine = `${prefix}[${mark}] ${nextRawText}`;
      if (lines[lineIdx] !== nextLine) {
        lines[lineIdx] = nextLine;
        body = lines.join("\n");
        bodyChanged = true;
      }
    }

    // Strip the now-defunct `todoCache` field while we're at it.
    const hadCache =
      typeof note.fields?.["todoCache"] === "string" && note.fields["todoCache"];
    if (bodyChanged || hadCache) {
      try {
        await trpcVanillaClient.entities.update.mutate({
          id: noteId,
          ...(bodyChanged ? { body } : {}),
          ...(hadCache ? { fields: { todoCache: "" } } : {}),
        });
        if (bodyChanged) outcome.notesUpdated++;
        if (hadCache) outcome.cachesCleared++;
      } catch {
        // If the body write failed we abort this note — better than
        // deleting the entities whose data we couldn't persist.
        continue;
      }
    }

    // Now safe to delete every legacy entity for this note.
    for (const it of items) {
      try {
        await trpcVanillaClient.entities.delete.mutate({ id: it.id });
        outcome.entitiesDeleted++;
      } catch {
        /* best-effort */
      }
    }
  }

  return outcome;
}
