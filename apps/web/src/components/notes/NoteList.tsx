"use client";

import { Archive, ArrowsDownUp, CaretDoubleLeft, FileText, MagnifyingGlass, Plus, SortAscending, Warning } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "./fixtures";
import { NoteListItem } from "./NoteListItem";
import { useTranslations } from "next-intl";
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
} from "@dnd-kit/sortable";
import { useReorderNotes } from "./hooks";

type SortKey = "updatedAt" | "title" | "manual";

const SHOW_ARCHIVED_KEY = "supernote.notes.showArchived";

interface NoteListProps {
  notes: Note[];
  selectedNoteId: string | null;
  folderName: string | null;
  /**
   * Absolute path of the folder currently selected in the FileTree, e.g.
   * "Inbox/Projects". Used to compute relative sub-folder headers when
   * grouping recursively-fetched notes. `null` means "all notes" (no
   * grouping; everything appears under a single flat list).
   */
  selectedFolder: string | null;
  onSelectNote: (id: string) => void;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  isFallback?: boolean;
  onNewNote?: () => void;
  onDeleteNote?: (id: string) => void;
  /** Called when the user double-clicks a note title and confirms a new name. */
  onRenameNote?: (id: string, newTitle: string) => Promise<void>;
  /** Toggle the archived state of a single note (true = archive, false = restore). */
  onArchiveNote?: (id: string, archived: boolean) => Promise<void>;
  /**
   * Called when the user clicks the folder name in the column header and
   * confirms a new leaf name. Receives the OLD full folder path and the NEW
   * leaf name; the parent page rebuilds `${parent}/${newName}` and calls
   * `vault.folders.rename`.
   */
  onRenameFolderInline?: (oldPath: string, newName: string) => Promise<void>;
  /**
   * Optional collapse handler — when provided, a small chevron button is
   * rendered in the header that hides the NoteList column. State is owned
   * by the parent (persisted in localStorage at the page level).
   */
  onCollapse?: () => void;
  /**
   * Full vault note list (all folders), used to widen the search scope when
   * the user types in the in-list search input. Without this, typing a
   * query only matches notes inside the currently selected folder — so a
   * note named "Leroy Merlin" in `Travail/Courses` is invisible from
   * `Inbox`. When omitted, search stays scoped to `notes`.
   */
  allNotes?: Note[];
}

