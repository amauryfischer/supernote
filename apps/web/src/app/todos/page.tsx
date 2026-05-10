"use client";

/**
 * /todos — manage every todo (extracted from notes or created manually).
 *
 * Two distinct sources feed this page:
 *
 *   1. Notes-derived todos — pure projection of every note's markdown body.
 *      No DB row per todo, no sync pipeline. Toggling done / editing
 *      metadata rewrites the source markdown line.
 *
 *   2. Standalone todos — `todo` entities created via the "+" button with
 *      no source note. They keep their entity-based identity because there
 *      is no markdown to project from.
 *
 * The migration helper at the top of the page mops up legacy entities that
 * were created by the old reconciler-based pipeline (every checkbox got
 * its own `todo` row, often duplicated dozens of times). One click
 * re-materializes their metadata as inline markdown tokens on the source
 * note's line and deletes the entities. Standalones are never touched.
 */

import {
  AppShell,
  useMobileFab,
  useMobileHeaderActions,
  useMobileTitle,
  type MobileHeaderAction,
} from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { trpc, trpcVanillaClient } from "@/lib/trpc/client";
import {
  CheckSquare,
  FileText,
  ArrowsClockwise,
  Plus,
  Envelope,
  SortAscending,
  ListBullets,
  Tag,
  Pencil,
  Check,
  Trash,
  DotsSixVertical,
  CalendarBlank,
  List,
} from "@phosphor-icons/react";
import { EmptyState, ContextMenu, useContextMenu, type ContextMenuItemDef } from "@supernote/ui";
import { importanceColor, importanceLabel } from "@/components/todos/TodoRow";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  toggleTodoDone,
  updateTodoMetadata,
  TODO_TYPE_ID,
} from "@/hooks/useTodoSync";
import { extractChecklists } from "@/lib/todos/extractChecklists";
import { filterChecklistsHeuristic } from "@/lib/todos/heuristicFilter";
import { migrateLegacyTodos, type MigrationOutcome } from "@/lib/todos/migration";
import { PromptModal } from "@/components/shell/PromptModal";
import { TodoRow, type TodoImportance, type TodoRowData } from "@/components/todos/TodoRow";
import { EditTodoModal, type EditTodoValues } from "@/components/todos/EditTodoModal";
import { TodoCalendarView } from "@/components/todos/TodoCalendarView";
import {
  composeTodoMailto,
  composeAllTodosMailto,
  readDefaultEmail,
  type MailableTodo,
} from "@/components/todos/EmailComposer";

type Filter = "all" | "pending" | "done" | "today" | "urgent" | "thisWeek";
type SortKey = "priority" | "importance" | "dueDate" | "createdAt" | "manual";
type ViewMode = "list" | "calendar";

