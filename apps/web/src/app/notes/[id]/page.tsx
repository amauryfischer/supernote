"use client";

import { AppShell } from "@/components/shell";
import {
  EmptyEditor,
  FileTree,
  NoteEditor,
  NoteList,
} from "@/components/notes";
import {
  useNote,
  useNoteList,
  useFolderTree,
  useCreateNote,
  useDeleteNote,
} from "@/components/notes/hooks";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";
import { DeleteNoteModal } from "@/components/notes/DeleteNoteModal";

function NoteDetailContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const folderParam = searchParams.get("folder");

  const { note, isLoading: noteLoading } = useNote(params.id);

  const defaultFolder = note?.folderPath ?? folderParam ?? "Inbox";
  const [selectedFolder, setSelectedFolder] = useState<string | null>(
    folderParam ?? defaultFolder,
  );
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { notes, isLoading, isError, errorMessage, isFallback } = useNoteList(selectedFolder);
  const { folders, isLoading: foldersLoading } = useFolderTree();
  const { createNote } = useCreateNote();
  const { deleteNote, isPending: isDeleting } = useDeleteNote();

  const handleSelectFolder = useCallback((path: string) => {
    setSelectedFolder(path);
    router.push(`/notes?folder=${encodeURIComponent(path)}`);
  }, [router]);

  const handleNewNote = useCallback(async () => {
    const folder = selectedFolder ?? "Inbox";
    const id = await createNote({ folder, title: "Nouvelle note" });
    router.push(`/notes/${id}`);
  }, [selectedFolder, createNote, router]);

  const handleNewFolder = useCallback(() => {
    // Placeholder — real implementation via tRPC later
  }, []);

  const handleSelectNote = useCallback((id: string) => {
    const target = notes.find((n) => n.id === id);
    const q = target?.folderPath
      ? `?folder=${encodeURIComponent(target.folderPath)}`
      : "";
    router.push(`/notes/${id}${q}`);
  }, [notes, router]);

  const handleDeleteRequest = useCallback((id: string) => {
    setDeleteTarget(id);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    await deleteNote(deleteTarget);
    setDeleteTarget(null);
    router.push("/notes");
  }, [deleteTarget, deleteNote, router]);

  const folderName = selectedFolder
    ? selectedFolder.split("/").pop() ?? selectedFolder
    : null;

  return (
    <div className="flex h-full overflow-hidden">
      <FileTree
        folders={foldersLoading ? [] : folders}
        selectedFolder={selectedFolder}
        onSelectFolder={handleSelectFolder}
        onNewFolder={handleNewFolder}
        onNewNote={handleNewNote}
      />

      <NoteList
        notes={notes}
        selectedNoteId={params.id}
        folderName={folderName}
        onSelectNote={handleSelectNote}
        isLoading={isLoading}
        isError={isError}
        errorMessage={errorMessage}
        isFallback={isFallback}
        onNewNote={handleNewNote}
        onDeleteNote={handleDeleteRequest}
      />

      <div
        className="flex flex-1 flex-col overflow-hidden"
        style={{ backgroundColor: "var(--surface-0)" }}
      >
        {noteLoading ? (
          <NoteLoadingSkeleton />
        ) : note ? (
          <NoteEditor note={note} />
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

interface NoteDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function NoteDetailPage(_props: NoteDetailPageProps) {
  return (
    <AppShell>
      <Suspense fallback={<NoteDetailSkeleton />}>
        <NoteDetailContent />
      </Suspense>
    </AppShell>
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
