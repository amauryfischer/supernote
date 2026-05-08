"use client";

/**
 * Custom hooks bridging tRPC procedures to local Note/Folder types.
 * Falls back to fixture data when no PWA backend is available (SSR, or
 * browser without File System Access API).
 */

import { useCallback, useEffect, useState } from "react";
import { trpc, isBrowserPwaMode } from "@/lib/trpc/client";
import { isWorkerReady } from "@/lib/trpc/browser-link";
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

// ── Backend availability detection ────────────────────────────────────────────
// True when the PWA vault Web Worker is available (Chromium-based browsers
// with File System Access API). Safari/Firefox without FSA → false.

function useHasBackend(): boolean {
  return isBrowserPwaMode();
}

/**
 * Subscribe to the `supernote:vault-ready` window event so any hook that
 * reads worker-backed data can re-enable its query the moment the vault
 * is ready. Without this, queries that fired before the worker booted
 * would settle in an `error: "Vault not initialized"` state forever
 * (TanStack Query has retry: false here) — surfacing as a permanent
 * "Vault not initialized" panel even though the worker is up.
 */
function useWorkerReady(): boolean {
  const [ready, setReady] = useState<boolean>(() =>
    typeof window === "undefined" ? false : isWorkerReady(),
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isWorkerReady()) setReady(true);
    const onReady = () => setReady(true);
    window.addEventListener("supernote:vault-ready", onReady);
    return () => window.removeEventListener("supernote:vault-ready", onReady);
  }, []);
  return ready;
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
  const hasBackend = useHasBackend();
  const workerReady = useWorkerReady();

  // Bumped staleTime to keep the cached list visible across quick
  // route changes (/notes → /contacts → /notes) without an empty-flash.
  // Gate on workerReady so we never fire a query that would be rejected
  // with "Vault not initialized" and stick as an error (retry: false).
  const query = trpc.entities.list.useQuery(
    { typeId: "note", limit: 500, offset: 0 },
    { enabled: hasBackend && workerReady, staleTime: 5 * 60_000 },
  );

  if (!hasBackend) {
    const notes = folderPath ? getNotesForFolder(folderPath) : NOTES; // NOTES is [] by default
    return { notes, isLoading: false, isError: false, errorMessage: null, isFallback: true };
  }

  // Worker still booting → show skeleton, never an error. The query is
  // disabled until VAULT_READY arrives; the listener in useWorkerReady
  // flips `workerReady` and the query starts fetching.
  if (!workerReady) {
    return { notes: [], isLoading: true, isError: false, errorMessage: null, isFallback: false };
  }

  // Prefer cached data — surface the list immediately even if a background
  // refetch is in-flight. Without this, the list briefly blanks on remount.
  if (query.data) {
    const allNotes = query.data.items.map(entitySummaryToNote);
    // Recursive scope: when a folder is selected, include notes whose
    // folderPath matches exactly OR is nested under it (descendants). The
    // middle pane then shows everything inside the folder subtree, grouped
    // per sub-folder by NoteList.
    const notes = folderPath
      ? allNotes.filter(
          (n) => n.folderPath === folderPath || n.folderPath.startsWith(`${folderPath}/`),
        )
      : allNotes;
    return { notes, isLoading: false, isError: false, errorMessage: null, isFallback: false };
  }

  if (query.isLoading || query.isFetching) {
    return { notes: [], isLoading: true, isError: false, errorMessage: null, isFallback: false };
  }

  if (query.isError) {
    return {
      notes: [],
      isLoading: false,
      isError: true,
      errorMessage: query.error?.message ?? "Erreur de chargement",
      isFallback: false,
    };
  }

  return { notes: [], isLoading: false, isError: false, errorMessage: null, isFallback: false };
}

// ── useFolderTree ─────────────────────────────────────────────────────────────

export interface UseFolderTreeResult {
  folders: Folder[];
  isLoading: boolean;
  isFallback: boolean;
}

