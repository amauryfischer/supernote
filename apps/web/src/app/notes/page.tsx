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
  useCreateDriveDoc,
  useCreateFolder,
  useDeleteFolder,
  useRenameFolder,
  useRenameNote,
  useArchiveNote,
  useArchiveFolder,
  useMoveNote,
  useDeleteNote,
} from "@/components/notes/hooks";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useConfirm, usePrompt } from "@/hooks/usePrompt";
import { useToast } from "@supernote/ui";
import { folderAccentVars, folderColorFromTree } from "@/lib/folderAccent";
import {
  useMobileFab,
  useMobileTitle,
  useShellChrome,
} from "@/components/shell/shell-chrome-context";
import { useShortcuts } from "@/lib/keyboard";
import { useIsMobile } from "@/hooks/useIsMobile";
import { Plus } from "@phosphor-icons/react";
import { useSettings } from "@/components/settings/SettingsContext";
import { type GoogleDocKind, GOOGLE_DOC_KINDS } from "@/lib/google-drive";
import { NewItemSheet } from "@/components/notes/NewItemSheet";
import { useCreateDraft } from "@/components/notes/useCreateDraft";
import { useGmailConnected } from "@/hooks/useGmailConnected";

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
  const { createDriveDoc } = useCreateDriveDoc();
  const { createFolder } = useCreateFolder();
  const { renameFolder } = useRenameFolder();
  const { deleteFolder } = useDeleteFolder();
  const { renameNote } = useRenameNote();
  const { setArchived } = useArchiveNote();
  const { archiveFolder } = useArchiveFolder();
  const { moveNote } = useMoveNote();
  const { deleteNote } = useDeleteNote();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const { toast } = useToast();
  const { settings } = useSettings();
  // « Drive connecté » = clientId configuré ET un compte lié. C'est la condition
  // pour proposer la création de Doc/Sheet/Slides (sinon `createDriveFile`
  // échouerait faute de token). Sert aussi de gate UI : on ne passe
  // `onNewDriveDoc` aux surfaces de création que dans ce cas.
  const driveConnected =
    !!settings.googleDrive?.connectedEmail && !!settings.googleDrive?.clientId?.trim();
  const [newSheetOpen, setNewSheetOpen] = useState(false);
  const { createDraft } = useCreateDraft();
  const gmailConnected = useGmailConnected();

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
      console.error("[handleNewNote] createNote failed", err);
      toast({ title: "Impossible de créer la note", variant: "danger" });
    }
  }, [createNote, router, toast]);

  const handleNewDriveDoc = useCallback(
    async (kind: GoogleDocKind, parentPath?: string | null) => {
      const safeParent = typeof parentPath === "string" ? parentPath : null;
      const folder = safeParent ?? selectedFolderRef.current ?? "Inbox";
      const meta = GOOGLE_DOC_KINDS[kind];
      const raw = await prompt(`Nom — ${meta.label}`, {
        placeholder: meta.defaultName,
        defaultValue: meta.defaultName,
      });
      if (raw === null) return; // annulé
      const name = raw.trim() || meta.defaultName;
      try {
        const { url, placedInFolder } = await createDriveDoc({ kind, folder, name });
        // Pas de fichier local écrit : on ouvre le Doc tout de suite ; il
        // apparaîtra dans le dossier de l'app après la synchro Google Drive
        // Desktop (le `.gdoc` est créé par Drive, pas par nous → pas de blocage
        // Chrome sur l'écriture des extensions Google).
        if (typeof window !== "undefined") window.open(url, "_blank", "noopener");
        toast({
          title: `${meta.label} créé dans Drive`,
          description: placedInFolder
            ? "Il apparaîtra dans ce dossier après la synchro Google Drive."
            : "Créé à la racine My Drive (dossier racine Drive non configuré ou sous-dossier introuvable).",
        });
      } catch (err) {
        console.error("[handleNewDriveDoc] failed", err);
        toast({ title: `Impossible de créer le ${meta.label}`, variant: "danger" });
      }
    },
    [createDriveDoc, prompt, toast],
  );

  const handleNewDraft = useCallback(async () => {
    try {
      const { url } = await createDraft({ subject: "", body: "" });
      if (typeof window !== "undefined") window.open(url, "_blank", "noopener");
      toast({ title: "Brouillon Gmail créé" });
    } catch (err) {
      toast({ title: "Échec du brouillon", description: err instanceof Error ? err.message : String(err), variant: "danger" });
    }
  }, [createDraft, toast]);

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
      toast({ title: "Impossible de renommer le dossier", variant: "danger" });
    }
  }, [prompt, renameFolder, router, toast]);

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
    try {
      await renameFolder(oldPath, newPath);
      if (selectedFolderRef.current === oldPath || selectedFolderRef.current?.startsWith(`${oldPath}/`)) {
        const nextSelected = newPath + (selectedFolderRef.current!.slice(oldPath.length));
        setSelectedFolder(nextSelected);
        selectedFolderRef.current = nextSelected;
        router.push(`/notes?folder=${encodeURIComponent(nextSelected)}`);
      }
    } catch (err) {
      console.error("[handleRenameFolderInline] failed", err);
      toast({ title: "Impossible de renommer le dossier", variant: "danger" });
    }
  }, [renameFolder, router, toast]);

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
      toast({ title: "Impossible de supprimer le dossier", variant: "danger" });
    }
  }, [confirm, deleteFolder, router, toast]);

  const handleRenameNote = useCallback(async (id: string, newTitle: string): Promise<void> => {
    await renameNote(id, newTitle);
  }, [renameNote]);

  const handleArchiveNote = useCallback(async (id: string, archived: boolean): Promise<void> => {
    await setArchived(id, archived);
  }, [setArchived]);

  const handleDeleteNote = useCallback(async (id: string): Promise<void> => {
    const note = notes.find((n) => n.id === id);
    const ok = await confirm({
      title: note ? `Supprimer "${note.title}" ?` : "Supprimer la note ?",
      description:
        "La note sera déplacée dans la corbeille. Vous pourrez la restaurer depuis la corbeille.",
      confirmLabel: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteNote(id);
    } catch (err) {
      console.error("[handleDeleteNote] failed", err);
      toast({ title: "Impossible de supprimer la note", variant: "danger" });
    }
  }, [notes, confirm, deleteNote, toast]);

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

  const handleMoveNote = useCallback(async (noteId: string, folderPath: string): Promise<void> => {
    try {
      await moveNote(noteId, folderPath);
      const leaf = folderPath.split("/").pop() ?? folderPath;
      toast({ title: `Note déplacée dans « ${leaf} »` });
    } catch {
      toast({ title: "Impossible de déplacer la note", variant: "danger" });
    }
  }, [moveNote, toast]);

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
    // Drive connecté → laisser l'utilisateur choisir Note / Doc / Sheet / Slides.
    // Sinon, raccourci direct vers une nouvelle note (comportement historique).
    if (driveConnected) {
      setNewSheetOpen(true);
      return;
    }
    // Promesse renvoyée (et non jetée) : le FAB s'en sert pour afficher son
    // état d'attente pendant la création.
    return handleNewNote(selectedFolderRef.current);
  }, [driveConnected, handleNewNote]);
  useMobileFab(
    isMobile
      ? {
          icon: Plus,
          label: driveConnected ? "Créer" : "Nouvelle note",
          onPress: onFabPress,
        }
      : null,
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
          onNewDriveDoc={driveConnected ? handleNewDriveDoc : undefined}
          onRenameFolder={handleRenameFolder}
          onRenameFolderInline={handleRenameFolderInline}
          onDeleteFolder={handleDeleteFolder}
          onArchiveFolder={handleArchiveFolder}
          // Counts must reflect "active" notes only — archived notes are
          // hidden from the per-folder view by default and the user reads
          // the (N) badge to plan where to write next, not to audit history.
          notes={allNotes.filter((n) => !n.archivedAt)}
          selectedNoteId={null}
          onSelectNote={handleSelectNote}
          onRenameNote={handleRenameNote}
          onDeleteNote={handleDeleteNote}
          onArchiveNote={handleArchiveNote}
          onDropNote={handleMoveNote}
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
          onDeleteNote={handleDeleteNote}
          onRenameNote={handleRenameNote}
          onArchiveNote={handleArchiveNote}
          onRenameFolderInline={handleRenameFolderInline}
          onDragNote={() => {}}
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
        <EmptyEditor
          onNewNote={handleNewNote}
          onNewDriveDoc={driveConnected ? handleNewDriveDoc : undefined}
        />
      </div>

      {/* Sélecteur de création mobile (FAB → Note / Doc / Sheet / Slides). Monté
          inconditionnellement ; n'est ouvert que quand Drive est connecté. */}
      <NewItemSheet
        isOpen={newSheetOpen}
        onOpenChange={setNewSheetOpen}
        onNewNote={() => void handleNewNote(selectedFolderRef.current)}
        onNewDriveDoc={(kind) => void handleNewDriveDoc(kind, selectedFolderRef.current)}
        onNewDraft={gmailConnected ? () => void handleNewDraft() : undefined}
      />
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
