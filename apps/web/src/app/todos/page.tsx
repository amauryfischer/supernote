"use client";

/**
 * /todos — manage every todo (extracted from notes or created manually).
 *
 * Reads `todo` entities (seeded in `seed-default-types.ts`) and renders
 * them with a sortable / filterable list. Each row exposes:
 *   - importance pastille + numeric priority badge
 *   - checkbox (round-trips to the source note's markdown when present)
 *   - the text (clickable → EditTodoModal)
 *   - a "📝 Note" deep link if the todo was extracted
 *   - a "📧" mailto button for one-shot email export
 *
 * The page also supports manual creation (no source note) via the "+"
 * button, and a "Tout envoyer" bulk-email action that builds one mailto
 * containing every visible todo.
 *
 * Filters: pending / done / due-today / urgent / all. Sort: priority |
 * importance | dueDate | createdAt. State is local (URL-less) — keeps the
 * back button predictable.
 */

import { AppShell } from "@/components/shell";
import { trpc, trpcVanillaClient } from "@/lib/trpc/client";
import {
  CheckSquare,
  FileText,
  ArrowsClockwise,
  Plus,
  Envelope,
  SortAscending,
} from "@phosphor-icons/react";
import { EmptyState } from "@supernote/ui";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { syncNoteTodos, toggleTodoDone, TODO_TYPE_ID } from "@/hooks/useTodoSync";
import { PromptModal } from "@/components/shell/PromptModal";
import { TodoRow, type TodoImportance, type TodoRowData } from "@/components/todos/TodoRow";
import { EditTodoModal, type EditTodoValues } from "@/components/todos/EditTodoModal";
import {
  composeTodoMailto,
  composeAllTodosMailto,
  readDefaultEmail,
  type MailableTodo,
} from "@/components/todos/EmailComposer";

type Filter = "all" | "pending" | "done" | "today" | "urgent";
type SortKey = "priority" | "importance" | "dueDate" | "createdAt";

interface UiTodoRow extends TodoRowData {
  updatedAt: string;
  createdAt: string;
}

