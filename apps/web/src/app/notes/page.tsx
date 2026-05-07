"use client";

import { AppShell } from "@/components/shell";
import {
  EmptyEditor,
  FileTree,
  NoteList,
} from "@/components/notes";
import { useNoteList, useFolderTree, useCreateNote } from "@/components/notes/hooks";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";

function NotesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const folderParam = searchParams.get("folder");

  const [selectedFolder, setSelectedFolder] = useState<string | null>(
    folderParam ?? "Inbox",
  );

  const { notes, isLoading, isError, errorMessage, isFallback } = useNoteList(selectedFolder);
  const { folders, isLoading: foldersLoading } = useFolderTree();
  const { createNote } = useCreateNote();

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
    router.push(`/notes/${id}`);
  }, [router]);

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
        selectedNoteId={null}
        folderName={folderName}
        onSelectNote={handleSelectNote}
        isLoading={isLoading}
        isError={isError}
        errorMessage={errorMessage}
        isFallback={isFallback}
        onNewNote={handleNewNote}
      />

      <div
        className="flex flex-1 flex-col overflow-hidden"
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
