"use client";

import { AppShell } from "@/components/shell";
import {
  EmptyEditor,
  FileTree,
  NoteCanvasView,
  NoteEditor,
  NoteList,
} from "@/components/notes";
import {
  useNote,
  useNoteList,
  useFolderTree,
  useCreateNote,
  useCreateFolder,
  useDeleteFolder,
  useArchiveNote,
  useArchiveFolder,
  useDeleteNote,
  useRenameFolder,
  useRenameNote,
} from "@/components/notes/hooks";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { DeleteNoteModal } from "@/components/notes/DeleteNoteModal";
import { useConfirm, usePrompt } from "@/hooks/usePrompt";
import {
  ArrowsInSimple,
  ArrowsOutSimple,
  CaretDoubleRight,
  FolderSimple,
  ListBullets,
} from "@phosphor-icons/react";
import { folderAccentVars, folderColorFromTree } from "@/lib/folderAccent";
import { useShellChrome } from "@/components/shell/shell-chrome-context";
import { useShortcuts } from "@/lib/keyboard";

type NoteViewMode = "note" | "canvas";

function parseViewMode(raw: string | null): NoteViewMode {
  return raw === "canvas" ? "canvas" : "note";
}

/**
 * localStorage key remembering the last folder the user explicitly browsed.
 * Used as a fallback for the [id] page's initial selection when the URL
 * lacks `?folder=` — without it, deep-linking to a note (or arriving from
 * an older link) would snap the FileTree back to "Inbox".
 */
const LAST_FOLDER_STORAGE_KEY = "supernote.notes.lastFolder";

// ── Layout-state storage keys ────────────────────────────────────────────────
//
// Three persisted toggles drive the editor pane's available width:
//   - focusMode: hides BOTH FileTree + NoteList in one click (set by the
//     editor header's ArrowsOutSimple button, also auto-on for canvas view).
//   - fileTreeCollapsed / noteListCollapsed: independent column collapses
//     with a thin restore strip.
const FOCUS_MODE_STORAGE_KEY = "supernote.notes.focusMode";
const FILETREE_COLLAPSED_STORAGE_KEY = "supernote.notes.fileTreeCollapsed";
const NOTELIST_COLLAPSED_STORAGE_KEY = "supernote.notes.noteListCollapsed";

function readBoolFlag(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeBoolFlag(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* quota / disabled storage — best-effort */
  }
}