export function useFolderTree(): UseFolderTreeResult {
  const hasBackend = useHasBackend();
  const workerReady = useWorkerReady();

  // Folders are now persisted in the vault `setting` table. The server-side
  // procedure unions explicit paths with paths derived from existing notes
  // so we don't need to query entities here.
  // Bumped staleTime so re-mounting `/notes` after a quick navigation away
  // (→ /contacts → /notes) does not trigger a refetch that briefly blanks
  // the folder tree before TanStack delivers the fresh data.
  const query = trpc.vault.folders.list.useQuery(undefined, {
    enabled: hasBackend && workerReady,
    staleTime: 5 * 60_000,
  });

  if (!hasBackend) {
    return { folders: FOLDERS, isLoading: false, isFallback: true }; // FOLDERS is [] by default
  }

  // Worker still booting — return loading so we don't show an empty tree
  // (which the user would interpret as "my folders are gone"). The query
  // re-enables on `supernote:vault-ready`.
  if (!workerReady) {
    return { folders: [], isLoading: true, isFallback: false };
  }

  // Show cached data even while a background refetch is in-flight.
  if (query.data) {
    const entries = query.data.length > 0 ? query.data : [{ path: "Inbox" }];
    const folders = foldersFromPaths(entries);
    return { folders, isLoading: false, isFallback: false };
  }

  if (query.isLoading || query.isFetching) {
    return { folders: [], isLoading: true, isFallback: false };
  }

  // hasBackend && no data && not loading — query disabled or errored.
  // Fall back to a single virtual "Inbox" so the UI is never empty.
  return {
    folders: foldersFromPaths([{ path: "Inbox" }]),
    isLoading: false,
    isFallback: false,
  };
}

// ── useCreateFolder ───────────────────────────────────────────────────────────

export function useCreateFolder() {
  const utils = trpc.useUtils();
  const mutation = trpc.vault.folders.add.useMutation({
    onSuccess: () => {
      void utils.vault.folders.list.invalidate();
    },
  });

  const createFolder = useCallback(
    async (path: string): Promise<void> => {
      await mutation.mutateAsync({ path });
      // Force refetch BEFORE we return so the caller can navigate / re-render
      // with the new folder already present in cache. Otherwise the redirect
      // races the (debounced) invalidate and the tree appears empty for a
      // few hundred ms.
      await utils.vault.folders.list.refetch();
    },
    [mutation, utils],
  );

  return { createFolder, isPending: mutation.isPending };
}

// ── useRenameFolder ───────────────────────────────────────────────────────────

export function useRenameFolder() {
  const utils = trpc.useUtils();
  const mutation = trpc.vault.folders.rename.useMutation({
    onSuccess: () => {
      void utils.vault.folders.list.invalidate();
      void utils.entities.list.invalidate();
    },
  });

  const renameFolder = useCallback(
    async (oldPath: string, newPath: string): Promise<void> => {
      await mutation.mutateAsync({ oldPath, newPath });
      // Refetch BEFORE returning so callers (which may navigate to the new
      // path) see fresh data immediately, mirroring the pattern in
      // useCreateFolder above.
      await utils.vault.folders.list.refetch();
      await utils.entities.list.refetch({ typeId: "note", limit: 500, offset: 0 });
    },
    [mutation, utils],
  );

  return { renameFolder, isPending: mutation.isPending };
}

// ── useDeleteFolder ───────────────────────────────────────────────────────────

/**
 * Delete a folder and every note nested under it. The cascade lives in the
 * worker (`vault.folders.delete`) — a single trip that drops the .md files,
 * DB rows, search-index entries and the on-disk directory. We just refresh
 * the two query caches the UI reads from.
 */
export function useDeleteFolder() {
  const utils = trpc.useUtils();
  const mutation = trpc.vault.folders.delete.useMutation({
    onSuccess: () => {
      void utils.vault.folders.list.invalidate();
      void utils.entities.list.invalidate();
    },
  });

  const deleteFolder = useCallback(
    async (path: string): Promise<void> => {
      await mutation.mutateAsync({ path });
      await utils.vault.folders.list.refetch();
      await utils.entities.list.refetch({ typeId: "note", limit: 500, offset: 0 });
    },
    [mutation, utils],
  );

  return { deleteFolder, isPending: mutation.isPending };
}

// ── useUpdateFolder ───────────────────────────────────────────────────────────

/**
 * Patch the per-folder presentation metadata (color and/or icon).
 *
 * `null` clears the field; `undefined` leaves it untouched. The mutation
 * returns immediately after the worker has persisted the new value AND we
 * have refetched `vault.folders.list` so the FileTree picks up the change
 * on the very next render — no flash of the old color/icon.
 */
