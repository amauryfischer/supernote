"use client";

import { Archive, ArrowsDownUp, CaretDoubleLeft, FileText, MagnifyingGlass, Plus, SortAscending, Warning } from "@phosphor-icons/react";
import { Button, Input } from "@heroui/react";
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
import { trpc } from "@/lib/trpc/client";
import { cloudRoomSlug, cloudVaultId, MOUNT_PATH_PREFIX } from "@/lib/online-sync/room-id";

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
  /** Called when the user starts dragging a note towards the FileTree. */
  onDragNote?: (noteId: string) => void;
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
  onDragNote,
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

  // ── Provenance (vault mounts) ──────────────────────────────────────────────
  // Les notes hissées d'un coffre monté portent un chemin préfixé par
  // `@mounts/<slug>/`. Le slug seul ne porte pas le nom humain du coffre : on
  // résout `sync.listMounts` (requête worker locale, pas de réseau) pour bâtir
  // une table slug → libellé, identique à FileTree, et badger chaque note
  // montée de sa provenance. Mêmes args que FileTree → cache TanStack partagé.
  const mountsQuery = trpc.sync.listMounts.useQuery({ sourceVaultId: null });
  const mountLabelBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of mountsQuery.data?.mounts ?? []) {
      const slug = cloudRoomSlug(cloudVaultId(m.serverUrl, m.vaultKey));
      map.set(slug, m.label || m.vaultKey);
    }
    return map;
  }, [mountsQuery.data]);

  const mountLabelForNote = useCallback(
    (note: Note): string | undefined => {
      // `filePath` porte le chemin complet (`@mounts/<slug>/…/note.md`) ;
      // `folderPath` en est dérivé et porte le même préfixe. On prend le plus
      // fiable disponible.
      const path = note.filePath ?? note.folderPath;
      const prefix = `${MOUNT_PATH_PREFIX}/`;
      if (!path.startsWith(prefix)) return undefined;
      const slug = path.slice(prefix.length).split("/")[0];
      if (!slug) return undefined;
      // Slug orphelin (coffre déconnecté, entités pas encore purgées) → pas de
      // badge plutôt qu'un libellé brut peu parlant.
      return mountLabelBySlug.get(slug);
    },
    [mountLabelBySlug],
  );

  // Hover prefetch — warms the `entities.get` cache before the click so the
  // editor opens instantly instead of flashing a skeleton. Skipped in demo /
  // fallback mode where there is no worker to answer the query.
  const utils = trpc.useUtils();
  const prefetchNote = useCallback(
    (id: string) => {
      if (isFallback) return;
      void utils.entities.get.prefetch({ id }, { staleTime: 30_000 });
    },
    [utils, isFallback],
  );

  // Hover preview — body complet pour la carte d'aperçu (les items de liste
  // n'embarquent pas de body). Réutilise le cache chauffé par le prefetch
  // ci-dessus : dans le cas nominal c'est un hit immédiat.
  const fetchNotePreview = useCallback(
    async (id: string): Promise<string | null> => {
      if (isFallback) return null;
      try {
        const e = await utils.entities.get.fetch({ id });
        const body = (e as { body?: unknown }).body;
        return typeof body === "string" ? body : "";
      } catch {
        return null;
      }
    },
    [utils, isFallback],
  );

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
      className="flex h-full w-full flex-col border-r md:w-[320px] md:min-w-[320px]"
      style={{
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
            <Button
              variant="ghost"
              size="sm"
              isIconOnly
              onPress={onNewNote}
              aria-label={t("newNote")}
              className="h-6 w-6 min-w-0 rounded-md hover:bg-[var(--surface-2)]"
              style={{ color: "var(--text-muted)" }}
            >
              <Plus size={13} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            isIconOnly
            onPress={() => setShowArchived((v) => !v)}
            aria-label={showArchived ? "Masquer les notes archivées" : "Afficher les notes archivées"}
            className="h-6 w-6 min-w-0 rounded-md hover:bg-[var(--surface-2)]"
            style={{
              color: showArchived ? "var(--accent)" : "var(--text-muted)",
              backgroundColor: showArchived ? "var(--accent-subtle)" : undefined,
            }}
          >
            <Archive size={13} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onPress={toggleSort}
            aria-label={t("changeSort")}
            className="h-6 min-w-0 gap-1.5 rounded-md px-2 text-xs hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-muted)" }}
          >
            {sortKey === "updatedAt" ? <ArrowsDownUp size={12} /> : <SortAscending size={12} />}
            {sortKey === "updatedAt" ? tCommon("date") : sortKey === "title" ? tCommon("title") : "Manuel"}
          </Button>
          {onCollapse && (
            <Button
              variant="ghost"
              size="sm"
              isIconOnly
              onPress={onCollapse}
              aria-label="Réduire la liste"
              className="h-6 w-6 min-w-0 rounded-md hover:bg-[var(--surface-2)]"
              style={{ color: "var(--text-muted)" }}
            >
              <CaretDoubleLeft size={13} />
            </Button>
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
          <Input
            type="text"
            placeholder={tCommon("search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={tCommon("search")}
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
                // sn-overlay-in: token-timed entrance (fade + gentle rise),
                // reduced-motion-safe. Keyed by note.id so React preserves the
                // element across reorders — the entrance only fires once on
                // mount and never re-runs when dnd-kit shuffles rows. The
                // dnd transform/settle lives on NoteListItem's own node, so
                // this outer wrapper can't collide with the drag.
                <div key={note.id} className="sn-overlay-in">
                  <NoteListItem
                    note={note}
                    isActive={note.id === selectedNoteId}
                    onClick={() => onSelectNote(note.id)}
                    onHover={() => prefetchNote(note.id)}
                    getPreview={fetchNotePreview}
                    onDelete={onDeleteNote ? () => onDeleteNote(note.id) : undefined}
                    onRename={onRenameNote ? (t) => onRenameNote(note.id, t) : undefined}
                    onArchive={onArchiveNote ? (a) => onArchiveNote(note.id, a) : undefined}
                    onDragNote={onDragNote}
                    mountLabel={mountLabelForNote(note)}
                    sortable
                  />
                </div>
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
                  className="sn-overlay-in px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide"
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
                // Subtle entrance per row — fade + gentle rise, settled with
                // --sn-ease-out over --sn-dur-3 (via .sn-overlay-in). Keyed by
                // id so it fires once on mount, not on every re-sort/refilter.
                <div key={note.id} className="sn-overlay-in">
                  <NoteListItem
                    note={note}
                    isActive={note.id === selectedNoteId}
                    onClick={() => onSelectNote(note.id)}
                    onHover={() => prefetchNote(note.id)}
                    getPreview={fetchNotePreview}
                    onDelete={onDeleteNote ? () => onDeleteNote(note.id) : undefined}
                    onRename={onRenameNote ? (t) => onRenameNote(note.id, t) : undefined}
                    onArchive={onArchiveNote ? (a) => onArchiveNote(note.id, a) : undefined}
                    onDragNote={onDragNote}
                    mountLabel={mountLabelForNote(note)}
                  />
                </div>
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
        <div key={i} className="px-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <div className="flex justify-between gap-2">
            <div className="sn-shimmer h-4 w-2/3 rounded" style={{ backgroundColor: "var(--surface-2)" }} />
            <div className="sn-shimmer h-3 w-10 rounded" style={{ backgroundColor: "var(--surface-2)" }} />
          </div>
          <div className="sn-shimmer mt-2 h-3 w-full rounded" style={{ backgroundColor: "var(--surface-2)" }} />
          <div className="sn-shimmer mt-1 h-3 w-4/5 rounded" style={{ backgroundColor: "var(--surface-2)" }} />
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
        <Button
          variant="primary"
          size="sm"
          onPress={onNewNote}
          className="gap-1.5 rounded-lg px-4 text-xs font-medium"
          style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
        >
          <Plus size={13} />
          {t("createFirstNote")}
        </Button>
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
    <Button
      variant="ghost"
      size="sm"
      onPress={() => setEditing(true)}
      className="h-auto cursor-text rounded px-1 -mx-1 text-sm font-semibold hover:bg-[var(--surface-2)]"
      style={{ color: "var(--text-primary)" }}
      aria-label="Cliquer pour renommer le dossier"
    >
      {folderName}
    </Button>
  );
}