export function NoteList({
  notes,
  selectedNoteId,
  folderName,
  selectedFolder,
  onSelectNote,
  isLoading = false,
  isError = false,
  errorMessage = null,
  isFallback = false,
  onNewNote,
  onDeleteNote,
  onRenameNote,
  onArchiveNote,
  onRenameFolderInline,
  onCollapse,
  allNotes,
}: NoteListProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  // Optimistic ordered IDs for manual mode — overrides the server order
  // until the next refetch resolves the persisted sortOrder values.
  const [manualOrder, setManualOrder] = useState<string[] | null>(null);
  // "Show archived" toggle. Off by default so archived notes truly disappear
  // from the day-to-day view; persisted in localStorage so the user's choice
  // sticks across folder navigation and reloads.
  const [showArchived, setShowArchived] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem(SHOW_ARCHIVED_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(SHOW_ARCHIVED_KEY, showArchived ? "1" : "0"); } catch { /* quota / disabled */ }
  }, [showArchived]);
  const t = useTranslations("notes");
  const tCommon = useTranslations("common");
  const { reorderNotes } = useReorderNotes();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    // When the user is searching, expand the haystack to the full vault if
    // available — otherwise typing "leroy merlin" while parked in `Inbox`
    // would never surface a note that lives elsewhere. The body field is
    // empty in list mode (entitySummaryToNote drops bodies for performance),
    // so we match titles + tags only here; full-text body search lives on
    // the dedicated /recherche page which hits the worker's MiniSearch.
    const rawHaystack = q && allNotes ? allNotes : notes;
    // Archived filter applies BEFORE the query so the visible row count and
    // the search results agree with what the user has chosen to see.
    const haystack = showArchived ? rawHaystack : rawHaystack.filter((n) => !n.archivedAt);
    const baseNotes = showArchived ? notes : notes.filter((n) => !n.archivedAt);
    const matched = q
      ? haystack.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.tags.some((t) => t.toLowerCase().includes(q)),
        )
      : baseNotes;

    if (sortKey === "manual") {
      // Apply manual order: use optimistic order when set, otherwise sort by
      // the persisted sortOrder in fields, with Infinity for unordered notes.
      if (manualOrder) {
        const idx = new Map(manualOrder.map((id, i) => [id, i]));
        return [...matched].sort((a, b) => {
          const ia = idx.get(a.id) ?? Infinity;
          const ib = idx.get(b.id) ?? Infinity;
          if (ia !== ib) return ia - ib;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        });
      }
      return [...matched].sort((a, b) => {
        const sa = typeof a.fields?.["sortOrder"] === "number" ? (a.fields["sortOrder"] as number) : Infinity;
        const sb = typeof b.fields?.["sortOrder"] === "number" ? (b.fields["sortOrder"] as number) : Infinity;
        if (sa !== sb) return sa - sb;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }

    return [...matched].sort((a, b) => {
      if (sortKey === "title") return a.title.localeCompare(b.title, "fr");
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [notes, allNotes, query, sortKey, manualOrder, showArchived]);

  // When switching away from manual sort, clear the optimistic order so a
  // subsequent switch back reflects the latest persisted state.
  const toggleSort = useCallback(() => {
    setSortKey((k) => {
      if (k === "updatedAt") return "title";
      if (k === "title") {
        setManualOrder(null);
        return "manual";
      }
      return "updatedAt";
    });
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const currentOrder = filtered.map((n) => n.id);
      const oldIndex = currentOrder.indexOf(active.id as string);
      const newIndex = currentOrder.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;
      const nextOrder = arrayMove(currentOrder, oldIndex, newIndex);
      setManualOrder(nextOrder);
      // Persist in background — no await so the UI stays responsive.
      void reorderNotes(nextOrder).catch(() => {
        // On failure roll back the optimistic order.
        setManualOrder(currentOrder);
      });
    },
    [filtered, reorderNotes],
  );

  // While searching globally, suppress folder-relative grouping — the
  // results no longer share a parent folder so the "ce dossier / Sub" split
  // is meaningless and visually noisy. Force a flat list during search.
  const isGlobalSearch = query.trim().length > 0 && Boolean(allNotes);

  /**
   * Bucket the (already filtered + sorted) notes by their location relative
   * to `selectedFolder`:
   *   - the "" key holds notes that live directly in the selected folder
   *   - every other key is a relative sub-path ("Sub1", "Sub1/Deep", …)
   *
   * When no folder is selected (All notes) we skip grouping and return a
   * single anonymous bucket so the existing flat render is preserved.
   */
  const groups = useMemo(() => {
    if (!selectedFolder || isGlobalSearch) {
      return [{ key: "", label: null as string | null, notes: filtered }];
    }
    const prefix = `${selectedFolder}/`;
    const buckets = new Map<string, Note[]>();
    for (const n of filtered) {
      let rel = "";
      if (n.folderPath === selectedFolder) {
        rel = "";
      } else if (n.folderPath.startsWith(prefix)) {
        rel = n.folderPath.slice(prefix.length);
      } else {
        // Defensive: a note that doesn't belong to the subtree shouldn't
        // reach us, but if it does we keep it under the root bucket rather
        // than dropping it silently.
        rel = "";
      }
      const bucket = buckets.get(rel);
      if (bucket) bucket.push(n);
      else buckets.set(rel, [n]);
    }
    const root = buckets.get("") ?? [];
    buckets.delete("");
    const subs = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "fr"))
      .map(([key, ns]) => ({ key, label: key, notes: ns }));
    const result: { key: string; label: string | null; notes: Note[] }[] = [];
    if (root.length > 0) result.push({ key: "", label: t("thisFolder"), notes: root });
    result.push(...subs);
    return result;
  }, [filtered, selectedFolder, isGlobalSearch, t]);

  return (
    <div
      className="flex h-full flex-col border-r"
      style={{
        width: 320,
        minWidth: 320,
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-0)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <FolderHeaderTitle
            folderName={folderName}
            folderPath={selectedFolder}
            onRename={onRenameFolderInline}
            allNotesLabel={t("allNotes")}
          />
          {/* Recursive count badge — `notes` is already the recursive set
              (useNoteList includes descendants), so this number reflects
              everything visible in the grouped list below. Hidden during
              load + when there's nothing to count to avoid flashing "0". */}
          {!isLoading && !isError && notes.length > 0 && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
              style={{ backgroundColor: "var(--surface-2)", color: "var(--text-muted)" }}
              title={
                showArchived
                  ? `${notes.length} note${notes.length !== 1 ? "s" : ""} (archives incluses)`
                  : undefined
              }
            >
              {showArchived ? notes.length : notes.filter((n) => !n.archivedAt).length}
            </span>
          )}
          {isFallback && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
            >
              demo
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onNewNote && (
            <button
              onClick={onNewNote}
              aria-label={t("newNote")}
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: "var(--text-muted)" }}
            >
              <Plus size={13} />
            </button>
          )}
          <button
            onClick={() => setShowArchived((v) => !v)}
            aria-label={showArchived ? "Masquer les notes archivées" : "Afficher les notes archivées"}
            title={showArchived ? "Masquer les archives" : "Voir les archives"}
            className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
            style={{
              color: showArchived ? "var(--accent)" : "var(--text-muted)",
              backgroundColor: showArchived ? "var(--accent-subtle)" : undefined,
            }}
          >
            <Archive size={13} />
          </button>
          <button
            onClick={toggleSort}
            aria-label={t("changeSort")}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-muted)" }}
          >
            {sortKey === "updatedAt" ? <ArrowsDownUp size={12} /> : <SortAscending size={12} />}
            {sortKey === "updatedAt" ? tCommon("date") : sortKey === "title" ? tCommon("title") : "Manuel"}
          </button>
          {onCollapse && (
            <button
              onClick={onCollapse}
              aria-label="Réduire la liste"
              title="Réduire la liste"
              className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: "var(--text-muted)" }}
            >
              <CaretDoubleLeft size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="relative">
          <MagnifyingGlass
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            type="text"
            placeholder={tCommon("search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md py-1.5 pl-8 pr-3 text-xs outline-none"
            style={{
              backgroundColor: "var(--surface-2)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-subtle)",
            }}
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <NoteListSkeleton />
        ) : isError ? (
          <NoteListError message={errorMessage} />
        ) : filtered.length === 0 ? (
          <EmptyNoteList hasQuery={query.length > 0} onNewNote={onNewNote} />
        ) : sortKey === "manual" ? (
          // Manual sort mode: single flat DnD-enabled list (grouping disabled
          // since cross-group reordering would be confusing).
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={filtered.map((n) => n.id)} strategy={verticalListSortingStrategy}>
              {filtered.map((note) => (
                <NoteListItem
                  key={note.id}
                  note={note}
                  isActive={note.id === selectedNoteId}
                  onClick={() => onSelectNote(note.id)}
                  onDelete={onDeleteNote ? () => onDeleteNote(note.id) : undefined}
                  onRename={onRenameNote ? (t) => onRenameNote(note.id, t) : undefined}
                  onArchive={onArchiveNote ? (a) => onArchiveNote(note.id, a) : undefined}
                  sortable
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          // Render bucketed groups. When `selectedFolder` is null we only
          // produce one group with `label: null` — same flat layout as
          // before. When a folder is selected we render a small sticky-ish
          // section header per sub-path so it's obvious which sub-folder a
          // note belongs to.
          groups.map((group) => (
            <section key={group.key || "__root__"}>
              {group.label && (
                <div
                  className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{
                    backgroundColor: "var(--surface-1)",
                    color: "var(--text-muted)",
                    borderBottom: "1px solid var(--border-subtle)",
                  }}
                >
                  {group.label}
                </div>
              )}
              {group.notes.map((note) => (
                <NoteListItem
                  key={note.id}
                  note={note}
                  isActive={note.id === selectedNoteId}
                  onClick={() => onSelectNote(note.id)}
                  onDelete={onDeleteNote ? () => onDeleteNote(note.id) : undefined}
                  onRename={onRenameNote ? (t) => onRenameNote(note.id, t) : undefined}
                  onArchive={onArchiveNote ? (a) => onArchiveNote(note.id, a) : undefined}
                />
              ))}
            </section>
          ))
        )}
      </div>

      {/* Footer */}
      <div
        className="px-4 py-2"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {isLoading ? tCommon("loading") : `${filtered.length} note${filtered.length !== 1 ? "s" : ""}`}
        </span>
      </div>
    </div>
  );
}

