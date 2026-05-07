"use client";

import { AppShell } from "@/components/shell";
import {
  EmptyEditor,
  FileTree,
  FOLDERS,
  NOTES,
  NoteEditor,
  NoteList,
  getNoteById,
  getNotesForFolder,
} from "@/components/notes";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useState } from "react";

function NoteDetailContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const folderParam = searchParams.get("folder");

  const note = getNoteById(params.id);
  const defaultFolder = note?.folderPath ?? "Inbox";

  const [selectedFolder, setSelectedFolder] = useState<string | null>(
    folderParam ?? defaultFolder,
  );
  const [allNotes, setAllNotes] = useState(NOTES);

  const notes = selectedFolder ? getNotesForFolder(selectedFolder) : allNotes;

  const handleSelectFolder = useCallback((path: string) => {
    setSelectedFolder(path);
    router.push(`/notes?folder=${encodeURIComponent(path)}`);
  }, [router]);

  const handleNewNote = useCallback(() => {
    const folder = selectedFolder ?? "Inbox";
    const newNote = {
      id: `new-${Date.now()}`,
      title: "Nouvelle note",
      body: "",
      folderPath: folder,
      updatedAt: new Date().toISOString(),
      tags: [],
    };
    setAllNotes((prev) => [newNote, ...prev]);
    router.push(`/notes/${newNote.id}`);
  }, [selectedFolder, router]);

  const handleNewFolder = useCallback(() => {
    // Placeholder — real implementation via tRPC later
  }, []);

  const handleSelectNote = useCallback((id: string) => {
    const target = allNotes.find((n) => n.id === id);
    const q = target?.folderPath
      ? `?folder=${encodeURIComponent(target.folderPath)}`
      : "";
    router.push(`/notes/${id}${q}`);
  }, [allNotes, router]);

  const folderName = selectedFolder
    ? selectedFolder.split("/").pop() ?? selectedFolder
    : null;

  return (
    <div className="flex h-full overflow-hidden">
      <FileTree
        folders={FOLDERS}
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
      />

      <div
        className="flex flex-1 flex-col overflow-hidden"
        style={{ backgroundColor: "var(--surface-0)" }}
      >
        {note ? (
          <NoteEditor note={note} />
        ) : (
          <EmptyEditor onNewNote={handleNewNote} />
        )}
      </div>
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