interface UiTodoRow extends TodoRowData {
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

/** Returns true if the ISO date string is within the current calendar week
 *  (Mon–Sun). */
function isThisWeek(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  // Compute Monday of current week.
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, …
  const diffToMon = (dayOfWeek + 6) % 7; // days since Monday
  const mon = new Date(now);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(now.getDate() - diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return d >= mon && d <= sun;
}

/** Returns true if the todo's date range [startDate..dueDate] intersects
 *  the current week. A point date (start or due only) is tested directly. */
function intersectsThisWeek(row: UiTodoRow): boolean {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMon = (dayOfWeek + 6) % 7;
  const mon = new Date(now);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(now.getDate() - diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);

  const start = row.startDate ? new Date(row.startDate) : null;
  const due = row.dueDate ? new Date(row.dueDate) : null;

  if (start && due) {
    // Range intersects week when: start <= sun AND due >= mon
    return start <= sun && due >= mon;
  }
  if (due) return due >= mon && due <= sun;
  if (start) return start >= mon && start <= sun;
  return false;
}

function isToday(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

const IMPORTANCE_RANK: Record<TodoImportance, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function parseStandaloneImportance(v: unknown): TodoImportance | null {
  if (v === "low" || v === "medium" || v === "high" || v === "critical") return v;
  return null;
}

function parseStandalonePriority(v: unknown): number | null {
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

export default function TodosPage() {
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<Filter>("pending");
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  // Optimistic manual order for standalone todos in "manual" sort mode.
  const [manualTodoOrder, setManualTodoOrder] = useState<string[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationDismissed, setMigrationDismissed] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<UiTodoRow | null>(null);
  const [tagFilter, setTagFilter] = useState<Set<string>>(() => new Set());
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window === "undefined") return "list";
    try {
      const v = window.localStorage.getItem("supernote.todos.viewMode");
      return v === "calendar" ? "calendar" : "list";
    } catch {
      return "list";
    }
  });
  const toggleViewMode = useCallback(() => {
    setViewMode((v) => {
      const next = v === "list" ? "calendar" : "list";
      try {
        window.localStorage.setItem("supernote.todos.viewMode", next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const [groupByNote, setGroupByNote] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("supernote.todos.groupByNote") === "1";
    } catch {
      return false;
    }
  });
  const toggleGroupByNote = useCallback(() => {
    setGroupByNote((v) => {
      const next = !v;
      try {
        window.localStorage.setItem("supernote.todos.groupByNote", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const toggleTag = useCallback((tag: string) => {
    setTagFilter((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  // Notes carry the bodies we project todos from. We bump the limit because
  // the whole point of /todos is a global view; 5000 is plenty for a personal
  // vault and avoids a follow-up `entities.get` round-trip per note.
  const notesQuery = trpc.entities.list.useQuery(
    { typeId: "note", limit: 5000, offset: 0 },
    { staleTime: 30_000, refetchOnMount: "always" },
  );
  // Standalones — entities of type `todo`. These survive the new model and
  // are still toggled/edited via `entities.update`.
  const todosQuery = trpc.entities.list.useQuery(
    { typeId: TODO_TYPE_ID, limit: 5000, offset: 0 },
    { staleTime: 30_000, refetchOnMount: "always" },
  );

  // Legacy entities = `todo` with a `sourceNoteId`. Used by the migration
  // banner + auto-run effect; once everything has been migrated this stays
  // at 0 and the banner is silent.
  const legacyCount = useMemo(() => {
    const items = todosQuery.data?.items ?? [];
    return items.filter((e) => {
      const sn = e.fields?.["sourceNoteId"];
      return typeof sn === "string" && sn.length > 0;
    }).length;
  }, [todosQuery.data]);

  const todoDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

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
          sourceNoteTitle: title,
          sourceNoteTags: tags,
          createdAt: n.updatedAt,
          sortOrder: null,
        });
      }
    }
    return out;
  }, [notesQuery.data]);

  const standaloneRows: UiTodoRow[] = useMemo(() => {
    const items = todosQuery.data?.items ?? [];
    return items
      .filter((e) => {
        // Skip legacy note-derived entities — they're hidden until migrated.
        // Otherwise the user would see every duplicate alongside the new
        // projected rows.
        const sn = e.fields?.["sourceNoteId"];
        return !(typeof sn === "string" && sn.length > 0);
      })
      .map((e) => {
        const f = e.fields ?? {};
        const text = typeof f["text"] === "string" ? (f["text"] as string) : "(sans texte)";
        return {
          kind: "standalone" as const,
          id: e.id,
          text,
          done: f["done"] === true || f["done"] === "true",
          sourceNoteId: null,
          line: null,
          blockId: null,
          startDate: typeof f["startDate"] === "string" ? (f["startDate"] as string) : null,
          dueDate: typeof f["dueDate"] === "string" ? (f["dueDate"] as string) : null,
          priority: parseStandalonePriority(f["priority"]),
          importance: parseStandaloneImportance(f["importance"]),
          sourceNoteTitle: null,
          sourceNoteTags: [],
          createdAt: e.createdAt,
          sortOrder: typeof f["sortOrder"] === "number" ? (f["sortOrder"] as number) : null,
        };
      });
  }, [todosQuery.data]);

  const allTodos: UiTodoRow[] = useMemo(
    () => [...noteRows, ...standaloneRows],
    [noteRows, standaloneRows],
  );

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTodos) for (const tag of t.sourceNoteTags) set.add(tag);
    return Array.from(set).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase()),
    );
  }, [allTodos]);

  const filteredTodos = useMemo(() => {
    return allTodos.filter((t) => {
      if (filter === "pending" && t.done) return false;
      if (filter === "done" && !t.done) return false;
      if (filter === "today" && !isToday(t.dueDate)) return false;
      if (filter === "thisWeek" && !intersectsThisWeek(t)) return false;
      if (
        filter === "urgent" &&
        !(t.importance === "critical" || (t.priority !== null && t.priority <= 3))
      ) {
        return false;
      }
      if (tagFilter.size > 0) {
        const hit = t.sourceNoteTags.some((tag) => tagFilter.has(tag));
        if (!hit) return false;
      }
      return true;
    });
  }, [allTodos, filter, tagFilter]);

  const sortedTodos = useMemo(() => {
    if (sortKey === "manual") {
      // Manual sort: standalone todos sorted by sortOrder (optimistic or persisted),
      // then by createdAt as tiebreaker. Notes-derived todos are appended after.
      const standalones = filteredTodos.filter((t) => t.kind === "standalone");
      const noteDerived = filteredTodos.filter((t) => t.kind === "note");

      if (manualTodoOrder) {
        const idx = new Map(manualTodoOrder.map((id, i) => [id, i]));
        standalones.sort((a, b) => {
          const ia = idx.get(a.id) ?? Infinity;
          const ib = idx.get(b.id) ?? Infinity;
          if (ia !== ib) return ia - ib;
          return a.createdAt.localeCompare(b.createdAt);
        });
      } else {
        standalones.sort((a, b) => {
          const sa = a.sortOrder ?? Infinity;
          const sb = b.sortOrder ?? Infinity;
          if (sa !== sb) return sa - sb;
          return a.createdAt.localeCompare(b.createdAt);
        });
      }
      return [...standalones, ...noteDerived];
    }

    const arr = [...filteredTodos];
    arr.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      switch (sortKey) {
        case "priority": {
          const pa = a.priority ?? 5;
          const pb = b.priority ?? 5;
          if (pa !== pb) return pa - pb;
          return (
            IMPORTANCE_RANK[a.importance ?? "medium"] -
            IMPORTANCE_RANK[b.importance ?? "medium"]
          );
        }
        case "importance":
          return (
            IMPORTANCE_RANK[a.importance ?? "medium"] -
            IMPORTANCE_RANK[b.importance ?? "medium"]
          );
        case "dueDate": {
          // Use whichever date is set, dueDate first (the deadline drives
          // urgency). Without this fallback, a todo with only `startDate`
          // (date de début, no deadline) would always sink to the bottom
          // — surprising once date ranges came in.
          const tsOf = (iso: string | null) =>
            iso ? new Date(iso).getTime() : Infinity;
          const da = Math.min(tsOf(a.dueDate), tsOf(a.startDate));
          const db = Math.min(tsOf(b.dueDate), tsOf(b.startDate));
          if (da !== db) return da - db;
          // Same date → urgent (low priority number) first. Without this,
          // ties resolved on object insertion order which surfaced no
          // meaningful signal.
          const pa = a.priority ?? 5;
          const pb = b.priority ?? 5;
          if (pa !== pb) return pa - pb;
          return b.createdAt.localeCompare(a.createdAt);
        }
        case "createdAt":
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });
    return arr;
  }, [filteredTodos, sortKey, manualTodoOrder]);

  const invalidateAll = useCallback(async () => {
    await Promise.all([
      utils.entities.list.invalidate({ typeId: "note" }),
      utils.entities.list.invalidate({ typeId: TODO_TYPE_ID }),
    ]);
  }, [utils]);

  const handleToggle = useCallback(
    async (row: UiTodoRow) => {
      if (row.kind === "standalone") {
        try {
          await trpcVanillaClient.entities.update.mutate({
            id: row.id,
            fields: { done: !row.done },
          });
          await utils.entities.list.invalidate({ typeId: TODO_TYPE_ID });
        } catch {
          showToast("Erreur lors de la mise à jour");
        }
        return;
      }
      // Notes-derived: round-trip through the markdown.
      if (!row.sourceNoteId || row.line === null) return;
      try {
        await toggleTodoDone({
          sourceNoteId: row.sourceNoteId,
          text: row.text,
          line: row.line,
          done: !row.done,
        });
        await utils.entities.list.invalidate({ typeId: "note" });
        await utils.entities.get.invalidate({ id: row.sourceNoteId });
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Erreur de synchronisation");
      }
    },
    [utils, showToast],
  );

  const handleTodoDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      // Only standalone todos participate in DnD.
      const standaloneOrder = sortedTodos
        .filter((t) => t.kind === "standalone")
        .map((t) => t.id);
      const oldIdx = standaloneOrder.indexOf(active.id as string);
      const newIdx = standaloneOrder.indexOf(over.id as string);
      if (oldIdx === -1 || newIdx === -1) return;
      const nextOrder = arrayMove(standaloneOrder, oldIdx, newIdx);
      setManualTodoOrder(nextOrder);
      // Persist in background — fire-and-forget with rollback on error.
      void (async () => {
        try {
          await Promise.all(
            nextOrder.map((id, i) =>
              trpcVanillaClient.entities.update.mutate({
                id,
                fields: { sortOrder: (i + 1) * 1000 },
              }),
            ),
          );
          await utils.entities.list.invalidate({ typeId: TODO_TYPE_ID });
        } catch {
          setManualTodoOrder(standaloneOrder);
          showToast("Erreur lors de la sauvegarde de l'ordre");
        }
      })();
    },
    [sortedTodos, utils, showToast],
  );