function readLastFolder(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_FOLDER_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLastFolder(folder: string | null) {
  if (typeof window === "undefined" || !folder) return;
  try {
    window.localStorage.setItem(LAST_FOLDER_STORAGE_KEY, folder);
  } catch {
    /* quota / disabled storage — best-effort */
  }
}

function NoteDetailContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const folderParam = searchParams.get("folder");
  const viewParam = parseViewMode(searchParams.get("view"));

  const { note, isLoading: noteLoading } = useNote(params.id);

  // Initial folder selection priority:
  //   1. `?folder=` query param  (set by /notes when navigating in)
  //   2. `supernote.notes.lastFolder` from localStorage (last folder the
  //      user actively browsed) — covers deep-links and refreshes.
  //   3. "Inbox" as a final fallback.
  // Note: `note?.folderPath` is intentionally NOT used as the initial value
  // because `note` is null on first render; instead, a useEffect below
  // promotes it once it loads.
  const [selectedFolder, setSelectedFolder] = useState<string | null>(
    () => folderParam ?? readLastFolder() ?? "Inbox",
  );
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  // View mode state mirrors the URL so deep-links honor `?view=canvas`. We
  // keep it in state (not just derived) so toggling is instant — pushing
  // to the router and waiting for it to round-trip would cause a flicker.
  const [viewMode, setViewMode] = useState<NoteViewMode>(viewParam);

  // Re-sync state when the URL changes from the outside (back/forward).
  // Without this, hitting Back after toggling would update the URL but
  // leave the view stuck on the previous mode.
  useEffect(() => {
    setViewMode(viewParam);
  }, [viewParam]);

  // ── Layout toggles ────────────────────────────────────────────────────────
  // `focusMode` hides both side columns (FileTree + NoteList) so the editor
  // / canvas can use the full pane width. The user's preference is persisted;
  // entering canvas view temporarily *forces* focus mode on (the canvas needs
  // every available pixel) and restores the user's prior choice on exit.
  const [focusMode, setFocusMode] = useState<boolean>(() => readBoolFlag(FOCUS_MODE_STORAGE_KEY));
  // Snapshot of `focusMode` taken when entering canvas view, so switching
  // back to Note view can restore exactly what the user had before. We use
  // a ref (not state) because the value must be captured synchronously
  // alongside the view-mode change without triggering an extra re-render.
  const preCanvasFocusModeRef = useRef<boolean | null>(null);

  // Independent column collapses — used when the user wants to hide ONE
  // side (e.g. keep the FileTree but ditch the NoteList). Focus mode
  // overrides both (everything hides) without clearing them, so toggling
  // focus off brings the user back to whatever individual state they had.
  const [fileTreeCollapsed, setFileTreeCollapsed] = useState<boolean>(() =>
    readBoolFlag(FILETREE_COLLAPSED_STORAGE_KEY),
  );
  const [noteListCollapsed, setNoteListCollapsed] = useState<boolean>(() =>
    readBoolFlag(NOTELIST_COLLAPSED_STORAGE_KEY),
  );

  // Persist on every change. Cheap; localStorage writes are sub-millisecond.
  useEffect(() => {
    writeBoolFlag(FOCUS_MODE_STORAGE_KEY, focusMode);
  }, [focusMode]);
  useEffect(() => {
    writeBoolFlag(FILETREE_COLLAPSED_STORAGE_KEY, fileTreeCollapsed);
  }, [fileTreeCollapsed]);
  useEffect(() => {
    writeBoolFlag(NOTELIST_COLLAPSED_STORAGE_KEY, noteListCollapsed);
  }, [noteListCollapsed]);

  const handleToggleFocusMode = useCallback(() => {
    setFocusMode((prev) => !prev);
    // User explicitly toggled while in canvas view → drop the saved
    // pre-canvas value so it doesn't override their choice on exit.
    preCanvasFocusModeRef.current = null;
  }, []);

  const handleToggleFileTreeCollapsed = useCallback(() => {
    setFileTreeCollapsed((prev) => !prev);
  }, []);

  const handleToggleNoteListCollapsed = useCallback(() => {
    setNoteListCollapsed((prev) => !prev);
  }, []);

  // Once the note loads, promote its folderPath to the selected folder if
  // the URL didn't carry a `?folder=` hint. Fixes the flicker where the
  // FileTree briefly snapped back to Inbox before the note's metadata
  // arrived.
  useEffect(() => {
    if (note?.folderPath && !folderParam) {
      setSelectedFolder(note.folderPath);
    }
  }, [note?.folderPath, folderParam]);

  // Persist the active folder so a subsequent deep-link (or hard refresh)
  // lands on the same place even if the URL drops `?folder=`.
  useEffect(() => {
    writeLastFolder(selectedFolder);
  }, [selectedFolder]);

  const handleSetViewMode = useCallback(
    (next: NoteViewMode) => {
      if (next === viewMode) return;
      // Auto-focus when entering canvas view: snapshot the user's current
      // focus-mode preference so we can restore it when they switch back.
      // We only snapshot on the entering edge (note → canvas); switching
      // canvas → canvas is a no-op above and never reaches here.
      if (next === "canvas") {
        if (preCanvasFocusModeRef.current === null) {
          preCanvasFocusModeRef.current = focusMode;
        }
        if (!focusMode) setFocusMode(true);
      } else {
        // Leaving canvas view → restore the snapshot if we took one.
        if (preCanvasFocusModeRef.current !== null) {
          setFocusMode(preCanvasFocusModeRef.current);
          preCanvasFocusModeRef.current = null;
        }
      }
      setViewMode(next);
      // Build the next URL preserving any existing query params (esp. folder).
      const sp = new URLSearchParams(searchParams.toString());
      if (next === "note") sp.delete("view");
      else sp.set("view", next);
      const qs = sp.toString();
      router.replace(`/notes/${params.id}${qs ? `?${qs}` : ""}`, {
        scroll: false,
      });
    },
    [viewMode, focusMode, searchParams, router, params.id],
  );

  // Honour the URL's `?view=canvas` even when arrived at via deep-link or
  // back/forward — the handler above only fires on user-initiated toggles.
  // We mirror the same snapshot/restore behaviour so the user's focus-mode
  // preference is preserved across canvas round-trips.
  useEffect(() => {
    if (viewParam === "canvas") {
      if (preCanvasFocusModeRef.current === null) {
        preCanvasFocusModeRef.current = focusMode;
      }
      if (!focusMode) setFocusMode(true);
    } else {
      if (preCanvasFocusModeRef.current !== null) {
        setFocusMode(preCanvasFocusModeRef.current);
        preCanvasFocusModeRef.current = null;
      }
    }
    // Intentionally NOT depending on `focusMode` — this effect must only
    // react to URL transitions, not to the user toggling focus by hand
    // (which would create a snapshot/restore loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewParam]);

  const { notes, isLoading, isError, errorMessage, isFallback } = useNoteList(selectedFolder);
  // Full unfiltered list — feeds the FileTree's per-folder note counts.
  // Shares the underlying tRPC cache with the filtered call above, so no
  // extra request is fired.
  const { notes: allNotes } = useNoteList(null);
  const { folders, isLoading: foldersLoading } = useFolderTree();
  const { createNote } = useCreateNote();
  const { createFolder } = useCreateFolder();
  const { renameFolder } = useRenameFolder();
  const { deleteFolder } = useDeleteFolder();
  const { deleteNote, isPending: isDeleting } = useDeleteNote();
  const { renameNote } = useRenameNote();
  const { setArchived } = useArchiveNote();
  const { archiveFolder } = useArchiveFolder();
  const prompt = usePrompt();
  const confirm = useConfirm();

  const handleSelectFolder = useCallback((path: string) => {
    setSelectedFolder(path);
    // Auto-open the most recently updated note inside this folder (or its
    // descendants). Saves a click — and matches the user's mental model
    // that the folder *is* its top note. Fall back to the bare folder URL
    // when the folder is empty so they land on the empty-state.
    const inFolder = allNotes.filter(
      (n) => n.folderPath === path || n.folderPath.startsWith(`${path}/`),
    );
    if (inFolder.length === 0) {
      router.push(`/notes?folder=${encodeURIComponent(path)}`);
      return;
    }
    const mostRecent = inFolder.reduce((acc, n) =>
      n.updatedAt > acc.updatedAt ? n : acc,
    );
    router.push(`/notes/${mostRecent.id}?folder=${encodeURIComponent(path)}`);
  }, [allNotes, router]);

  const handleNewNote = useCallback(async (parentPath?: string | null) => {
    const safeParent = typeof parentPath === "string" ? parentPath : null;
    const folder = safeParent ?? selectedFolder ?? "Inbox";
    console.info("[handleNewNote] start", { folder, parentPath });
    try {
      const id = await createNote({ folder, title: "Nouvelle note" });
      console.info("[handleNewNote] got id", id);
      if (!id) {
        console.warn("[handleNewNote] createNote resolved with empty id, aborting navigation");
        return;
      }
      setSelectedFolder(folder);
      router.push(`/notes/${id}?folder=${encodeURIComponent(folder)}`);
    } catch (err) {
      console.error("[handleNewNote] createNote failed", err);
    }
  }, [selectedFolder, createNote, router]);

  const handleNewFolder = useCallback(async (parentPath?: string | null) => {
    const safeParent = typeof parentPath === "string" ? parentPath : null;
    const raw = await prompt("Nom du dossier ?", { placeholder: "Mon dossier" });
    const name = raw?.trim();
    if (!name) return;
    // Sanitize: no leading/trailing slashes, no ".." segments.
    const cleaned = name.replace(/^\/+|\/+$/g, "").replace(/\.\./g, "");
    if (!cleaned) return;
    // Header "+" → null → root. Per-folder "+" → folder.path → nest.
    const fullPath = safeParent ? `${safeParent}/${cleaned}` : cleaned;
    await createFolder(fullPath);
    setSelectedFolder(fullPath);
    router.push(`/notes?folder=${encodeURIComponent(fullPath)}`);
  }, [createFolder, router, prompt]);

  const handleRenameFolder = useCallback(async (oldPath: string) => {
    const currentName = oldPath.split("/").pop() ?? oldPath;
    const raw = await prompt(`Renommer "${currentName}"`, {
      defaultValue: currentName,
      placeholder: "Nouveau nom",
      confirmLabel: "Renommer",
    });
    const name = raw?.trim().replace(/^\/+|\/+$/g, "").replace(/\.\./g, "");
    if (!name || name === currentName) return;
    const parts = oldPath.split("/");
    parts[parts.length - 1] = name;
    const newPath = parts.join("/");
    try {
      await renameFolder(oldPath, newPath);
      // Mirror the selection update from /notes/page.tsx so the user
      // doesn't get bumped to Inbox if the folder they were viewing got
      // renamed under them.
      if (selectedFolder === oldPath || selectedFolder?.startsWith(`${oldPath}/`)) {
        setSelectedFolder(newPath + (selectedFolder!.slice(oldPath.length)));
      }
    } catch (err) {
      console.error("[handleRenameFolder] failed", err);
    }
  }, [prompt, renameFolder, selectedFolder]);

  const handleRenameFolderInline = useCallback(async (oldPath: string, newName: string) => {
    const parts = oldPath.split("/");
    parts[parts.length - 1] = newName;
    const newPath = parts.join("/");
    await renameFolder(oldPath, newPath);
    if (selectedFolder === oldPath || selectedFolder?.startsWith(`${oldPath}/`)) {
      setSelectedFolder(newPath + (selectedFolder!.slice(oldPath.length)));
    }
  }, [renameFolder, selectedFolder]);

  const handleArchiveNote = useCallback(async (id: string, archived: boolean): Promise<void> => {
    await setArchived(id, archived);
  }, [setArchived]);

  const handleArchiveFolder = useCallback(async (path: string): Promise<{ archivedCount: number }> => {
    const ok = await confirm({
      title: `Archiver "${path}" ?`,
      description:
        "Toutes les notes du dossier (et de ses sous-dossiers) seront déplacées dans les archives. Le dossier disparaîtra de l'arborescence — vous pourrez le recréer ou retrouver les notes dans /archive.",
      confirmLabel: "Archiver",
    });
    if (!ok) return { archivedCount: 0 };
    return await archiveFolder(path);
  }, [archiveFolder, confirm]);

  const handleRenameNote = useCallback(async (id: string, newTitle: string): Promise<void> => {
    await renameNote(id, newTitle);
  }, [renameNote]);

  const handleDeleteFolder = useCallback(async (path: string) => {
    const ok = await confirm({
      title: `Supprimer "${path}" ?`,
      description:
        "Toutes les notes de ce dossier (et de ses sous-dossiers) seront supprimées. Cette action est irréversible.",
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteFolder(path);
      // If we were editing a note inside the deleted folder, the note no
      // longer exists — bounce back to the notes index. The folder we land
      // on is Inbox by default.
      const editingDeletedNote = note?.folderPath === path
        || (note?.folderPath?.startsWith(`${path}/`) ?? false);
      if (editingDeletedNote || selectedFolder === path || selectedFolder?.startsWith(`${path}/`)) {
        router.push("/notes");
      }
    } catch (err) {
      console.error("[handleDeleteFolder] failed", err);
    }
  }, [confirm, deleteFolder, note, router, selectedFolder]);

  const handleSelectNote = useCallback((id: string) => {
    // Prefer the note's own folderPath when available (it might differ
    // from `selectedFolder` if the user clicked a result from a search /
    // unfiltered list), but fall back to the active selection so the
    // FileTree doesn't flicker to Inbox while metadata loads.
    const target = notes.find((n) => n.id === id);
    const folder = target?.folderPath ?? selectedFolder ?? "Inbox";
    router.push(`/notes/${id}?folder=${encodeURIComponent(folder)}`);
  }, [notes, router, selectedFolder]);

  const handleDeleteRequest = useCallback((id: string) => {
    setDeleteTarget(id);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    await deleteNote(deleteTarget);
    setDeleteTarget(null);
    router.push("/notes");
  }, [deleteTarget, deleteNote, router]);

  // Ctrl/Cmd+N → nouvelle note dans le dossier actif. En onglet de
  // navigateur, Chrome verrouille Ctrl+N (ouvre une fenêtre) ; on
  // enregistre Ctrl+Alt+N en parallèle, jamais interceptée. Scope "global"
  // pour que ça marche aussi quand le focus est dans l'éditeur.
  useShortcuts([
    {
      id: "notes.detail.create",
      keys: "mod+n",
      scope: "global",
      description: "Nouvelle note",
      handler: () => {
        void handleNewNote(null);
        return true;
      },
    },
    {
      id: "notes.detail.create-alt",
      keys: "mod+alt+n",
      scope: "global",
      description: "Nouvelle note (alternative onglet navigateur)",
      handler: () => {
        void handleNewNote(null);
        return true;
      },
    },
  ]);

  const folderName = selectedFolder
    ? selectedFolder.split("/").pop() ?? selectedFolder
    : null;

  const editorAccentColor = folderColorFromTree(selectedFolder, foldersLoading ? [] : folders);
  const editorAccentStyle = folderAccentVars(editorAccentColor) ?? {};

  // Publish the folder accent override to the shell so the sidebar / topbar /
  // right panel inherit the tint while the user is in this folder. Cleared
  // on unmount so /tags, /todos, etc. fall back to the default purple accent.
  const { setAccentOverride } = useShellChrome();
  useEffect(() => {
    const vars = folderAccentVars(editorAccentColor);
    setAccentOverride(vars ? (vars as unknown as Record<string, string>) : null);
    return () => setAccentOverride(null);
  }, [editorAccentColor, setAccentOverride]);

  // Effective visibility — focus mode short-circuits both individual collapse
  // toggles. Computing this once keeps the JSX flat and the rules in one place.
  const showFileTree = !focusMode && !fileTreeCollapsed;
  const showNoteList = !focusMode && !noteListCollapsed;

  return (
    <div className="flex h-full overflow-hidden">
      {showFileTree ? (
        <FileTree
          folders={foldersLoading ? [] : folders}
          selectedFolder={selectedFolder}
          onSelectFolder={handleSelectFolder}
          onNewFolder={handleNewFolder}
          onNewNote={handleNewNote}
          onRenameFolder={handleRenameFolder}
          onRenameFolderInline={handleRenameFolderInline}
          onDeleteFolder={handleDeleteFolder}
          onArchiveFolder={handleArchiveFolder}
          notes={allNotes.filter((n) => !n.archivedAt)}
          onCollapse={handleToggleFileTreeCollapsed}
        />
      ) : !focusMode ? (
        // Restore strip — only shown when the user collapsed THIS column
        // individually. In focus mode we hide the entire row so the canvas
        // gets the full width without any visual debris.
        <CollapsedColumnStrip
          label="Vault"
          icon={<FolderSimple size={14} />}
          onExpand={handleToggleFileTreeCollapsed}
        />
      ) : null}

      {showNoteList ? (
        <NoteList
          notes={notes}
          allNotes={allNotes}
          selectedNoteId={params.id}
          folderName={folderName}
          selectedFolder={selectedFolder}
          onSelectNote={handleSelectNote}
          isLoading={isLoading}
          isError={isError}
          errorMessage={errorMessage}
          isFallback={isFallback}
          onNewNote={handleNewNote}
          onDeleteNote={handleDeleteRequest}
          onRenameNote={handleRenameNote}
          onArchiveNote={handleArchiveNote}
          onRenameFolderInline={handleRenameFolderInline}
          onCollapse={handleToggleNoteListCollapsed}
        />
      ) : !focusMode ? (
        <CollapsedColumnStrip
          label="Notes"
          icon={<ListBullets size={14} />}
          onExpand={handleToggleNoteListCollapsed}
        />
      ) : null}

      <div
        className="flex flex-1 flex-col overflow-hidden"
        style={{ backgroundColor: "var(--surface-0)", ...editorAccentStyle }}
      >
        {noteLoading ? (
          <NoteLoadingSkeleton />
        ) : note ? (
          <>
            <ViewToggle
              mode={viewMode}
              onChange={handleSetViewMode}
              focusMode={focusMode}
              onToggleFocusMode={handleToggleFocusMode}
            />
            {viewMode === "note" ? (
              <NoteEditor note={note} />
            ) : (
              <NoteCanvasView note={note} />
            )}
          </>
        ) : (
          <EmptyEditor onNewNote={handleNewNote} />
        )}
      </div>

      {deleteTarget && (
        <DeleteNoteModal
          isOpen
          isPending={isDeleting}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

interface CollapsedColumnStripProps {
  label: string;
  icon: React.ReactNode;
  onExpand: () => void;
}

/**
 * Thin vertical bar shown in place of a fully-collapsed column. Clicking
 * anywhere on it (or the chevron) re-expands the column. Width matches the
 * Sidebar's collapsed strip elsewhere in the app so the layout stays tidy.
 */
function CollapsedColumnStrip({ label, icon, onExpand }: CollapsedColumnStripProps) {
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={`Afficher ${label}`}
      title={`Afficher ${label}`}
      className="flex h-full flex-col items-center justify-start gap-2 border-r py-3 transition-colors hover:bg-[var(--surface-2)]"
      style={{
        width: 24,
        minWidth: 24,
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
        color: "var(--text-muted)",
      }}
    >
      <CaretDoubleRight size={12} />
      {icon}
      <span
        className="select-none text-[10px] font-semibold uppercase tracking-widest"
        style={{
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
          letterSpacing: "0.15em",
        }}
      >
        {label}
      </span>
    </button>
  );
}

// Note: params come from react-router's `useParams()` inside
// NoteDetailContent — no Next-style `params: Promise<...>` prop is needed.
export default function NoteDetailPage() {
  return (
    <AppShell>
      <Suspense fallback={<NoteDetailSkeleton />}>
        <NoteDetailContent />
      </Suspense>
    </AppShell>
  );
}

interface ViewToggleProps {
  mode: NoteViewMode;
  onChange: (mode: NoteViewMode) => void;
  focusMode: boolean;
  onToggleFocusMode: () => void;
}

/**
 * Segmented control switching between the markdown ("Note") and canvas
 * ("Canvas") views of the same note. Sits in the editor pane just above
 * the active view so it stays put when the user toggles back and forth.
 *
 * The Focus button (next to the segmented control) hides both side
 * columns so the active view fills the available width — essential for
 * the Canvas view, but also handy for distraction-free editing.
 */
function ViewToggle({ mode, onChange, focusMode, onToggleFocusMode }: ViewToggleProps) {
  return (
    <div
      className="flex shrink-0 items-center justify-between gap-1 px-10 pt-4"
      style={{ backgroundColor: "var(--surface-0)" }}
    >
      <div
        className="inline-flex items-center rounded-md p-0.5"
        style={{
          backgroundColor: "var(--surface-2)",
          border: "1px solid var(--border-subtle)",
        }}
        role="tablist"
        aria-label="Vue de la note"
      >
        <ViewToggleButton
          active={mode === "note"}
          onClick={() => onChange("note")}
          label="Note"
        />
        <ViewToggleButton
          active={mode === "canvas"}
          onClick={() => onChange("canvas")}
          label="Canvas"
        />
      </div>
      <button
        type="button"
        onClick={onToggleFocusMode}
        aria-pressed={focusMode}
        title={focusMode ? "Quitter le mode focus" : "Mode focus (cacher les colonnes)"}
        aria-label={focusMode ? "Quitter le mode focus" : "Mode focus"}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--surface-2)]"
        style={{
          color: focusMode ? "var(--accent)" : "var(--text-muted)",
          border: "1px solid var(--border-subtle)",
          backgroundColor: focusMode ? "var(--accent-subtle)" : "transparent",
        }}
      >
        {focusMode ? <ArrowsInSimple size={13} /> : <ArrowsOutSimple size={13} />}
        <span>{focusMode ? "Quitter focus" : "Focus"}</span>
      </button>
    </div>
  );
}

function ViewToggleButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="rounded px-3 py-1 text-xs font-medium transition-colors"
      style={{
        backgroundColor: active ? "var(--surface-0)" : "transparent",
        color: active ? "var(--text-primary)" : "var(--text-muted)",
        boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
      }}
    >
      {label}
    </button>
  );
}

function NoteLoadingSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden px-10 py-6">
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-3/4 rounded" style={{ backgroundColor: "var(--surface-2)" }} />
        <div className="h-4 w-1/2 rounded" style={{ backgroundColor: "var(--surface-2)" }} />
        <div className="mt-8 space-y-3">
          {[100, 85, 90, 70].map((w, i) => (
            <div
              key={i}
              className="h-4 rounded"
              style={{ width: `${w}%`, backgroundColor: "var(--surface-2)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function NoteDetailSkeleton() {
  return (
    <div className="flex h-full overflow-hidden">
      <div
        className="border-r"
        style={{
          width: 280,
          minWidth: 280,
          backgroundColor: "var(--surface-1)",
          borderColor: "var(--border-subtle)",
        }}
      />
      <div
        className="border-r"
        style={{
          width: 320,
          minWidth: 320,
          backgroundColor: "var(--surface-0)",
          borderColor: "var(--border-subtle)",
        }}
      />
      <div className="flex-1" style={{ backgroundColor: "var(--surface-0)" }} />
    </div>
  );
}