export interface UpdateFolderPatch {
  color?: string | null;
  icon?: string | null;
}

export function useUpdateFolder() {
  const utils = trpc.useUtils();
  const mutation = trpc.vault.folders.update.useMutation({
    onSuccess: () => {
      void utils.vault.folders.list.invalidate();
    },
  });

  const updateFolder = useCallback(
    async (path: string, patch: UpdateFolderPatch): Promise<void> => {
      await mutation.mutateAsync({ path, ...patch });
      // Force-refetch BEFORE returning so callers can dismiss the picker
      // without observing a render of the old value, mirroring the pattern
      // in the create/rename hooks above.
      await utils.vault.folders.list.refetch();
    },
    [mutation, utils],
  );

  return { updateFolder, isPending: mutation.isPending };
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
  const hasBackend = useHasBackend();
  const workerReady = useWorkerReady();

  const query = trpc.entities.get.useQuery(
    { id },
    { enabled: hasBackend && workerReady && !!id },
  );

  if (!hasBackend) {
    const note = getNoteById(id) ?? null;
    return { note, isLoading: false, isError: false, errorMessage: null, isFallback: true };
  }

  // Worker still booting — show a loading state instead of an error so we
  // don't render "Note introuvable" until the vault is actually up.
  if (!workerReady) {
    return { note: null, isLoading: true, isError: false, errorMessage: null, isFallback: false };
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
  const utils = trpc.useUtils();
  const mutation = trpc.entities.create.useMutation({
    onSuccess: () => {
      // Invalidate ALL entities.list queries (any args). Without args, tRPC
      // matches every cached query whose path starts with this prefix.
      void utils.entities.list.invalidate();
      // Folder list is derived from entity filePaths, so a new note in a
      // brand-new folder may have to surface there too.
      void utils.vault.folders.list.invalidate();
    },
  });

  const createNote = useCallback(
    async (opts: CreateNoteOptions): Promise<string> => {
      // Routes through the vault Web Worker via tRPC. The browser-link queues
      // requests until VAULT_READY, so this resolves once the worker is up
      // even if the user clicked before init completed. We intentionally do
      // NOT fall back to localStore here: the previous fallback created a
      // ghost entity that vanished on the very next page load.
      const filePath = noteFilePath(opts.folder, opts.title);
      const entity = await mutation.mutateAsync({
        typeId: "note",
        fields: { title: opts.title, filePath },
        body: "",
        tags: [],
      });
      // Force-refetch the exact list query the UI subscribes to BEFORE we
      // return, so the caller can navigate / re-render with fresh data
      // already in cache. `invalidate()` alone schedules a refetch but does
      // not wait — the redirect would race the refetch and the destination
      // page would still render an empty list.
      await utils.entities.list.refetch({ typeId: "note", limit: 500, offset: 0 });
      return entity.id;
    },
    [mutation, utils],
  );

  return { createNote, isPending: mutation.isPending };
}

// ── useUpdateNote ─────────────────────────────────────────────────────────────

export function useUpdateNote() {
  const hasBackend = useHasBackend();
  const utils = trpc.useUtils();
  const mutation = trpc.entities.update.useMutation({
    onSuccess: (data) => {
      void utils.entities.get.invalidate({ id: data.id });
      void utils.entities.list.invalidate();
    },
  });

  const updateNote = useCallback(
    async (id: string, title: string, body: string): Promise<void> => {
      if (!hasBackend) return;
      await mutation.mutateAsync({
        id,
        fields: { title },
        body,
      });
    },
    [hasBackend, mutation],
  );

  return { updateNote, isPending: mutation.isPending };
}

// ── useDeleteNote ─────────────────────────────────────────────────────────────

export function useDeleteNote() {
  const hasBackend = useHasBackend();
  const utils = trpc.useUtils();
  const mutation = trpc.entities.delete.useMutation({
    onSuccess: () => {
      void utils.entities.list.invalidate();
    },
  });

  const deleteNote = useCallback(
    async (id: string): Promise<void> => {
      if (!hasBackend) return;
      await mutation.mutateAsync({ id, moveToTrash: true });
    },
    [hasBackend, mutation],
  );

  return { deleteNote, isPending: mutation.isPending };
}