function NoteListSkeleton() {
  return (
    <div className="space-y-0">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="animate-pulse px-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="flex justify-between gap-2">
            <div className="h-4 w-2/3 rounded" style={{ backgroundColor: "var(--surface-2)" }} />
            <div className="h-3 w-10 rounded" style={{ backgroundColor: "var(--surface-2)" }} />
          </div>
          <div className="mt-2 h-3 w-full rounded" style={{ backgroundColor: "var(--surface-2)" }} />
          <div className="mt-1 h-3 w-4/5 rounded" style={{ backgroundColor: "var(--surface-2)" }} />
        </div>
      ))}
    </div>
  );
}

function NoteListError({ message }: { message: string | null }) {
  const t = useTranslations("notes");
  const tCommon = useTranslations("common");

  return (
    <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
      <Warning size={32} style={{ color: "var(--color-red-400, #f87171)" }} />
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          {t("cannotLoad")}
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {message ?? t("loadError")}
        </p>
      </div>
    </div>
  );
}

function EmptyNoteList({
  hasQuery,
  onNewNote,
}: {
  hasQuery: boolean;
  onNewNote?: () => void;
}) {
  const t = useTranslations("notes");
  const tCommon = useTranslations("common");

  if (hasQuery) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <FileText size={32} style={{ color: "var(--border)" }} />
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
            {tCommon("noResults")}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {tCommon("tryOtherSearch")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: "var(--accent-subtle)" }}
      >
        <FileText size={24} style={{ color: "var(--accent)" }} />
      </div>
      <div>
        <p className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          {t("emptyFolder")}
        </p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {t("emptyFolderHint").split("\n").map((line, i) => (
            <span key={i}>{line}{i === 0 ? <br /> : null}</span>
          ))}
        </p>
      </div>
      {onNewNote && (
        <button
          onClick={onNewNote}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Plus size={13} />
          {t("createFirstNote")}
        </button>
      )}
    </div>
  );
}


