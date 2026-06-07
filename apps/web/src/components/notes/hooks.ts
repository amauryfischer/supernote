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
import { isSystemFolder } from "@/lib/system-folders";
import type { FieldValue } from "@supernote/ipc";

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
    // Flip back to false the moment the worker is torn down (vault switch)
    // so dependent queries become `enabled: false` and stop returning the
    // previous vault's cached payload while the new worker boots.
    const onUnready = () => setReady(false);
    window.addEventListener("supernote:vault-ready", onReady);
    window.addEventListener("supernote:vault-unready", onUnready);
    return () => {
      window.removeEventListener("supernote:vault-ready", onReady);
      window.removeEventListener("supernote:vault-unready", onUnready);
    };
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
    // Strip system folders (Contacts, Todos, Finance, …) — they're managed
    // by their own pages and showing them in /notes lets the user wipe out
    // their typed entities by deleting what looks like a stray folder.
    const visible = query.data.filter((e) => !isSystemFolder(e.path));
    // Inbox is conceptually distinct from user folders — always render it,
    // even when empty, so the user can drop notes into it without first
    // creating the folder.
    const hasInbox = visible.some((e) => e.path === "Inbox");
    const entries = hasInbox ? visible : [{ path: "Inbox" }, ...visible];
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
  sortOrder?: number | null;
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

  // `placeholderData: (prev) => prev` keeps the previous Entity visible
  // during a refetch (after `useUpdateNote.onSuccess` invalidates the cache,
  // or when a tag mutation does the same). Without it, `query.data` flickers
  // through `undefined` between invalidate and fresh data, and the parent
  // page renders <EmptyEditor> for a frame — which unmounts NoteEditor
  // entirely, dropping the user's title input state and the BlockNote
  // instance the moment they save.
  const query = trpc.entities.get.useQuery(
    { id },
    {
      enabled: hasBackend && workerReady && !!id,
      placeholderData: (prev) => prev,
    },
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
      // Optimistic insert: patch the created entity straight into the list
      // cache so the caller can navigate immediately with the note already
      // visible — no 500-row refetch on the critical path (it previously
      // added a visible pause between the click and the editor opening).
      // The created Entity is a superset of the EntitySummary the list
      // stores; the background invalidate reconciles authoritatively.
      utils.entities.list.setData(
        { typeId: "note", limit: 500, offset: 0 },
        (old) =>
          old ? { ...old, items: [entity, ...old.items] } : old,
      );
      void utils.entities.list.invalidate();
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

// ── useRenameNote ─────────────────────────────────────────────────────────────

/**
 * Rename a note by updating only `fields.title`.
 * Deliberately does NOT touch `body` so the editor's in-progress draft is safe.
 */
export function useRenameNote() {
  const hasBackend = useHasBackend();
  const utils = trpc.useUtils();
  const mutation = trpc.entities.update.useMutation({
    onSuccess: (data) => {
      void utils.entities.get.invalidate({ id: data.id });
      void utils.entities.list.invalidate();
    },
  });

  const renameNote = useCallback(
    async (id: string, newTitle: string): Promise<void> => {
      if (!hasBackend) return;
      await mutation.mutateAsync({ id, fields: { title: newTitle } });
    },
    [hasBackend, mutation],
  );

  return { renameNote, isPending: mutation.isPending };
}

// ── useMoveNote ───────────────────────────────────────────────────────────────

export function useMoveNote() {
  const hasBackend = useHasBackend();
  const utils = trpc.useUtils();
  const mutation = trpc.entities.update.useMutation({
    onSuccess: (data) => {
      void utils.entities.get.invalidate({ id: data.id });
      void utils.entities.list.invalidate();
    },
  });

  const moveNote = useCallback(
    async (id: string, targetFolderPath: string): Promise<void> => {
      if (!hasBackend) return;
      let cached = utils.entities.get.getData({ id });
      if (!cached) cached = await utils.entities.get.fetch({ id });
      const currentPath = cached?.filePath ?? null;
      if (!currentPath) return;
      if (currentPath.startsWith(`${targetFolderPath}/`) &&
          !currentPath.slice(targetFolderPath.length + 1).includes("/")) return;

      const filename = currentPath.split("/").pop()!;
      const base = filename.replace(/\.md$/, "");
      const all = utils.entities.list.getData({ typeId: "note", limit: 500, offset: 0 });

      // Find a non-colliding destination path.
      let nextFilePath = `${targetFolderPath}/${filename}`;
      if (nextFilePath !== currentPath) {
        let counter = 0;
        while (all?.items.some((e) => e.filePath === nextFilePath && e.id !== id)) {
          counter++;
          nextFilePath = `${targetFolderPath}/${base}-${counter}.md`;
        }
      }

      if (nextFilePath === currentPath) return;
      await mutation.mutateAsync({ id, filePath: nextFilePath });
    },
    [hasBackend, mutation, utils],
  );

  return { moveNote, isPending: mutation.isPending };
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

// ── useArchiveNote / useArchiveFolder ─────────────────────────────────────────

/** Filesystem-safe ISO stamp: 2026-05-10T10-30-45-123Z. Colons are technically
 *  legal on the OPFS layer Chromium ships today, but a few legacy adapters
 *  (and the user's eventual one-day local backup script) reject them. Cheap
 *  insurance against a foot-gun we don't have to debug later. */
function safeStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Strip path-hostile characters from a folder leaf so it can land inside an
 *  `_archive/...` bucket name without exploding the segmentation later. */
function safeLeaf(name: string): string {
  return name.replace(/[/\\:*?"<>|]+/g, "_").trim() || "dossier";
}

/**
 * Compute the on-disk path for an archived note. We preserve the relative
 * structure under the archived folder (so a user who archives `Travail/X`
 * still sees the `notes/inbox.md` vs `notes/projects/recap.md` split when
 * unarchiving or browsing the archive bucket on disk).
 *
 *   originalFolder = "Travail/Projet-X"
 *   originalFile   = "Travail/Projet-X/specs/recap.md"
 *   bucket         = "_archive/2026-05-10T10-30-45-Projet-X"
 *   →                "_archive/2026-05-10T10-30-45-Projet-X/specs/recap.md"
 */
function archivedFilePath(
  bucket: string,
  originalFolder: string,
  originalFilePath: string,
): string {
  const folderPrefix = `${originalFolder}/`;
  const relative = originalFilePath.startsWith(folderPrefix)
    ? originalFilePath.slice(folderPrefix.length)
    : originalFilePath.split("/").pop() ?? originalFilePath;
  return `${bucket}/${relative}`;
}

/**
 * Toggle the `archivedAt` field of a note. Pass `archived: true` to archive
 * (writes the current ISO timestamp), `false` to restore (clears the field
 * by writing `null`, which downstream readers treat as "active"). For
 * single-note archive the file STAYS on disk where it is — only the metadata
 * flag flips. Folder-level archiving (see `useArchiveFolder`) is what
 * physically moves notes into the `_archive/...` bucket so a user-recreated
 * folder of the same name doesn't collide with leftover archived files.
 *
 * On unarchive we ALSO try to move the file back to `originalFolderPath` if
 * that field is set — that's how a "restore" of a folder-archived note
 * actually returns to its old home. Falls back to leaving the file in place
 * (only metadata flip) if no original path was recorded or the destination
 * is taken.
 */
export function useArchiveNote() {
  const hasBackend = useHasBackend();
  const utils = trpc.useUtils();
  const mutation = trpc.entities.update.useMutation({
    onSuccess: (data) => {
      void utils.entities.get.invalidate({ id: data.id });
      void utils.entities.list.invalidate();
    },
  });

  const setArchived = useCallback(
    async (id: string, archived: boolean): Promise<void> => {
      if (!hasBackend) return;

      if (archived) {
        // Single-note archive: don't touch filePath — the user is opting one
        // note out of the active view, not bulk-archiving a project. Folder
        // archival is the only path that physically relocates files.
        await mutation.mutateAsync({
          id,
          fields: { archivedAt: new Date().toISOString() },
        });
        return;
      }

      // Restore — read the current entity to find its original home (if any).
      // We pull from cache when possible to avoid an extra round-trip; only
      // refetch when the entity isn't already loaded.
      let cached = utils.entities.get.getData({ id });
      if (!cached) cached = await utils.entities.get.fetch({ id });
      const originalFolder =
        typeof cached?.fields?.["originalFolderPath"] === "string"
          ? (cached.fields["originalFolderPath"] as string)
          : null;
      const currentPath = cached?.filePath ?? null;
      const filename = currentPath?.split("/").pop() ?? null;

      // Default restore patch: clear archivedAt and the bookkeeping field.
      // Use `null` (not `undefined`) so both cache + frontmatter round-trip
      // agree the keys are empty.
      const patch: { archivedAt: null; originalFolderPath: null } = {
        archivedAt: null,
        originalFolderPath: null,
      };

      // Try to relocate the file back to its original folder. We pre-check
      // the destination by reading the same `entities.list` cache the UI
      // already subscribes to — if a note already lives at that exact path
      // we leave the file in `_archive/...` (the user can move it manually
      // via the existing move modal) to avoid a silent overwrite.
      let nextFilePath: string | undefined;
      if (originalFolder && filename && currentPath) {
        const desired = `${originalFolder}/${filename}`;
        if (desired !== currentPath) {
          const all = utils.entities.list.getData({ typeId: "note", limit: 500, offset: 0 });
          const taken = all?.items.some((e) => e.filePath === desired && e.id !== id);
          if (!taken) nextFilePath = desired;
        }
      }

      await mutation.mutateAsync({
        id,
        fields: patch as unknown as Record<string, FieldValue>,
        ...(nextFilePath ? { filePath: nextFilePath } : {}),
      });
    },
    [hasBackend, mutation, utils],
  );

  return { setArchived, isPending: mutation.isPending };
}

/**
 * Bulk-archive every note under a folder (recursively). For each note:
 *   - mark `archivedAt` with the current timestamp
 *   - record the `originalFolderPath` so a later restore can put it back
 *   - move the .md file into a unique `_archive/<stamp>-<leaf>/...` bucket
 *
 * The unique bucket name is what guarantees a re-created folder of the
 * same name won't collide with the archived files on disk — the active
 * vault sees a fresh empty folder, the archived subtree stays intact for
 * the /archive page to surface.
 *
 * After the moves succeed we call `vault.folders.delete` to drop the now-
 * empty folder metadata entry (and any subfolder entries beneath it). The
 * worker's cascade-delete is harmless on already-empty paths.
 */
export function useArchiveFolder() {
  const hasBackend = useHasBackend();
  const utils = trpc.useUtils();
  const updateMutation = trpc.entities.update.useMutation();
  const deleteFolderMutation = trpc.vault.folders.delete.useMutation();

  const archiveFolder = useCallback(
    async (folderPath: string): Promise<{ archivedCount: number }> => {
      if (!hasBackend) return { archivedCount: 0 };

      // Pull every note from the shared cache; the page-level useNoteList
      // call has already populated this. Fall back to a refetch if the
      // cache is cold (e.g. user landed straight on a context-menu action
      // before the list query settled).
      let all = utils.entities.list.getData({ typeId: "note", limit: 500, offset: 0 });
      if (!all) {
        all = await utils.entities.list.fetch({ typeId: "note", limit: 500, offset: 0 });
      }

      const folderPrefix = `${folderPath}/`;
      const targets = all.items.filter((e) => {
        const fp = e.filePath ?? "";
        // Match notes living directly in the folder OR in any sub-folder.
        // The folder path itself never appears as a filePath (folders aren't
        // entities), so we don't need to special-case `fp === folderPath`.
        return fp.startsWith(folderPrefix);
      });

      if (targets.length === 0) {
        // Empty folder — still drop the metadata entry so the folder
        // disappears from the FileTree.
        try { await deleteFolderMutation.mutateAsync({ path: folderPath }); } catch { /* best-effort */ }
        await utils.vault.folders.list.refetch();
        return { archivedCount: 0 };
      }

      const stamp = safeStamp();
      const leaf = safeLeaf(folderPath.split("/").pop() ?? "dossier");
      const bucket = `_archive/${stamp}-${leaf}`;
      const archivedAt = new Date().toISOString();

      // Run the per-note updates in parallel — each rewrites the .md file
      // at the new location and updates the entity row. The worker's move
      // path is idempotent enough to handle concurrent writes, and a
      // typical folder has a few dozen notes at most.
      await Promise.all(
        targets.map((e) => {
          const oldPath = e.filePath ?? "";
          // The folderPath we hand to the entity is the ORIGINAL note-level
          // folder (e.g. "Travail/Projet-X/specs"), not the archived
          // bucket — that's what we need to restore back to later. Each
          // note independently remembers where it came from so a partial
          // restore (single note, vs. whole folder) works the same way.
          const originalFolderPath = oldPath.split("/").slice(0, -1).join("/");
          const newPath = archivedFilePath(bucket, folderPath, oldPath);
          const fields: Record<string, FieldValue> = {
            ...(e.fields as Record<string, FieldValue>),
            archivedAt,
            originalFolderPath,
          };
          return updateMutation.mutateAsync({
            id: e.id,
            fields,
            filePath: newPath,
          });
        }),
      );

      // Drop the now-empty folder + any subfolder metadata. The worker
      // also tries to delete the on-disk directory — by this point it
      // should be empty (we moved every .md out of it). If extra files
      // somehow lived there (.DS_Store, ad-hoc user files), the
      // best-effort delete logs a warning and continues.
      try { await deleteFolderMutation.mutateAsync({ path: folderPath }); } catch { /* best-effort */ }

      await utils.entities.list.refetch({ typeId: "note", limit: 500, offset: 0 });
      await utils.vault.folders.list.refetch();
      return { archivedCount: targets.length };
    },
    [hasBackend, updateMutation, deleteFolderMutation, utils],
  );

  return { archiveFolder, isPending: updateMutation.isPending || deleteFolderMutation.isPending };
}

// ── useReorderNotes ───────────────────────────────────────────────────────────

/**
 * Persist a new manual order for a list of notes. Each note gets a `sortOrder`
 * written into `fields`. Uses step-of-1000 spacing so future inserts rarely
 * need to rewrite every row.
 */
export function useReorderNotes() {
  const hasBackend = useHasBackend();
  const utils = trpc.useUtils();
  const mutation = trpc.entities.update.useMutation();

  const reorderNotes = useCallback(
    async (orderedIds: string[]): Promise<void> => {
      if (!hasBackend) return;
      await Promise.all(
        orderedIds.map((id, i) =>
          mutation.mutateAsync({ id, fields: { sortOrder: (i + 1) * 1000 } }),
        ),
      );
      await utils.entities.list.invalidate();
    },
    [hasBackend, mutation, utils],
  );

  return { reorderNotes };
}

// ── useMoveFolder ─────────────────────────────────────────────────────────────

/**
 * Move (reparent) a folder to a new path via `vault.folders.rename`.
 * Handles moving all contained notes and cleaning up the old directory.
 */
export function useMoveFolder() {
  const utils = trpc.useUtils();
  const mutation = trpc.vault.folders.rename.useMutation();

  const moveFolder = useCallback(
    async (oldPath: string, newPath: string): Promise<void> => {
      await mutation.mutateAsync({ oldPath, newPath });
      await utils.vault.folders.list.refetch();
    },
    [mutation, utils],
  );

  return { moveFolder };
}

// ── useReorderFolders ─────────────────────────────────────────────────────────

/**
 * Persist a new manual order for a list of root-level folders. Writes
 * `sortOrder` into each folder's metadata entry via `vault.folders.update`.
 */
export function useReorderFolders() {
  const utils = trpc.useUtils();
  const mutation = trpc.vault.folders.update.useMutation();

  const reorderFolders = useCallback(
    async (orderedPaths: string[]): Promise<void> => {
      await Promise.all(
        orderedPaths.map((path, i) =>
          mutation.mutateAsync({ path, sortOrder: (i + 1) * 1000 }),
        ),
      );
      await utils.vault.folders.list.refetch();
    },
    [mutation, utils],
  );

  return { reorderFolders };
}
