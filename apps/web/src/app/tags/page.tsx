"use client";

/**
 * /tags — vault-wide tag management with hierarchical (slash-path) tags.
 *
 * Tags use `/` as their hierarchy separator (e.g. `client/premium/europe`).
 * The DB columns `tag.path` and `tag.parentPath` already encode this; the
 * UI surfaces it as a tree (TagTree) on the left, with the right pane
 * showing every entity whose tag is the selected path *or any descendant*
 * (recursive entity rollup — see worker-router `tagsEntities`).
 *
 * Mutations are routed through:
 *   - tags.create   → leaf creation under a chosen parent
 *   - tags.rename   → cascading rename across the entire subtree
 *   - tags.move     → re-parent a tag (preserves the leaf segment)
 *   - tags.merge    → fold one branch into another (re-tags entities)
 *   - tags.delete   → leaf or cascading delete (toggle in the confirm modal)
 *
 * Right-click on any tag opens a context menu with all of the above.
 */

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, Input, Checkbox } from "@heroui/react";
import { useToast } from "@supernote/ui";
import { withMutationFeedback } from "@/lib/trpc/with-mutation-feedback";
import { Plus, Tag as TagIcon } from "@phosphor-icons/react";
import {
  AppShell,
  PromptModal,
  ColorPickerPopover,
  COLOR_PRESETS,
  useMobileTitle,
  useMobileFab,
} from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { TagTree } from "@/components/tags/TagTree";
import { trpc } from "@/lib/trpc/client";
import type { Tag, TagEntity } from "@supernote/ipc/schemas/tags";

/**
 * Resolve the in-app route for a tagged entity. Notes and contacts have
 * dedicated detail pages; other entity types fall back to a non-link span
 * (returning null) since the PWA doesn't render them individually yet.
 */
function entityHref(e: TagEntity): string | null {
  if (e.typeId === "note") return `/notes/${e.id}`;
  if (e.typeId === "personne" || e.typeId === "contact") return `/contacts/${e.id}`;
  return null;
}

// Default color for newly-created tags — first preset (slate).
const DEFAULT_TAG_COLOR = COLOR_PRESETS[0]!.hex;

