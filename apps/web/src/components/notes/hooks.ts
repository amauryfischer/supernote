"use client";

/**
 * Custom hooks bridging tRPC procedures to local Note/Folder types.
 * Falls back to fixture data when window.__supernoteIPC is absent.
 */

import { useCallback } from "react";
import { trpc } from "@/lib/trpc/client";
import {
  NOTES,
  FOLDERS,
  type Note,
  type Folder,
  getNotesForFolder,
  getNoteById,
} from "./fixtures";
import {
  entitySummaryToNote,
  entityToNote,
  foldersFromPaths,
  noteFilePath,
} from "./adapters";

// ── Degraded mode detection ───────────────────────────────────────────────────

export function useIsElectron(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.__supernoteIPC;
}

// ── useNoteList ───────────────────────────────────────────────────────────────

export interface UseNoteListResult {
  notes: Note[];
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  isFallback: boolean;
}

export function useNoteList(folderPath: string | null): UseNoteListResult {
  const isElectron = useIsElectron();

  const query = trpc.entities.list.useQuery(
    { typeId: "note", limit: 500, offset: 0 },
    { enabled: isElectron },
  );

  if (!isElectron) {
    const notes = folderPath ? getNotesForFolder(folderPath) : NOTES;
    return { notes, isLoading: false, isError: false, errorMessage: null, isFallback: true };
  }

  if (query.isLoading) {
    return { notes: [], isLoading: true, isError: false, errorMessage: null, isFallback: false };
  }

  if (query.isError || !query.data) {
    return {
      notes: [],
      isLoading: false,
      isError: true,
      errorMessage: query.error?.message ?? "Erreur de chargement",
      isFallback: false,
    };
  }

  const allNotes = query.data.items.map(entitySummaryToNote);
  const notes = folderPath ? allNotes.filter((n) => n.folderPath === folderPath) : allNotes;
  return { notes, isLoading: false, isError: false, errorMessage: null, isFallback: false };
}

// ── useFolderTree ─────────────────────────────────────────────────────────────

export interface UseFolderTreeResult {
  folders: Folder[];
  isLoading: boolean;
  isFallback: boolean;
}

export function useFolderTree(): UseFolderTreeResult {
  const isElectron = useIsElectron();

  const query = trpc.entities.list.useQuery(
    { typeId: "note", limit: 500, offset: 0 },
    { enabled: isElectron },
  );

  if (!isElectron) {
    return { folders: FOLDERS, isLoading: false, isFallback: true };
  }

  if (query.isLoading) {
    return { folders: [], isLoading: true, isFallback: false };
  }

  if (!query.data) {
    return { folders: FOLDERS, isLoading: false, isFallback: true };
  }

  const folderPaths = Array.from(
    new Set(query.data.items.map((e) => {
      const parts = e.filePath.split("/");
      return parts.length > 1 ? parts.slice(0, -1).join("/") : "Inbox";
    })),
  );

  const folders = foldersFromPaths(folderPaths.length > 0 ? folderPaths : ["Inbox"]);
  return { folders, isLoading: false, isFallback: false };
}

// ── useNote ───────────────────────────────────────────────────────────────────

export interface UseNoteResult {
  note: Note | null;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  isFallback: boolean;
}

export function useNote(id: string): UseNoteResult {
  const isElectron = useIsElectron();

  const query = trpc.entities.get.useQuery(
    { id },
    { enabled: isElectron && !!id },
  );

  if (!isElectron) {
    const note = getNoteById(id) ?? null;
    return { note, isLoading: false, isError: false, errorMessage: null, isFallback: true };
  }

  if (query.isLoading) {
    return { note: null, isLoading: true, isError: false, errorMessage: null, isFallback: false };
  }

  if (query.isError || !query.data) {
    return {
      note: null,
      isLoading: false,
      isError: true,
      errorMessage: query.error?.message ?? "Note introuvable",
      isFallback: false,
    };
  }

  return {
    note: entityToNote(query.data),
    isLoading: false,
    isError: false,
    errorMessage: null,
    isFallback: false,
  };
}

// ── useCreateNote ─────────────────────────────────────────────────────────────

export interface CreateNoteOptions {
  folder: string;
  title: string;
}

export function useCreateNote() {
  const isElectron = useIsElectron();
  const utils = trpc.useUtils();
  const mutation = trpc.entities.create.useMutation({
    onSuccess: () => {
      void utils.entities.list.invalidate();
    },
  });

  const createNote = useCallback(
    async (opts: CreateNoteOptions): Promise<string> => {
      if (!isElectron) {
        // Fallback: return a local temp id
        return `new-${Date.now()}`;
      }
      const filePath = noteFilePath(opts.folder, opts.title);
      const entity = await mutation.mutateAsync({
        typeId: "note",
        // filePath embedded in fields so the desktop handler can pick it up
        fields: { title: opts.title, filePath },
        body: "",
        tags: [],
      });
      return entity.id;
    },
    [isElectron, mutation],
  );

  return { createNote, isPending: mutation.isPending };
}

// ── useUpdateNote ─────────────────────────────────────────────────────────────

export function useUpdateNote() {
  const isElectron = useIsElectron();
  const utils = trpc.useUtils();
  const mutation = trpc.entities.update.useMutation({
    onSuccess: (data) => {
      void utils.entities.get.invalidate({ id: data.id });
      void utils.entities.list.invalidate();
    },
  });

  const updateNote = useCallback(
    async (id: string, title: string, body: string): Promise<void> => {
      if (!isElectron) return;
      await mutation.mutateAsync({
        id,
        fields: { title },
        body,
      });
    },
    [isElectron, mutation],
  );

  return { updateNote, isPending: mutation.isPending };
}

// ── useDeleteNote ─────────────────────────────────────────────────────────────

export function useDeleteNote() {
  const isElectron = useIsElectron();
  const utils = trpc.useUtils();
  const mutation = trpc.entities.delete.useMutation({
    onSuccess: () => {
      void utils.entities.list.invalidate();
    },
  });

  const deleteNote = useCallback(
    async (id: string): Promise<void> => {
      if (!isElectron) return;
      await mutation.mutateAsync({ id, moveToTrash: true });
    },
    [isElectron, mutation],
  );

  return { deleteNote, isPending: mutation.isPending };
}