  const handleCreateManual = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      setShowCreate(false);
      if (!trimmed) return;
      try {
        await trpcVanillaClient.entities.create.mutate({
          typeId: TODO_TYPE_ID,
          fields: {
            text: trimmed,
            done: false,
            priority: 5,
            importance: "medium",
          },
        });
        await utils.entities.list.invalidate({ typeId: TODO_TYPE_ID });
        showToast("Tâche créée");
      } catch {
        showToast("Erreur lors de la création");
      }
    },
    [utils, showToast],
  );

  const handleSaveEdit = useCallback(
    async (row: UiTodoRow, next: EditTodoValues) => {
      try {
        if (row.kind === "standalone") {
          await trpcVanillaClient.entities.update.mutate({
            id: row.id,
            fields: {
              text: next.text,
              done: next.done,
              priority: next.priority,
              importance: next.importance,
              startDate: next.startDate || null,
              dueDate: next.dueDate || null,
            },
          });
          await utils.entities.list.invalidate({ typeId: TODO_TYPE_ID });
        } else {
          if (!row.sourceNoteId || row.line === null) return;
          await updateTodoMetadata({
            sourceNoteId: row.sourceNoteId,
            cleanText: row.text,
            line: row.line,
            priority: next.priority,
            importance: next.importance,
            startDate: next.startDate || null,
            dueDate: next.dueDate || null,
          });
          // Done state is independent — a separate toggle if it changed.
          if (next.done !== row.done) {
            await toggleTodoDone({
              sourceNoteId: row.sourceNoteId,
              text: row.text,
              line: row.line,
              done: next.done,
            });
          }
          await utils.entities.list.invalidate({ typeId: "note" });
          await utils.entities.get.invalidate({ id: row.sourceNoteId });
        }
        setEditing(null);
        showToast("Tâche mise à jour");
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Erreur lors de la mise à jour");
      }
    },
    [utils, showToast],
  );

  const handleDelete = useCallback(
    async (row: UiTodoRow) => {
      if (row.kind !== "standalone") return; // note-derived: must edit the note
      try {
        await trpcVanillaClient.entities.delete.mutate({ id: row.id });
        await utils.entities.list.invalidate({ typeId: TODO_TYPE_ID });
        setEditing(null);
        showToast("Tâche supprimée");
      } catch {
        showToast("Erreur lors de la suppression");
      }
    },
    [utils, showToast],
  );

  const handleQuickImportance = useCallback(
    async (row: UiTodoRow, importance: TodoImportance) => {
      try {
        if (row.kind === "standalone") {
          await trpcVanillaClient.entities.update.mutate({
            id: row.id,
            fields: { importance },
          });
          await utils.entities.list.invalidate({ typeId: TODO_TYPE_ID });
        } else if (row.sourceNoteId && row.line !== null) {
          await updateTodoMetadata({
            sourceNoteId: row.sourceNoteId,
            cleanText: row.text,
            line: row.line,
            priority: row.priority ?? 5,
            importance,
            dueDate: row.dueDate,
          });
          await utils.entities.list.invalidate({ typeId: "note" });
          await utils.entities.get.invalidate({ id: row.sourceNoteId });
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Erreur lors de la mise à jour");
      }
    },
    [utils, showToast],
  );

  const ctxMenu = useContextMenu();
  const openTodoContextMenu = useCallback(
    (e: React.MouseEvent, row: UiTodoRow) => {
      e.preventDefault();
      const importanceDot = (level: TodoImportance) => (
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: importanceColor(level) }}
        />
      );
      const items: ContextMenuItemDef[] = [
        ...(["critical", "high", "medium", "low"] as const).map((lvl) => ({
          key: `imp-${lvl}`,
          label: `Importance : ${importanceLabel(lvl)}`,
          icon: importanceDot(lvl),
          onPress: () => void handleQuickImportance(row, lvl),
        })),
        { key: "sep1", label: "", separator: true },
        {
          key: "toggle",
          label: row.done ? "Marquer comme non faite" : "Marquer comme faite",
          icon: <Check size={14} />,
          onPress: () => void handleToggle(row),
        },
        {
          key: "edit",
          label: "Modifier (priorité, échéance, texte…)",
          icon: <Pencil size={14} />,
          onPress: () => setEditing(row),
        },
        { key: "sep2", label: "", separator: true },
        {
          key: "delete",
          label: "Supprimer",
          icon: <Trash size={14} />,
          isDanger: true,
          isDisabled: row.kind !== "standalone",
          onPress: () => void handleDelete(row),
        },
      ];
      ctxMenu.open(e, items);
    },
    [ctxMenu, handleQuickImportance, handleToggle, handleDelete],
  );

  const toMailable = useCallback(
    (row: UiTodoRow): MailableTodo => ({
      text: row.text,
      done: row.done,
      priority: row.priority,
      importance: row.importance,
      dueDate: row.dueDate,
      sourceNoteId: row.sourceNoteId,
      sourceNoteName: row.sourceNoteTitle,
    }),
    [],
  );

  const handleEmailOne = useCallback(
    (row: UiTodoRow) => {
      const baseHref =
        typeof window !== "undefined" ? window.location.origin : undefined;
      const url = composeTodoMailto(toMailable(row), {
        to: readDefaultEmail() || undefined,
        baseHref,
      });
      window.location.href = url;
    },
    [toMailable],
  );

  const handleEmailAll = useCallback(() => {
    if (sortedTodos.length === 0) return;
    const baseHref = typeof window !== "undefined" ? window.location.origin : undefined;
    const url = composeAllTodosMailto(sortedTodos.map(toMailable), {
      to: readDefaultEmail() || undefined,
      baseHref,
    });
    window.location.href = url;
  }, [sortedTodos, toMailable]);

  /**
   * Force-refresh both queries — the new model has no rescan-style action
   * (the markdown IS the source of truth), but the user may still want to
   * pull the freshest data after editing files outside the app.
   */
  const handleRefresh = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    showToast("Actualisation…");
    try {
      await invalidateAll();
      await utils.entities.list.refetch({ typeId: "note", limit: 5000, offset: 0 });
      await utils.entities.list.refetch({ typeId: TODO_TYPE_ID, limit: 5000, offset: 0 });
      showToast("À jour");
    } finally {
      setBusy(false);
    }
  }, [busy, utils, invalidateAll, showToast]);

  const handleMigrate = useCallback(async () => {
    if (migrating) return;
    setMigrating(true);
    showToast("Migration des anciennes tâches en cours…");
    let outcome: MigrationOutcome | null = null;
    try {
      outcome = await migrateLegacyTodos();
      await invalidateAll();
      showToast(
        `Migration terminée — ${outcome.notesUpdated} note(s), ${outcome.entitiesDeleted} entité(s) nettoyée(s), ${outcome.duplicatesMerged} doublon(s) fusionné(s).`,
      );
      try {
        window.localStorage.setItem(
          "supernote.todos.migrationCompletedAt",
          new Date().toISOString(),
        );
      } catch {
        /* storage disabled — fine, the legacy count will simply hit zero */
      }
    } catch (err) {
      showToast(
        `Erreur de migration : ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setMigrating(false);
    }
  }, [migrating, invalidateAll, showToast]);

  // Auto-run the migration ONCE per browser when legacy entities are
  // detected. Without this the user has to click a button while the new
  // build is in production behind a service-worker cache that may have
  // also cached the previous (button-less) page. Guard against re-running
  // by stamping a localStorage key on success and against double-firing
  // inside the same session via a ref.
  const autoMigrationFiredRef = useRef(false);
  useEffect(() => {
    if (autoMigrationFiredRef.current) return;
    if (migrating) return;
    if (legacyCount === 0) return;
    if (typeof window === "undefined") return;
    let alreadyMigrated = false;
    try {
      alreadyMigrated = !!window.localStorage.getItem(
        "supernote.todos.migrationCompletedAt",
      );
    } catch {
      /* storage disabled — we'll rely on the visible button instead */
    }
    if (alreadyMigrated) return;
    autoMigrationFiredRef.current = true;
    void handleMigrate();
  }, [legacyCount, migrating, handleMigrate]);

  const totalAll = allTodos.length;
  const totalPending = allTodos.filter((t) => !t.done).length;
  const totalDone = totalAll - totalPending;
  const totalUrgent = allTodos.filter(
    (t) => !t.done && (t.importance === "critical" || (t.priority !== null && t.priority <= 3)),
  ).length;

  // Mobile chrome — title carries the count, FAB triggers the create modal,
  // header actions surface refresh / email / view-toggle / group toggle. The
  // dense desktop toolbar below is hidden in `md:flex` mode (see header
  // wrapper className) so the mobile shell stays uncluttered.
  const isMobile = useIsMobile();
  useMobileTitle(
    isMobile ? "Todos" : null,
    isMobile ? `${totalPending} / ${totalAll}` : null,
  );
  useMobileFab(
    isMobile ? { icon: Plus, label: "Nouvelle tâche", onPress: () => setShowCreate(true) } : null,
  );
  const mobileActions: MobileHeaderAction[] = useMemo(() => {
    if (!isMobile) return [];
    const actions: MobileHeaderAction[] = [];
    actions.push({
      id: "view-toggle",
      icon: viewMode === "list" ? CalendarBlank : List,
      label: viewMode === "list" ? "Vue calendrier" : "Vue liste",
      onPress: toggleViewMode,
    });
    if (viewMode === "list") {
      actions.push({
        id: "group-toggle",
        icon: ListBullets,
        label: groupByNote ? "Vue à plat" : "Grouper par note",
        onPress: toggleGroupByNote,
        active: groupByNote,
      });
    }
    actions.push({
      id: "refresh",
      icon: ArrowsClockwise,
      label: "Actualiser",
      onPress: () => void handleRefresh(),
    });
    actions.push({
      id: "email-all",
      icon: Envelope,
      label: "Tout envoyer par email",
      onPress: handleEmailAll,
    });
    return actions;
  }, [isMobile, viewMode, toggleViewMode, groupByNote, toggleGroupByNote, handleRefresh, handleEmailAll]);
  useMobileHeaderActions(mobileActions);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Desktop header — hidden on mobile (title and actions live in the
            top bar instead). FilterTabs are rendered separately below for
            both layouts because they need horizontal scroll on phones. */}
        <div
          className="hidden items-center justify-between border-b px-6 py-3 md:flex"
          style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
        >
          <div className="flex items-center gap-3">
            <CheckSquare size={18} style={{ color: "var(--accent)" }} />
            <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              Todos
            </h1>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
            >
              {totalPending} / {totalAll}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div
              className="flex items-center gap-0.5 rounded-md p-0.5"
              style={{ backgroundColor: "var(--surface-2)" }}
            >
              <button
                type="button"
                onClick={() => viewMode !== "list" && toggleViewMode()}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors"
                style={
                  viewMode === "list"
                    ? { backgroundColor: "var(--surface-0)", color: "var(--text-primary)" }
                    : { color: "var(--text-muted)" }
                }
                title="Vue liste"
              >
                <List size={12} />
                Liste
              </button>
              <button
                type="button"
                onClick={() => viewMode !== "calendar" && toggleViewMode()}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors"
                style={
                  viewMode === "calendar"
                    ? { backgroundColor: "var(--surface-0)", color: "var(--text-primary)" }
                    : { color: "var(--text-muted)" }
                }
                title="Vue calendrier"
              >
                <CalendarBlank size={12} />
                Calendrier
              </button>
            </div>
            {viewMode === "list" && (
              <FilterTabs
                value={filter}
                onChange={setFilter}
                counts={{
                  pending: totalPending,
                  done: totalDone,
                  all: totalAll,
                  urgent: totalUrgent,
                }}
              />
            )}
            {viewMode === "list" && <SortMenu value={sortKey} onChange={setSortKey} />}
            {viewMode === "list" && (
              <button
                onClick={toggleGroupByNote}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  borderColor: groupByNote
                    ? "var(--accent)"
                    : "var(--border-subtle)",
                  backgroundColor: groupByNote
                    ? "var(--accent-subtle, var(--surface-2))"
                    : "var(--surface-1)",
                  color: groupByNote ? "var(--accent)" : "var(--text-secondary)",
                }}
                title={groupByNote ? "Vue à plat" : "Grouper par note source"}
              >
                <ListBullets size={13} />
                {groupByNote ? "Groupé" : "Grouper"}
              </button>
            )}
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
              style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
              title="Nouvelle tâche"
            >
              <Plus size={13} />
              Nouvelle
            </button>
            <button
              onClick={handleEmailAll}
              disabled={sortedTodos.length === 0}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{
                borderColor: "var(--border-subtle)",
                color: "var(--text-secondary)",
                backgroundColor: "var(--surface-1)",
              }}
              title="Envoyer toutes les tâches affichées par email"
            >
              <Envelope size={13} />
              Tout envoyer
            </button>
            <button
              onClick={() => void handleRefresh()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{
                borderColor: "var(--border-subtle)",
                color: "var(--text-secondary)",
                backgroundColor: "var(--surface-1)",
              }}
              title="Actualiser"
            >
              <ArrowsClockwise size={13} className={busy ? "animate-spin" : ""} />
              {busy ? "…" : "Actualiser"}
            </button>
          </div>
        </div>

        {/* Mobile sub-header — horizontal scroll of filter chips so the user
            can switch between "En attente / Urgentes / Aujourd'hui …" with a
            swipe. Sort menu sits to the right. Only rendered in list mode. */}
        {viewMode === "list" && (
          <div
            className="flex shrink-0 items-center gap-2 border-b px-3 py-2 md:hidden"
            style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
          >
            <div className="flex flex-1 items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <FilterTabs
                value={filter}
                onChange={setFilter}
                counts={{
                  pending: totalPending,
                  done: totalDone,
                  all: totalAll,
                  urgent: totalUrgent,
                }}
              />
            </div>
            <SortMenu value={sortKey} onChange={setSortKey} />
          </div>
        )}

        {/* Migration banner — surfaces only when legacy entities are present */}
        {legacyCount > 0 && !migrationDismissed && (
          <div
            className="flex items-center justify-between gap-3 border-b px-6 py-2.5 text-sm"
            style={{
              backgroundColor: "oklch(0.95 0.05 60 / 0.55)",
              color: "oklch(0.35 0.15 60)",
              borderColor: "var(--border-subtle)",
            }}
          >
            <div className="flex items-center gap-2">
              <ArrowsClockwise size={14} />
              <span>
                <strong>{legacyCount}</strong> ancienne(s) tâche(s) issue(s) du système précédent
                détectée(s). Cliquez pour les fusionner dans les notes (gère aussi les doublons).
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleMigrate()}
                disabled={migrating}
                className="rounded-md px-3 py-1 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{
                  backgroundColor: "oklch(0.45 0.18 60)",
                  color: "white",
                }}
              >
                {migrating ? "Migration en cours…" : "Migrer maintenant"}
              </button>
              <button
                type="button"
                onClick={() => setMigrationDismissed(true)}
                disabled={migrating}
                className="text-xs underline"
                style={{ color: "oklch(0.4 0.12 60)" }}
              >
                plus tard
              </button>
            </div>
          </div>
        )}

        {/* Tag filter row */}
        {availableTags.length > 0 && (
          <div className="border-b px-6 py-2" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                <Tag size={11} />
                Tags
              </span>
              {availableTags.map((tag) => {
                const active = tagFilter.has(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className="rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors"
                    style={
                      active
                        ? {
                            backgroundColor: "var(--accent)",
                            color: "var(--accent-foreground)",
                            border: "1px solid var(--accent)",
                          }
                        : {
                            backgroundColor: "var(--surface-1)",
                            color: "var(--text-secondary)",
                            border: "1px solid var(--border-subtle)",
                          }
                    }
                  >
                    {tag}
                  </button>
                );
              })}
              {tagFilter.size > 0 && (
                <button
                  type="button"
                  onClick={() => setTagFilter(new Set())}
                  className="ml-1 text-[11px] underline"
                  style={{ color: "var(--text-muted)" }}
                >
                  effacer
                </button>
              )}
            </div>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div
            className="mx-6 mt-3 rounded-md px-4 py-2 text-sm font-medium"
            style={{
              backgroundColor: "oklch(0.93 0.05 150 / 0.20)",
              color: "oklch(0.45 0.16 150)",
            }}
          >
            {toast}
          </div>
        )}

        {/* Calendar view */}
        {viewMode === "calendar" && (
          <div className="flex flex-1 overflow-hidden">
            <TodoCalendarView
              todos={allTodos}
              onEdit={(row) => setEditing(row as UiTodoRow)}
              onUpdateDates={async (row, { startDate: sd, dueDate: dd }) => {
                try {
                  if ((row as UiTodoRow).kind === "standalone") {
                    await trpcVanillaClient.entities.update.mutate({
                      id: row.id,
                      fields: { startDate: sd, dueDate: dd },
                    });
                    await utils.entities.list.invalidate({ typeId: TODO_TYPE_ID });
                  } else {
                    const r = row as UiTodoRow;
                    if (!r.sourceNoteId || r.line === null) return;
                    await updateTodoMetadata({
                      sourceNoteId: r.sourceNoteId,
                      cleanText: r.text,
                      line: r.line,
                      priority: r.priority ?? 5,
                      importance: r.importance ?? "medium",
                      startDate: sd,
                      dueDate: dd,
                    });
                    await utils.entities.list.invalidate({ typeId: "note" });
                    await utils.entities.get.invalidate({ id: r.sourceNoteId });
                  }
                } catch (err) {
                  showToast(err instanceof Error ? err.message : "Erreur de mise à jour");
                }
              }}
            />
          </div>
        )}

        {/* List view content */}
        <div className={`flex-1 overflow-y-auto px-6 py-6 ${viewMode === "calendar" ? "hidden" : ""}`}>
          {notesQuery.isLoading || todosQuery.isLoading ? (
            <div className="mx-auto max-w-3xl space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-lg"
                  style={{ backgroundColor: "var(--surface-3)" }}
                />
              ))}
            </div>
          ) : sortedTodos.length === 0 ? (
            <EmptyState
              icon={<CheckSquare size={28} />}
              title={
                filter === "pending"
                  ? "Aucune todo en attente"
                  : filter === "done"
                    ? "Aucune todo terminée"
                    : filter === "today"
                      ? "Aucune échéance aujourd'hui"
                      : filter === "thisWeek"
                        ? "Aucune tâche cette semaine"
                        : filter === "urgent"
                          ? "Aucune priorité urgente"
                          : "Aucune todo"
              }
              description="Cliquez sur « Nouvelle » pour créer une tâche, ou ajoutez des cases « - [ ] » dans vos notes pour les voir apparaître automatiquement."
              action={{
                label: "Nouvelle tâche",
                onClick: () => setShowCreate(true),
              }}
              className="py-24"
            />
          ) : (
            <div className="mx-auto max-w-3xl">
              {groupByNote ? (
                (() => {
                  const groups = new Map<string, UiTodoRow[]>();
                  const STANDALONE = "__standalone__";
                  for (const row of sortedTodos) {
                    const k = row.sourceNoteId ?? STANDALONE;
                    const list = groups.get(k);
                    if (list) list.push(row);
                    else groups.set(k, [row]);
                  }
                  const orderedKeys = Array.from(groups.keys()).filter(
                    (k) => k !== STANDALONE,
                  );
                  if (groups.has(STANDALONE)) orderedKeys.push(STANDALONE);
                  return (
                    <div className="flex flex-col gap-5">
                      {orderedKeys.map((k) => {
                        const rows = groups.get(k)!;
                        const title =
                          k === STANDALONE
                            ? "Sans note source"
                            : (rows[0]?.sourceNoteTitle ?? "Note inconnue");
                        return (
                          <section key={k}>
                            <header className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                              <FileText size={11} />
                              {k === STANDALONE ? (
                                <span>{title}</span>
                              ) : (
                                <Link
                                  href={`/notes/${k}`}
                                  className="hover:underline"
                                  style={{ color: "var(--text-muted)" }}
                                >
                                  {title}
                                </Link>
                              )}
                              <span className="font-normal" style={{ color: "var(--text-muted)" }}>
                                · {rows.length}
                              </span>
                            </header>
                            <ul className="flex flex-col gap-1">
                              {rows.map((row) => (
                                <TodoRow
                                  key={row.id}
                                  row={row}
                                  onToggle={() => void handleToggle(row)}
                                  onEdit={() => setEditing(row)}
                                  onEmail={() => handleEmailOne(row)}
                                  onContextMenu={(e) => openTodoContextMenu(e, row)}
                                />
                              ))}
                            </ul>
                          </section>
                        );
                      })}
                    </div>
                  );
                })()
              ) : sortKey === "manual" ? (
                <DndContext
                  sensors={todoDndSensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleTodoDragEnd}
                >
                  <SortableContext
                    items={sortedTodos.filter((t) => t.kind === "standalone").map((t) => t.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="flex flex-col gap-1">
                      {sortedTodos.map((row) => (
                        <SortableTodoRow
                          key={row.id}
                          row={row}
                          sortable={row.kind === "standalone"}
                          onToggle={() => void handleToggle(row)}
                          onEdit={() => setEditing(row)}
                          onEmail={() => handleEmailOne(row)}
                          onContextMenu={(e) => openTodoContextMenu(e, row)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              ) : (
                <ul className="flex flex-col gap-1">
                  {sortedTodos.map((row) => (
                    <TodoRow
                      key={row.id}
                      row={row}
                      onToggle={() => void handleToggle(row)}
                      onEdit={() => setEditing(row)}
                      onEmail={() => handleEmailOne(row)}
                      onContextMenu={(e) => openTodoContextMenu(e, row)}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      <PromptModal
        open={showCreate}
        title="Nouvelle tâche"
        placeholder="Texte de la tâche"
        confirmLabel="Créer"
        onConfirm={(v) => void handleCreateManual(v)}
        onCancel={() => setShowCreate(false)}
      />

      {editing && (
        <EditTodoModal
          open
          initial={{
            text: editing.text,
            done: editing.done,
            priority: editing.priority ?? 5,
            importance: editing.importance ?? "medium",
            startDate: editing.startDate ?? "",
            dueDate: editing.dueDate ?? "",
          }}
          readonlyText={editing.kind === "note"}
          onSave={(next) => void handleSaveEdit(editing, next)}
          onCancel={() => setEditing(null)}
          onDelete={editing.kind === "standalone" ? () => void handleDelete(editing) : undefined}
        />
      )}

      <ContextMenu state={ctxMenu.state} onClose={ctxMenu.close} />
    </AppShell>
  );
}

interface FilterTabsProps {
  value: Filter;
  onChange: (next: Filter) => void;
  counts: { pending: number; done: number; all: number; urgent: number };
}

function FilterTabs({ value, onChange, counts }: FilterTabsProps) {
  const tabs: Array<{ key: Filter; label: string; count?: number }> = [
    { key: "pending", label: "En attente", count: counts.pending },
    { key: "urgent", label: "Urgentes", count: counts.urgent },
    { key: "today", label: "Aujourd'hui" },
    { key: "thisWeek", label: "Cette semaine" },
    { key: "done", label: "Faites", count: counts.done },
    { key: "all", label: "Toutes", count: counts.all },
  ];
  return (
    <div
      className="flex items-center gap-0.5 rounded-md p-0.5"
      style={{ backgroundColor: "var(--surface-2)" }}
    >
      {tabs.map((tab) => {
        const active = value === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors"
            style={
              active
                ? { backgroundColor: "var(--surface-0)", color: "var(--text-primary)" }
                : { color: "var(--text-muted)" }
            }
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className="rounded-full px-1 text-[10px]"
                style={{
                  backgroundColor: active ? "var(--accent-subtle)" : "var(--surface-3)",
                  color: active ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface SortMenuProps {
  value: SortKey;
  onChange: (next: SortKey) => void;
}

// ── SortableTodoRow ────────────────────────────────────────────────────────────
// Wraps TodoRow with useSortable for manual reordering. The drag handle
// is only shown for standalone todos (notes-derived rows are fixed).

interface SortableTodoRowProps {
  row: UiTodoRow;
  sortable: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onEmail: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function SortableTodoRow({ row, sortable, onToggle, onEdit, onEmail, onContextMenu }: SortableTodoRowProps) {
  const [hovered, setHovered] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: !sortable,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    position: "relative",
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {sortable && hovered && (
        <button
          {...listeners}
          aria-label="Réordonner"
          className="absolute left-0 top-1/2 z-10 -translate-y-1/2 flex h-6 w-5 items-center justify-center rounded cursor-grab active:cursor-grabbing"
          style={{ color: "var(--text-muted)" }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <DotsSixVertical size={13} />
        </button>
      )}
      <TodoRow
        row={row}
        onToggle={onToggle}
        onEdit={onEdit}
        onEmail={onEmail}
        onContextMenu={onContextMenu}
      />
    </li>
  );
}

function SortMenu({ value, onChange }: SortMenuProps) {
  const options: Array<{ key: SortKey; label: string }> = [
    { key: "priority", label: "Priorité" },
    { key: "importance", label: "Importance" },
    { key: "dueDate", label: "Échéance" },
    { key: "createdAt", label: "Créée le" },
    { key: "manual", label: "Manuel (glisser)" },
  ];
  return (
    <label
      className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
        color: "var(--text-secondary)",
      }}
      title="Tri"
    >
      <SortAscending size={12} />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortKey)}
        className="bg-transparent outline-none"
        style={{ color: "var(--text-secondary)" }}
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