// ── FolderHeaderTitle ────────────────────────────────────────────────────────
//
// Editable folder name shown at the top of the NoteList column. Single-click
// swaps the static title for an inline input (focused, text selected). Enter
// or blur commits, Escape cancels. Falls back to a plain span when no
// `onRename` handler is wired (e.g. demo / fallback mode) or when no folder
// is currently selected (the "Toutes les notes" virtual scope).

interface FolderHeaderTitleProps {
  folderName: string | null;
  folderPath: string | null;
  onRename?: (oldPath: string, newName: string) => Promise<void>;
  allNotesLabel: string;
}

function FolderHeaderTitle({
  folderName,
  folderPath,
  onRename,
  allNotesLabel,
}: FolderHeaderTitleProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(folderName ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-seed when the user navigates between folders so we never flash the
  // previous folder’s name into the input.
  useEffect(() => {
    setValue(folderName ?? "");
  }, [folderName]);

  useEffect(() => {
    if (editing) {
      const id = requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [editing]);

  // No editing path when there is no actual folder (the "all notes" virtual
  // scope) or no rename handler wired by the parent page.
  const canEdit = !!folderPath && !!onRename && !!folderName;

  const commit = async (next: string) => {
    setEditing(false);
    const cleaned = next.trim().replace(/^\/+|\/+$/g, "").replace(/\.\./g, "");
    if (!cleaned || cleaned === folderName || !canEdit || !folderPath) return;
    try {
      await onRename!(folderPath, cleaned);
    } catch {
      /* parent surfaces errors; the value stays as-is on failure */
    }
  };

  if (editing && canEdit) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setEditing(false);
            setValue(folderName ?? "");
          }
        }}
        onBlur={() => void commit(value)}
        className="rounded border px-2 py-0.5 text-sm font-semibold"
        style={{
          color: "var(--text-primary)",
          backgroundColor: "var(--surface-0)",
          borderColor: "var(--accent)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          outline: "none",
          minWidth: `${Math.max(value.length, 6) + 1}ch`,
        }}
        aria-label="Renommer le dossier"
      />
    );
  }

  if (!canEdit) {
    return (
      <span
        className="text-sm font-semibold"
        style={{ color: "var(--text-primary)" }}
      >
        {folderName ?? allNotesLabel}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="cursor-text rounded px-1 -mx-1 text-sm font-semibold transition-colors hover:bg-[var(--surface-2)]"
      style={{ color: "var(--text-primary)" }}
      title="Cliquer pour renommer le dossier"
    >
      {folderName}
    </button>
  );
}