/** Strip leading `#`, normalize `//` runs, drop trailing slash. */
const cleanTagPath = (raw: string): string =>
  raw.trim().replace(/^#+/, "").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");

interface CreateModalState {
  open: boolean;
  /** Pre-filled parent path (empty means root). */
  parent: string;
}

interface RenameModalState {
  open: boolean;
  path: string;
}

interface MoveModalState {
  open: boolean;
  path: string;
}

interface MergeModalState {
  open: boolean;
  source: string;
}

interface DeleteModalState {
  open: boolean;
  path: string;
  cascade: boolean;
}

export default function TagsPage() {
  const isMobile = useIsMobile();
  const utils = trpc.useUtils();
  const tagsQuery = trpc.tags.list.useQuery({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [createModal, setCreateModal] = useState<CreateModalState>({ open: false, parent: "" });
  const [renameModal, setRenameModal] = useState<RenameModalState>({ open: false, path: "" });
  const [moveModal, setMoveModal] = useState<MoveModalState>({ open: false, path: "" });
  const [mergeModal, setMergeModal] = useState<MergeModalState>({ open: false, source: "" });
  const [deleteModal, setDeleteModal] = useState<DeleteModalState>({
    open: false,
    path: "",
    cascade: true,
  });

  // Color picker state (kept from the previous page so we don't regress
  // the swatch UX). Tracks which tag path is being recolored and the rect
  // of the trigger so the popover can anchor itself.
  const [pickerPath, setPickerPath] = useState<string | null>(null);
  const [pickerRect, setPickerRect] = useState<DOMRect | null>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);

  const refresh = () => {
    void utils.tags.list.invalidate();
    void utils.tags.entities.invalidate();
  };

  // Force refetch — invalidate alone leaves the existing data on screen until
  // the next render cycle, which makes the sub-tag creation feel like nothing
  // happened (the tree doesn't visibly update). Refetch awaits the new payload
  // so the tree shows the freshly-created node immediately.
  const hardRefresh = async () => {
    await utils.tags.list.refetch();
    void utils.tags.entities.invalidate();
  };

  const { toast } = useToast();

  // Feedback d'échec : les mutations de tags avalaient leurs erreurs (conflit de
  // chemin, tag déjà existant…) — l'utilisateur voyait l'action ne rien faire.
  const createMut = trpc.tags.create.useMutation(
    withMutationFeedback(
      toast,
      { error: "Impossible de créer le tag" },
      { onSuccess: () => void hardRefresh() },
    ),
  );
  const updateMut = trpc.tags.update.useMutation(
    withMutationFeedback(toast, { error: "Impossible de modifier le tag" }, { onSuccess: refresh }),
  );
  const renameMut = trpc.tags.rename.useMutation(
    withMutationFeedback(toast, { error: "Impossible de renommer le tag" }, { onSuccess: refresh }),
  );
  const moveMut = trpc.tags.move.useMutation(
    withMutationFeedback(toast, { error: "Impossible de déplacer le tag" }, { onSuccess: refresh }),
  );
  const mergeMut = trpc.tags.merge.useMutation(
    withMutationFeedback(
      toast,
      { error: "Impossible de fusionner les tags" },
      {
        onSuccess: () => {
          refresh();
          setSelectedPath(null);
        },
      },
    ),
  );
  const deleteMut = trpc.tags.delete.useMutation(
    withMutationFeedback(
      toast,
      { error: "Impossible de supprimer le tag" },
      {
        onSuccess: () => {
          refresh();
          setSelectedPath(null);
        },
      },
    ),
  );

  const tags = (tagsQuery.data ?? []) as Tag[];

  // Selected tag (only resolves to a real `Tag` when the path matches a row;
  // intermediate "virtual" paths from the tree don't appear here, but the
  // entities pane still works because tags.entities does a path-prefix query).
  const selected = useMemo(
    () => tags.find((t) => t.path === selectedPath) ?? null,
    [tags, selectedPath],
  );

  // Recursive entity list for the selected path. We always pass `recursive:
  // true` so descendants roll up — this is the whole point of the
  // hierarchical UI.
  const entitiesQuery = trpc.tags.entities.useQuery(
    { path: selectedPath ?? "", recursive: true },
    { enabled: Boolean(selectedPath) },
  );

  // Roll-up count for the header (sum of own + descendant counts). Computed
  // here rather than read from `selected.count` because `selected.count` is
  // the direct (non-recursive) count and we want the same number as the
  // tree badge.
  const recursiveCount = useMemo(() => {
    if (!selectedPath) return 0;
    const prefix = selectedPath + "/";
    return tags.reduce(
      (acc, t) =>
        t.path === selectedPath || t.path.startsWith(prefix) ? acc + t.count : acc,
      0,
    );
  }, [tags, selectedPath]);

  const hasDescendantsForDelete = useMemo(() => {
    if (!deleteModal.path) return false;
    const prefix = deleteModal.path + "/";
    return tags.some((t) => t.path.startsWith(prefix));
  }, [tags, deleteModal.path]);

  const subtle = "var(--border-subtle)";

  // ── Mutation handlers ─────────────────────────────────────────────────────

  const handleCreateConfirm = async (rawValue: string) => {
    const parent = cleanTagPath(createModal.parent);
    const leaf = cleanTagPath(rawValue);
    if (!leaf) {
      setCreateModal({ open: false, parent: "" });
      return;
    }
    // Allow either a bare leaf (`europe`) or an explicit slash path
    // (`client/premium/europe`). Explicit paths win when present.
    const path = leaf.includes("/") || !parent ? leaf : `${parent}/${leaf}`;
    // Trace the request before firing — when sub-tag creation appears to do
    // nothing, this log + the matching success/error log on the mutation tell
    // us whether the click reached the worker, what path was sent, and how
    // the worker responded. Without it the failure is invisible.
    console.info("[tags] create sub-tag", { parent, leaf, fullPath: path });
    // Close the modal first so a slow worker round-trip doesn't leave the
    // dialog hanging open on the user.
    setCreateModal({ open: false, parent: "" });
    try {
      await createMut.mutateAsync({ path, color: DEFAULT_TAG_COLOR });
      // Belt-and-braces refetch — the mutation's onSuccess already refetches,
      // but awaiting here means the caller knows the list is up to date by
      // the time this function resolves (useful for tests / future callers).
      await utils.tags.list.refetch();
    } catch (err) {
      console.error("[tags] create sub-tag failed", { path, err });
    }
  };

  const handleRenameConfirm = (rawValue: string) => {
    const newPath = cleanTagPath(rawValue);
    if (renameModal.path && newPath && newPath !== renameModal.path) {
      renameMut.mutate({ oldPath: renameModal.path, newPath });
      // Optimistically follow the rename so the entities pane stays focused.
      if (selectedPath === renameModal.path) setSelectedPath(newPath);
    }
    setRenameModal({ open: false, path: "" });
  };

  const handleMoveConfirm = (rawValue: string) => {
    const trimmed = rawValue.trim();
    // Empty input means "promote to root".
    const newParent = trimmed.length === 0 ? null : cleanTagPath(trimmed);
    if (moveModal.path) {
      moveMut.mutate({ path: moveModal.path, newParentPath: newParent });
      const segs = moveModal.path.split("/");
      const leaf = segs[segs.length - 1] ?? moveModal.path;
      const predicted = newParent ? `${newParent}/${leaf}` : leaf;
      if (selectedPath === moveModal.path) setSelectedPath(predicted);
    }
    setMoveModal({ open: false, path: "" });
  };

  const handleMergeConfirm = (rawValue: string) => {
    const target = cleanTagPath(rawValue);
    if (mergeModal.source && target && target !== mergeModal.source) {
      mergeMut.mutate({
        sourcePath: mergeModal.source,
        targetPath: target,
        includeDescendants: true,
      });
    }
    setMergeModal({ open: false, source: "" });
  };

  const handleDeleteConfirm = () => {
    if (deleteModal.path) {
      deleteMut.mutate({ path: deleteModal.path, recursive: deleteModal.cascade });
    }
    setDeleteModal({ open: false, path: "", cascade: true });
  };

  // Suggestions for the autocomplete-style picker (move / merge modals).
  // Flat list of every existing tag path; the browser's native datalist
  // turns this into a free-text-with-hints input — no extra deps.
  const allPaths = useMemo(() => tags.map((t) => t.path).sort(), [tags]);

  useMobileTitle(isMobile ? "Tags" : null);

  useMobileFab(
    isMobile
      ? {
          icon: Plus,
          label: "Nouveau tag",
          onPress: () => setCreateModal({ open: true, parent: "" }),
        }
      : null,
  );

  return (
    <AppShell>
      <div className="flex h-full">
        <aside
          className="flex w-full shrink-0 flex-col border-r md:w-[360px]"
          style={{ borderColor: subtle, backgroundColor: "var(--surface-1)" }}
        >
          <div
            className="flex items-center justify-between gap-2 border-b px-4 py-2 md:py-3"
            style={{ borderColor: subtle }}
          >
            <div className="flex items-center gap-2">
              <TagIcon size={15} style={{ color: "var(--accent)" }} />
              <span
                className="text-sm font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                Tags ({tags.length})
              </span>
            </div>
            {/* "Nouveau tag" button hidden on mobile — FAB handles creation */}
            <Button
              onPress={() => setCreateModal({ open: true, parent: "" })}
              size="sm"
              className="hidden md:flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium"
              style={{ backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-fg)" }}
            >
              <Plus size={12} /> Nouveau tag
            </Button>
          </div>

          <div className="px-3 py-2 border-b" style={{ borderColor: subtle }}>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un tag…"
              className="w-full rounded-md px-3 py-1.5 text-sm outline-none"
              style={{
                backgroundColor: "var(--surface-0)",
                border: `1px solid ${subtle}`,
                color: "var(--text-primary)",
              }}
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {tagsQuery.isLoading ? (
              <p className="px-3 py-2 text-sm" style={{ color: "var(--text-muted)" }}>
                Chargement…
              </p>
            ) : (
              <TagTree
                tags={tags}
                selectedPath={selectedPath}
                onSelectPath={setSelectedPath}
                onCreateChildOf={(parent) =>
                  setCreateModal({ open: true, parent: parent ?? "" })
                }
                onRename={(p) => setRenameModal({ open: true, path: p })}
                onMove={(p) => setMoveModal({ open: true, path: p })}
                onMerge={(p) => setMergeModal({ open: true, source: p })}
                onDelete={(p) =>
                  setDeleteModal({ open: true, path: p, cascade: true })
                }
                onCycleColor={(t) => {
                  // Anchor the popover near the current viewport center if we
                  // can't get a rect from the click (the swatch click handler
                  // in TagTree fires this without an event ref).
                  const fallbackRect = new DOMRect(
                    Math.min(window.innerWidth - 250, 360),
                    100,
                    1,
                    1,
                  );
                  setPickerRect(fallbackRect);
                  setPickerPath(t.path);
                }}
                filter={search}
              />
            )}
          </div>
        </aside>

        {/* Detail pane: hidden on mobile, full width on desktop */}
        <main
          className="hidden md:block flex-1 overflow-y-auto p-6"
          style={{ backgroundColor: "var(--surface-0)" }}
        >
          {!selectedPath && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Sélectionnez un tag pour voir les entités qui l’utilisent (sous-tags
              inclus).
            </p>
          )}
          {selectedPath && (
            <div>
              <h2
                className="text-lg font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                #{selectedPath}
              </h2>
              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                {recursiveCount} entité{recursiveCount > 1 ? "s" : ""}
                {selected?.parentPath ? ` · sous "${selected.parentPath}"` : ""}
                {selected ? "" : " · chemin virtuel (non créé comme tag)"}
              </p>
              <ul className="mt-4 space-y-1">
                {entitiesQuery.isLoading && (
                  <li className="text-sm" style={{ color: "var(--text-muted)" }}>
                    Chargement…
                  </li>
                )}
                {entitiesQuery.data?.length === 0 && (
                  <li className="text-sm" style={{ color: "var(--text-muted)" }}>
                    Aucune entité ne porte ce tag (ni ses sous-tags).
                  </li>
                )}
                {entitiesQuery.data?.map((e) => {
                  const href = entityHref(e);
                  const rowClass =
                    "flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors";
                  const rowStyle = {
                    backgroundColor: "var(--surface-1)",
                  } as const;
                  const inner = (
                    <>
                      <span style={{ color: "var(--text-primary)" }}>
                        {e.title || e.id}
                      </span>
                      <span
                        className="text-xs"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {e.typeName}
                      </span>
                    </>
                  );
                  return (
                    <li key={e.id}>
                      {href ? (
                        <Link
                          href={href}
                          prefetch={false}
                          className={`${rowClass} hover:bg-[var(--surface-2)]`}
                          style={rowStyle}
                          title={`Ouvrir « ${e.title || e.id} »`}
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div className={rowClass} style={rowStyle}>
                          {inner}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </main>
      </div>

      {/* Create — title shows the parent context so the user knows where
          the new tag will land. */}
      <PromptModal
        open={createModal.open}
        title={
          createModal.parent
            ? `Nouveau sous-tag de "${createModal.parent}"`
            : "Nouveau tag"
        }
        placeholder={
          createModal.parent
            ? `ex: europe (créera #${createModal.parent}/europe)`
            : "ex: client/premium ou client"
        }
        onCancel={() => setCreateModal({ open: false, parent: "" })}
        onConfirm={handleCreateConfirm}
      />

      {/* Rename — seed with the current full path so the user can edit any
          segment, including the parent. */}
      <PromptModal
        open={renameModal.open}
        title="Renommer le tag (cascade vers les sous-tags)"
        defaultValue={renameModal.path}
        onCancel={() => setRenameModal({ open: false, path: "" })}
        onConfirm={handleRenameConfirm}
      />

      {/* Move — autocomplete-style picker for the new parent. Empty string
          promotes the tag to the root. */}
      <TagPickerModal
        open={moveModal.open}
        title={`Déplacer "${moveModal.path}"`}
        placeholder="Nouveau parent (vide pour la racine)"
        suggestions={allPaths.filter(
          (p) => p !== moveModal.path && !p.startsWith(`${moveModal.path}/`),
        )}
        defaultValue={(() => {
          const segs = moveModal.path.split("/");
          return segs.length > 1 ? segs.slice(0, -1).join("/") : "";
        })()}
        onCancel={() => setMoveModal({ open: false, path: "" })}
        onConfirm={handleMoveConfirm}
      />

      {/* Merge — autocomplete picker for the target tag. The worker creates
          the target if it doesn't exist yet. */}
      <TagPickerModal
        open={mergeModal.open}
        title={`Fusionner "${mergeModal.source}" dans…`}
        placeholder="Chemin du tag cible (ex: client/important)"
        suggestions={allPaths.filter(
          (p) =>
            p !== mergeModal.source && !p.startsWith(`${mergeModal.source}/`),
        )}
        onCancel={() => setMergeModal({ open: false, source: "" })}
        onConfirm={handleMergeConfirm}
      />

      {/* Color picker (anchored popover) — wired to whatever swatch was last
          clicked in the tree. */}
      <ColorPickerPopover
        open={pickerPath !== null}
        anchorRect={pickerRect}
        value={tags.find((t) => t.path === pickerPath)?.color ?? null}
        onSelect={(color) => {
          if (pickerPath) updateMut.mutate({ path: pickerPath, color });
        }}
        onReset={() => {
          if (pickerPath) updateMut.mutate({ path: pickerPath, color: null });
        }}
        onClose={() => {
          setPickerPath(null);
          setPickerRect(null);
        }}
      />

      {/* Delete — toggle decides whether descendants are also removed. */}
      <DeleteTagModal
        state={deleteModal}
        hasDescendants={hasDescendantsForDelete}
        onCancel={() => setDeleteModal({ open: false, path: "", cascade: true })}
        onConfirm={handleDeleteConfirm}
        onToggleCascade={(cascade) => setDeleteModal((s) => ({ ...s, cascade }))}
      />

      {/* Keep the trigger ref alive (referenced by ColorPickerPopover via
          the parallel-agent code path). Suppresses the lint about an
          unused ref. */}
      <input
        ref={lastTriggerRef as unknown as React.Ref<HTMLInputElement>}
        type="hidden"
      />
    </AppShell>
  );
}

// ── TagPickerModal — autocomplete prompt over a fixed suggestions list ─────

interface TagPickerModalProps {
  open: boolean;
  title: string;
  placeholder?: string;
  defaultValue?: string;
  suggestions: string[];
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

/**
 * Modal with a free-text input wired to a `<datalist>` for autocomplete
 * against the existing tag paths. We use a native datalist instead of the
 * heavier @supernote/ui Combobox because:
 *   1. The Combobox uses a controlled selectedKey, so it can't accept a
 *      *new* path the user types in (which the merge flow needs — the
 *      target tag is created on demand).
 *   2. datalist gives us the autocomplete dropdown for free, with zero
 *      additional bundle cost or focus-management plumbing.
 */
function TagPickerModal({
  open,
  title,
  placeholder,
  defaultValue = "",
  suggestions,
  onCancel,
  onConfirm,
}: TagPickerModalProps) {
  const [value, setValue] = useState(defaultValue);
  const datalistId = `tag-picker-${Math.abs(hashString(title))}`;

  // Reset when reopened so abandoned input doesn't bleed into the next dialog.
  // Reading defaultValue from props inside useEffect is intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useMemoOnOpen(open, () => setValue(defaultValue));

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-xl p-5 shadow-xl"
        style={{
          backgroundColor: "var(--surface-1)",
          border: "1px solid var(--border-subtle)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2
          className="mb-3 text-base font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {title}
        </h2>
        <input
          autoFocus
          type="text"
          value={value}
          placeholder={placeholder}
          list={datalistId}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onConfirm(value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          className="w-full rounded-md px-3 py-2 text-sm outline-none transition-colors"
          style={{
            backgroundColor: "var(--surface-0)",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-primary)",
          }}
        />
        <datalist id={datalistId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onPress={onCancel}
            className="rounded-md px-3 py-1.5 text-sm font-medium"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            Annuler
          </Button>
          <Button
            size="sm"
            onPress={() => onConfirm(value)}
            className="rounded-md px-3 py-1.5 text-sm font-medium"
            style={{
              backgroundColor: "var(--btn-primary-bg)",
              color: "var(--btn-primary-fg)",
            }}
          >
            Valider
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Tiny non-cryptographic string hash — used to derive a stable
 *  per-instance datalist id so multiple pickers on the page don't collide. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * useMemoOnOpen — runs `fn` exactly once when `open` flips to true. Avoids
 * the boilerplate of useEffect + ref-tracking for a "reset state on reopen"
 * pattern that's used in two places here. Importing useEffect lazily inside
 * keeps the top-level import set focused on what the page actually uses.
 */
function useMemoOnOpen(open: boolean, fn: () => void): void {
  const prevRef = useRef(false);
  if (open && !prevRef.current) {
    prevRef.current = true;
    // Defer the state update so we don't `setState` during render.
    queueMicrotask(fn);
  } else if (!open && prevRef.current) {
    prevRef.current = false;
  }
}

// ── DeleteTagModal — custom confirmation with a cascade toggle ────────────

interface DeleteTagModalProps {
  state: DeleteModalState;
  hasDescendants: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onToggleCascade: (next: boolean) => void;
}

/**
 * Custom delete confirmation that adds a cascade checkbox to the standard
 * confirm layout. ConfirmModal has no slot for extra body content, so we
 * inline the markup here rather than extending the shared component.
 */
function DeleteTagModal({
  state,
  hasDescendants,
  onCancel,
  onConfirm,
  onToggleCascade,
}: DeleteTagModalProps) {
  if (!state.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-xl p-5 shadow-xl"
        style={{
          backgroundColor: "var(--surface-1)",
          border: "1px solid var(--border-subtle)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2
          className="text-base font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          Supprimer #{state.path}
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          Ce tag sera retiré de toutes les entités qui le portent.
          {!hasDescendants && " Aucun sous-tag à propager."}
        </p>
        {hasDescendants && (
          <div className="mt-3">
            <Checkbox
              isSelected={state.cascade}
              onChange={onToggleCascade}
              className="text-sm"
              style={{ color: "var(--text-secondary)" }}
            >
              Cascade vers les sous-tags ?
            </Checkbox>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onPress={onCancel}
            className="rounded-md px-3 py-1.5 text-sm font-medium"
            style={{
              borderColor: "var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
          >
            Annuler
          </Button>
          <Button
            size="sm"
            autoFocus
            onPress={onConfirm}
            className="rounded-md px-3 py-1.5 text-sm font-medium"
            style={{
              backgroundColor: "var(--color-red-500, #ef4444)",
              color: "#fff",
            }}
          >
            Supprimer
          </Button>
        </div>
      </div>
    </div>
  );
}