/** Drop the optional time component so two ISO datetimes on the same day compare equal. */
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
    // Legacy string priorities ("low" / "medium" / "high"). Map to numeric so
    // the new UI can still rank them sensibly.
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
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<UiTodoRow | null>(null);

  const todosQuery = trpc.entities.list.useQuery(
    { typeId: TODO_TYPE_ID, limit: 1000, offset: 0 },
    { staleTime: 30_000 },
  );
  const notesQuery = trpc.entities.list.useQuery(
    { typeId: "note", limit: 1000, offset: 0 },
    { staleTime: 60_000 },
  );

  // Lookup table for note titles so we can group todos by source.
  const noteTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notesQuery.data?.items ?? []) {
      const title =
        typeof n.fields?.["title"] === "string"
          ? (n.fields["title"] as string)
          : n.filePath.split("/").pop()?.replace(/\.md$/, "") ?? "Sans titre";
      map.set(n.id, title);
    }
    return map;
  }, [notesQuery.data]);

  const allTodos: UiTodoRow[] = useMemo(() => {
    const items = todosQuery.data?.items ?? [];
    return items.map((e) => {
      const f = e.fields ?? {};
      let line: number | null = null;
      let blockId: string | null = null;
      const range = f["sourceLineRange"];
      if (typeof range === "string") {
        try {
          const parsed = JSON.parse(range) as { start?: number; blockId?: string };
          if (typeof parsed?.start === "number") line = parsed.start;
          if (typeof parsed?.blockId === "string") blockId = parsed.blockId;
        } catch {
          /* legacy / malformed */
        }
      }
      const sourceNoteId =
        typeof f["sourceNoteId"] === "string" && f["sourceNoteId"]
          ? (f["sourceNoteId"] as string)
          : null;
      return {
        id: e.id,
        text: typeof f["text"] === "string" ? (f["text"] as string) : "(sans texte)",
        done: f["done"] === true || f["done"] === "true",
        sourceNoteId,
        line,
        blockId,
        dueDate: typeof f["dueDate"] === "string" ? (f["dueDate"] as string) : null,
        priority: parsePriority(f["priority"]),
        importance: parseImportance(f["importance"]),
        sourceNoteTitle: sourceNoteId ? noteTitleById.get(sourceNoteId) ?? null : null,
        updatedAt: e.updatedAt,
        createdAt: e.createdAt,
      };
    });
  }, [todosQuery.data, noteTitleById]);

  const filteredTodos = useMemo(() => {
    return allTodos.filter((t) => {
      if (filter === "pending") return !t.done;
      if (filter === "done") return t.done;
      if (filter === "today") return isToday(t.dueDate);
      if (filter === "urgent")
        return t.importance === "critical" || (t.priority !== null && t.priority <= 3);
      return true;
    });
  }, [allTodos, filter]);

  const sortedTodos = useMemo(() => {
    const arr = [...filteredTodos];
    arr.sort((a, b) => {
      // Always float undone above done within the same group.
      if (a.done !== b.done) return a.done ? 1 : -1;
      switch (sortKey) {
        case "priority": {
          const pa = a.priority ?? 5;
          const pb = b.priority ?? 5;
          if (pa !== pb) return pa - pb; // ascending = most urgent first
          // Tiebreak on importance so a P5/critical still beats a P5/low.
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
          const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          return da - db;
        }
        case "createdAt":
        default:
          return b.createdAt.localeCompare(a.createdAt);
      }
    });
    return arr;
  }, [filteredTodos, sortKey]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleToggle = useCallback(
    async (row: UiTodoRow) => {
      if (!row.sourceNoteId || row.line === null) {
        // Standalone todo — flip directly without note round-trip.
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
      try {
        await toggleTodoDone({
          todoId: row.id,
          sourceNoteId: row.sourceNoteId,
          text: row.text,
          line: row.line,
          done: !row.done,
        });
        await utils.entities.list.invalidate({ typeId: TODO_TYPE_ID });
        await utils.entities.list.invalidate({ typeId: "note" });
        if (row.sourceNoteId) {
          await utils.entities.get.invalidate({ id: row.sourceNoteId });
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Erreur de synchronisation");
        // Still refresh — the todo entity may have been updated even if the
        // note write failed.
        await utils.entities.list.invalidate({ typeId: TODO_TYPE_ID });
      }
    },
    [utils, showToast],
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
            // No `sourceNoteId` and no `sourceLineRange` ⇒ standalone todo.
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
        // When the todo originated from a note, text edits would need to
        // round-trip through the markdown. We keep the modal text input
        // disabled in that case (see `readonlyText` prop), so this branch
        // only patches the structured fields.
        const fields: Record<string, string | number | boolean | string[] | null> = {
          done: next.done,
          priority: next.priority,
          importance: next.importance,
          dueDate: next.dueDate,
        };
        if (!row.sourceNoteId) fields["text"] = next.text;
        await trpcVanillaClient.entities.update.mutate({
          id: row.id,
          fields,
        });
        await utils.entities.list.invalidate({ typeId: TODO_TYPE_ID });
        setEditing(null);
        showToast("Tâche mise à jour");
      } catch {
        showToast("Erreur lors de la mise à jour");
      }
    },
    [utils, showToast],
  );

  const handleDelete = useCallback(
    async (row: UiTodoRow) => {
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
   * Re-scan every note for todos. Useful after the user enables the feature
   * for the first time, or after editing a note outside of Supernote.
   */
  const handleRescanAll = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    showToast("Analyse en cours…");
    try {
      const notes = notesQuery.data?.items ?? [];
      let total = 0;
      for (const n of notes) {
        // Need the body — `entities.list` returns summaries (no body),
        // so fetch each note individually. Sequential to avoid hammering Ollama.
        const full = await trpcVanillaClient.entities.get.query({ id: n.id });
        const out = await syncNoteTodos({
          noteId: full.id,
          noteTitle:
            typeof full.fields?.["title"] === "string"
              ? (full.fields["title"] as string)
              : "",
          body: full.body,
          fields: full.fields ?? {},
        });
        total += out.todosCreated + out.todosUpdated;
      }
      await utils.entities.list.invalidate({ typeId: TODO_TYPE_ID });
      showToast(`Analyse terminée — ${total} todo(s) synchronisée(s)`);
    } catch {
      showToast("Erreur durant l'analyse");
    } finally {
      setBusy(false);
    }
  }, [busy, notesQuery.data, utils, showToast]);

  const totalAll = allTodos.length;
  const totalPending = allTodos.filter((t) => !t.done).length;
  const totalDone = totalAll - totalPending;
  const totalUrgent = allTodos.filter(
    (t) => !t.done && (t.importance === "critical" || (t.priority !== null && t.priority <= 3)),
  ).length;

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-3"
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
            <SortMenu value={sortKey} onChange={setSortKey} />
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
              onClick={() => void handleRescanAll()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{
                borderColor: "var(--border-subtle)",
                color: "var(--text-secondary)",
                backgroundColor: "var(--surface-1)",
              }}
              title="Re-scanner toutes les notes"
            >
              <ArrowsClockwise size={13} className={busy ? "animate-spin" : ""} />
              {busy ? "Analyse…" : "Re-scanner"}
            </button>
          </div>
        </div>

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

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {todosQuery.isLoading ? (
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
                      : filter === "urgent"
                        ? "Aucune priorité urgente"
                        : "Aucune todo"
              }
              description="Cliquez sur « Nouvelle » pour créer une tâche, ou activez l'extraction depuis vos notes dans Paramètres → IA & Ollama."
              action={{
                label: "Nouvelle tâche",
                onClick: () => setShowCreate(true),
              }}
              className="py-24"
            />
          ) : (
            <div className="mx-auto max-w-3xl">
              <ul className="flex flex-col gap-1">
                {sortedTodos.map((row) => (
                  <TodoRow
                    key={row.id}
                    row={row}
                    onToggle={() => void handleToggle(row)}
                    onEdit={() => setEditing(row)}
                    onEmail={() => handleEmailOne(row)}
                  />
                ))}
              </ul>
              {/* Optional grouped-by-note legend at the bottom — surfaces what each row belongs to. */}
              {sortedTodos.some((t) => t.sourceNoteId) && (
                <div
                  className="mt-6 rounded-md px-3 py-2 text-[11px]"
                  style={{
                    backgroundColor: "var(--surface-1)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div className="mb-1 flex items-center gap-1.5">
                    <FileText size={11} />
                    <span className="font-medium">Notes sources</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from(
                      new Set(sortedTodos.map((t) => t.sourceNoteId).filter(Boolean) as string[]),
                    ).map((nid) => (
                      <Link
                        key={nid}
                        href={`/notes/${nid}`}
                        prefetch={false}
                        className="rounded px-1.5 py-0.5 hover:underline"
                        style={{ backgroundColor: "var(--surface-2)" }}
                      >
                        {noteTitleById.get(nid) ?? "Note"}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Manual creation prompt */}
      <PromptModal
        open={showCreate}
        title="Nouvelle tâche"
        placeholder="Texte de la tâche"
        confirmLabel="Créer"
        onConfirm={(v) => void handleCreateManual(v)}
        onCancel={() => setShowCreate(false)}
      />

      {/* Edit modal */}
      {editing && (
        <EditTodoModal
          open
          initial={{
            text: editing.text,
            done: editing.done,
            priority: editing.priority ?? 5,
            importance: editing.importance ?? "medium",
            dueDate: editing.dueDate ?? "",
          }}
          readonlyText={!!editing.sourceNoteId}
          onSave={(next) => void handleSaveEdit(editing, next)}
          onCancel={() => setEditing(null)}
          onDelete={editing.sourceNoteId ? undefined : () => void handleDelete(editing)}
        />
      )}
    </AppShell>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

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

function SortMenu({ value, onChange }: SortMenuProps) {
  const options: Array<{ key: SortKey; label: string }> = [
    { key: "priority", label: "Priorité" },
    { key: "importance", label: "Importance" },
    { key: "dueDate", label: "Échéance" },
    { key: "createdAt", label: "Créée le" },
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
