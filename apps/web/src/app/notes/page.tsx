"use client";

import { AppShell } from "@/components/shell";
import {
  EmptyEditor,
  FileTree,
  NoteList,
} from "@/components/notes";
import {
  useNoteList,
  useFolderTree,
  useCreateNote,
  useCreateFolder,
  useDeleteFolder,
  useRenameFolder,
  useRenameNote,
  useArchiveNote,
  useArchiveFolder,
} from "@/components/notes/hooks";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useConfirm, usePrompt } from "@/hooks/usePrompt";
import { folderAccentVars, folderColorFromTree } from "@/lib/folderAccent";
import {
  useMobileFab,
  useMobileTitle,
  useShellChrome,
} from "@/components/shell/shell-chrome-context";
import { useShortcuts } from "@/lib/keyboard";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Plus } from "@phosphor-icons/react";

function NotesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderParam = searchParams.get("folder");

  const [selectedFolder, setSelectedFolder] = useState<string | null>(
    folderParam ?? "Inbox",
  );

  // Mirror selectedFolder into a ref so the create-folder / create-note
  // callbacks always read the LATEST value, never a stale closure capture.
  // Without this, the user could select "Travail" and immediately click the
  // header "+ Nouveau dossier" before React re-rendered the callback, and
  // the new folder would land at root instead of nested under "Travail".
  const selectedFolderRef = useRef(selectedFolder);
  useEffect(() => {
    selectedFolderRef.current = selectedFolder;
  }, [selectedFolder]);

  const { notes, isLoading, isError, errorMessage, isFallback } = useNoteList(selectedFolder);
  // Full unfiltered note list — used purely to compute the per-folder note
  // counts in the FileTree. Shares the same tRPC cache key as the filtered
  // call above (both queries are `entities.list` with identical args), so
  // this does NOT trigger an extra network round-trip.
  const { notes: allNotes } = useNoteList(null);
  const { folders, isLoading: foldersLoading } = useFolderTree();
  const { createNote } = useCreateNote();
  const { createFolder } = useCreateFolder();
  const { renameFolder } = useRenameFolder();
  const { deleteFolder } = useDeleteFolder();
  const { renameNote } = useRenameNote();
  const { setArchived } = useArchiveNote();
  const { archiveFolder } = useArchiveFolder();
  const prompt = usePrompt();
  const confirm = useConfirm();

  const handleSelectFolder = useCallback((path: string) => {
    setSelectedFolder(path);
    selectedFolderRef.current = path;
    router.push(`/notes?folder=${encodeURIComponent(path)}`);
  }, [router]);

  const handleNewNote = useCallback(async (parentPath?: string | null) => {
    // `parentPath` is forwarded from FileTree's per-folder "+" button.
    // Some buttons bind `onClick={onNewNote}` directly, which makes React
    // pass a MouseEvent as the first arg — guard against that.
    const safeParent = typeof parentPath === "string" ? parentPath : null;
    const folder = safeParent ?? selectedFolderRef.current ?? "Inbox";
    console.info("[handleNewNote] start", { folder, parentPath });
    try {
      const id = await createNote({ folder, title: "Nouvelle note" });
      console.info("[handleNewNote] got id", id);
      // Defensive: if the worker ever returned a falsy id (race during
      // re-init, malformed payload, …), keep the user on /notes instead
      // of routing them to /notes/undefined which is what previously made
      // the "+" button look silently broken.
      if (!id) {
        console.warn("[handleNewNote] createNote resolved with empty id, aborting navigation");
        return;
      }
      // Switch the middle list to the folder where the note actually landed
      // so the user sees their freshly created note instead of an unrelated
      // "Dossier vide" state.
      setSelectedFolder(folder);
      selectedFolderRef.current = folder;
      router.push(`/notes/${id}?folder=${encodeURIComponent(folder)}`);
    } catch (err) {
      // The previous version awaited createNote without a try/catch, so
      // any rejection from the worker (e.g. quota error, vault not
      // mounted) bubbled up as an unhandled promise rejection and the
      // user just saw the URL stay at /notes with no feedback.
      console.error("[handleNewNote] createNote failed", err);
    }
  }, [createNote, router]);

  const handleNewFolder = useCallback(async (parentPath?: string | null) => {
    const safeParent = typeof parentPath === "string" ? parentPath : null;
    const raw = await prompt("Nom du dossier ?", { placeholder: "Mon dossier" });
    const name = raw?.trim();
    if (!name) return;
    // Sanitize: no leading/trailing slashes, no ".." segments.
    const cleaned = name.replace(/^\/+|\/+$/g, "").replace(/\.\./g, "");
    if (!cleaned) return;
    // Header "+ Nouveau dossier" button passes null → create at root.
    // Per-folder "+" button passes the folder path → nest underneath.
    // We deliberately do NOT fall back to `selectedFolderRef.current` for the
    // header case; the user expects "+" next to VAULT to create a root folder.
    const fullPath = safeParent ? `${safeParent}/${cleaned}` : cleaned;
    await createFolder(fullPath);
    setSelectedFolder(fullPath);
    selectedFolderRef.current = fullPath;
    router.push(`/notes?folder=${encodeURIComponent(fullPath)}`);
  }, [createFolder, router, prompt]);

  const handleSelectNote = useCallback((id: string) => {
    // ALWAYS forward the user's currently selected folder to the [id] page.
    // If we omit `?folder=`, the [id] page falls back to Inbox while the
    // note is still loading — visibly snapping the FileTree selection away
    // from the folder the user was just browsing. Mirroring it via the URL
    // keeps the selection stable across the navigation.
    const folder = selectedFolderRef.current ?? "Inbox";
    router.push(`/notes/${id}?folder=${encodeURIComponent(folder)}`);
  }, [router]);

  const handleRenameFolder = useCallback(async (oldPath: string) => {
    const currentName = oldPath.split("/").pop() ?? oldPath;
    const raw = await prompt(`Renommer "${currentName}"`, {
      defaultValue: currentName,
      placeholder: "Nouveau nom",
      confirmLabel: "Renommer",
    });
    const name = raw?.trim().replace(/^\/+|\/+$/g, "").replace(/\.\./g, "");
    if (!name || name === currentName) return;
    // Replace just the leaf segment so the parent path is preserved.
    const parts = oldPath.split("/");
    parts[parts.length - 1] = name;
    const newPath = parts.join("/");
    try {
      await renameFolder(oldPath, newPath);
      // Follow the rename so the user lands on the same folder under its
      // new name — otherwise the selection silently jumps to "Inbox".
      if (selectedFolderRef.current === oldPath || selectedFolderRef.current?.startsWith(`${oldPath}/`)) {
        const nextSelected = newPath + (selectedFolderRef.current!.slice(oldPath.length));
        setSelectedFolder(nextSelected);
        selectedFolderRef.current = nextSelected;
        router.push(`/notes?folder=${encodeURIComponent(nextSelected)}`);
      }
    } catch (err) {
      console.error("[handleRenameFolder] failed", err);
    }
  }, [prompt, renameFolder, router]);

  /**
   * Inline rename — called from `FolderNode` when the user double-clicks on
   * the folder name and confirms (Enter or blur). Receives the new leaf name.
   * Preserves the parent path and updates the URL if the renamed folder is
   * the one currently selected.
   */
  const handleRenameFolderInline = useCallback(async (oldPath: string, newName: string) => {
    const parts = oldPath.split("/");
    parts[parts.length - 1] = newName;
    const newPath = parts.join("/");
    await renameFolder(oldPath, newPath);
    if (selectedFolderRef.current === oldPath || selectedFolderRef.current?.startsWith(`${oldPath}/`)) {
      const nextSelected = newPath + (selectedFolderRef.current!.slice(oldPath.length));
      setSelectedFolder(nextSelected);
      selectedFolderRef.current = nextSelected;
      router.push(`/notes?folder=${encodeURIComponent(nextSelected)}`);
    }
  }, [renameFolder, router]);

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
      // If the deleted folder (or one of its descendants) was selected,
      // fall back to Inbox so the middle pane doesn't render a phantom.
      if (selectedFolderRef.current === path || selectedFolderRef.current?.startsWith(`${path}/`)) {
        setSelectedFolder("Inbox");
        selectedFolderRef.current = "Inbox";
        router.push(`/notes?folder=${encodeURIComponent("Inbox")}`);
      }
    } catch (err) {
      console.error("[handleDeleteFolder] failed", err);
    }
  }, [confirm, deleteFolder, router]);

  const handleRenameNote = useCallback(async (id: string, newTitle: string): Promise<void> => {
    await renameNote(id, newTitle);
  }, [renameNote]);

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
    const result = await archiveFolder(path);
    if (selectedFolderRef.current === path || selectedFolderRef.current?.startsWith(`${path}/`)) {
      setSelectedFolder("Inbox");
      selectedFolderRef.current = "Inbox";
      router.push(`/notes?folder=${encodeURIComponent("Inbox")}`);
    }
    return result;
  }, [archiveFolder, confirm, router]);

  // Ctrl/Cmd+N → nouvelle note. Marche uniquement en PWA standalone (en
  // onglet, Chrome verrouille Ctrl+N pour ouvrir une fenêtre — preventDefault
  // est ignoré). Ctrl+Alt+N est l'alternative jamais interceptée par le
  // navigateur ; on enregistre les deux pour couvrir les deux modes.
  useShortcuts([
    {
      id: "notes.index.create",
      keys: "mod+n",
      scope: "global",
      description: "Nouvelle note",
      handler: () => {
        void handleNewNote(null);
        return true;
      },
    },
    {
      id: "notes.index.create-alt",
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

  // Publish folder accent override to the shell so the entire app (sidebar,
  // topbar, right panel) tints when the user is browsing a colored folder —
  // not just the FileTree. Cleared on unmount / when no folder color matches.
  const folderColor = folderColorFromTree(selectedFolder, foldersLoading ? [] : folders);
  const { setAccentOverride } = useShellChrome();
  useEffect(() => {
    const vars = folderAccentVars(folderColor);
    setAccentOverride(vars ? (vars as unknown as Record<string, string>) : null);
    return () => setAccentOverride(null);
  }, [folderColor, setAccentOverride]);

  // Mobile chrome — title reflects the current pane (folder tree vs. note
  // list of a folder), FAB triggers "new note in current folder".
  const isMobile = useIsMobile();
  // On mobile we treat the URL `?folder=` as the navigation cursor: present
  // → user has drilled into a folder and sees the note list; absent → user
  // is at the folder tree. Desktop renders both columns regardless.
  const showNoteList = !isMobile || folderParam !== null;
  const showFileTree = !isMobile || folderParam === null;
  const mobileTitleText = isMobile
    ? folderParam
      ? folderName ?? "Notes"
      : "Notes"
    : null;
  const mobileSubtitleText = isMobile && folderParam
    ? `${notes.length} ${notes.length > 1 ? "notes" : "note"}`
    : null;
  useMobileTitle(mobileTitleText, mobileSubtitleText);
  const onFabPress = useCallback(() => {
    void handleNewNote(selectedFolderRef.current);
  }, [handleNewNote]);
  useMobileFab(
    isMobile ? { icon: Plus, label: "Nouvelle note", onPress: onFabPress } : null,
  );

  return (
    <div className="flex h-full overflow-hidden">
      {showFileTree && (
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
          // Counts must reflect "active" notes only — archived notes are
          // hidden from the per-folder view by default and the user reads
          // the (N) badge to plan where to write next, not to audit history.
          notes={allNotes.filter((n) => !n.archivedAt)}
        />
      )}

      {showNoteList && (
        <NoteList
          notes={notes}
          allNotes={allNotes}
          selectedNoteId={null}
          folderName={folderName}
          selectedFolder={selectedFolder}
          onSelectNote={handleSelectNote}
          isLoading={isLoading}
          isError={isError}
          errorMessage={errorMessage}
          isFallback={isFallback}
          onNewNote={handleNewNote}
          onRenameNote={handleRenameNote}
          onArchiveNote={handleArchiveNote}
          onRenameFolderInline={handleRenameFolderInline}
        />
      )}

      {/* Editor pane — desktop-only filler that invites the user to pick a
          note. On mobile the user is either browsing folders or the note
          list; tapping a note pushes /notes/:id which renders the editor
          full-screen on its own page. */}
      <div
        className="hidden flex-1 flex-col overflow-hidden md:flex"
        style={{ backgroundColor: "var(--surface-0)" }}
      >
        <EmptyEditor onNewNote={handleNewNote} />
      </div>
    </div>
  );
}

export default function NotesPage() {
  return (
    <AppShell>
      <Suspense fallback={<NotesPageSkeleton />}>
        <NotesPageContent />
      </Suspense>
    </AppShell>
  );
}

function NotesPageSkeleton() {
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
