"use client";

import { Archive, ArrowUUpLeft, DotsThree, DotsSixVertical, Trash } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatRelativeDate, type Note } from "./fixtures";
import { useTranslations } from "next-intl";
import {
  ContextMenu,
  useContextMenu,
  useToast,
  type ContextMenuItemDef,
} from "@supernote/ui";
import { useSettings } from "@/components/settings/SettingsContext";
import { CanvasMinimap } from "./CanvasMinimap";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface NoteListItemProps {
  note: Note;
  isActive: boolean;
  onClick: () => void;
  /** Fired on mouse-enter / focus — used by the parent to prefetch the note. */
  onHover?: () => void;
  /** Fetch the full body for the hover-preview card (null = unavailable). */
  getPreview?: (id: string) => Promise<string | null>;
  onDelete?: () => void;
  /** When true, wraps with useSortable for DnD reordering in manual sort mode. */
  sortable?: boolean;
  /** Called when the user double-clicks the title and confirms a new name. */
  onRename?: (newTitle: string) => Promise<void>;
  /**
   * Toggle the archived state. Passing the new boolean (vs. inferring from
   * `note.archivedAt`) keeps the call site explicit and makes it obvious
   * which menu item maps to which action when reading the JSX below.
   */
  onArchive?: (archived: boolean) => Promise<void>;
  /** Called when a cross-panel drag towards the FileTree begins. */
  onDragNote?: (noteId: string) => void;
}

export function NoteListItem({ note, isActive, onClick, onHover, getPreview, onDelete, sortable, onRename, onArchive, onDragNote }: NoteListItemProps) {
  const [hovered, setHovered] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const t = useTranslations("notes");
  const ctxMenu = useContextMenu();
  const { toast } = useToast();
  const { settings } = useSettings();
  const dateFormat = settings.general.dateFormat;
  const preview = note.body.split("\n").slice(0, 2).join(" ").slice(0, 120);

  const canvasRaw = useMemo(() => note.fields?.["canvas"], [note.fields]);
  const canvasHref = `/notes/${note.id}?view=canvas`;

  // Surface a small extension chip on the row when the note is an
  // attachment-backed entity (image, pdf, xlsx, csv, gdoc, …) so the
  // sidebar visually distinguishes file-backed entries from "real"
  // markdown notes. Colour-coded by category for at-a-glance scanning.
  const attachmentBadge = useMemo<
    { label: string; bg: string; fg: string; title: string } | null
  >(() => {
    const af = note.fields?.["attachmentFile"];
    if (typeof af !== "string" || !af) return null;
    const dot = af.lastIndexOf(".");
    const ext = dot >= 0 ? af.slice(dot + 1).toLowerCase() : "";
    if (!ext) return null;
    const palette = badgePalette(ext);
    return {
      label: ext,
      bg: palette.bg,
      fg: palette.fg,
      title: `Fichier .${ext} — ${af}`,
    };
  }, [note.fields]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: note.id,
    disabled: !sortable,
  });

  const isArchived = !!note.archivedAt;

  // ── Hover preview card ──────────────────────────────────────────────────
  // 500ms d'intention au survol → carte fixe à droite de la liste (portal,
  // pour échapper à l'overflow de la colonne) avec extrait du body.
  // Desktop seulement — au tactile le survol n'existe pas.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{ top: number; left: number; excerpt: string } | null>(null);

  const cancelPreview = useCallback(() => {
    if (previewTimer.current) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    setHoverPreview(null);
  }, []);

  const schedulePreview = useCallback(() => {
    if (!getPreview) return;
    if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      previewTimer.current = null;
      void (async () => {
        const body = await getPreview(note.id);
        const el = containerRef.current;
        if (body === null || !el) return;
        const rect = el.getBoundingClientRect();
        const excerpt = body
          .replace(/[#>*`~_\[\]|-]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 320);
        setHoverPreview({
          top: Math.max(8, Math.min(rect.top, window.innerHeight - 260)),
          left: rect.right + 8,
          excerpt,
        });
      })();
    }, 500);
  }, [getPreview, note.id]);

  useEffect(() => () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
  }, []);

  // Single source of actions — used by both the visible "..." button and a
  // right-click anywhere on the row. Archive sits BEFORE delete so a misclick
  // on the destructive item is less likely; when the note is already archived
  // the label flips to "Désarchiver" with a restore icon.
  const buildItems = (): ContextMenuItemDef[] => [
    {
      key: "archive",
      label: isArchived ? t("unarchiveNote") : t("archiveNote"),
      icon: isArchived ? <ArrowUUpLeft size={14} /> : <Archive size={14} />,
      isDisabled: !onArchive,
      onPress: () => {
        if (!onArchive) return;
        void onArchive(!isArchived).catch(() =>
          toast({
            title: isArchived
              ? "Impossible de désarchiver la note"
              : "Impossible d'archiver la note",
            variant: "danger",
          }),
        );
      },
    },
    {
      key: "delete",
      label: t("deleteNote"),
      icon: <Trash size={14} />,
      isDanger: true,
      isDisabled: !onDelete,
      onPress: () => onDelete?.(),
    },
  ];

  const openActions = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    ctxMenu.open(e, buildItems());
  };

  const handleRenameCommit = async (newTitle: string) => {
    setIsRenaming(false);
    if (!onRename || newTitle === note.title) return;
    try {
      await onRename(newTitle);
    } catch {
      toast({ title: "Impossible de renommer la note", variant: "danger" });
    }
  };

  const dndStyle = sortable
    ? {
        transform: CSS.Transform.toString(transform),
        // While actively dragging, defer to dnd-kit's own transition so we
        // never fight the pointer-follow. The interesting moment is the
        // settle-after-drop and the neighbour reflow once the pointer is up:
        // re-time those on the signature glide curve (decelerate-to-rest)
        // so rows ease into place instead of sliding linearly. We only
        // retime when dnd-kit actually supplies a transition to animate.
        transition:
          !isDragging && transition
            ? "transform var(--sn-dur-2) var(--sn-ease-glide)"
            : transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : undefined,
        position: isDragging ? ("relative" as const) : undefined,
      }
    : {};

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        if (sortable) setNodeRef(el);
      }}
      style={dndStyle}
      {...(sortable ? attributes : {})}
      className="relative"
      onMouseEnter={() => {
        setHovered(true);
        onHover?.();
        if (!isRenaming) schedulePreview();
      }}
      onMouseLeave={() => {
        setHovered(false);
        cancelPreview();
      }}
      onMouseDown={cancelPreview}
      onFocus={() => onHover?.()}
      onContextMenu={openActions}
    >
      {/* Drag handle — only visible on hover when sortable */}
      {sortable && hovered && (
        <button
          {...listeners}
          aria-label="Réordonner"
          className="absolute left-1 top-1/2 -translate-y-1/2 flex h-6 w-4 items-center justify-center rounded cursor-grab active:cursor-grabbing"
          style={{ color: "var(--text-muted)", zIndex: 1 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <DotsSixVertical size={12} />
        </button>
      )}
      <button
        onClick={isRenaming ? undefined : onClick}
        draggable={!!onDragNote && !isRenaming}
        onDragStart={onDragNote && !isRenaming ? (e) => {
          e.dataTransfer.setData("text/plain", note.id);
          e.dataTransfer.effectAllowed = "move";
          onDragNote(note.id);
        } : undefined}
        className="sn-pressable w-full text-left focus-visible:outline-none"
        style={{
          borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
          backgroundColor: isActive
            ? "var(--accent-subtle)"
            : hovered
              ? "var(--surface-2)"
              : undefined,
          // Selection/hover highlight (bg, border, text) eases on the
          // signature color curve so the active row settles instead of
          // snapping. We compose the colors token with the .sn-pressable
          // transform spring in one declaration: a single inline `transition`
          // would otherwise clobber .sn-pressable's own transform transition
          // (inline beats the class), losing the tactile press give.
          transition:
            "var(--sn-transition-colors), transform var(--sn-dur-1) var(--sn-ease-spring)",
          paddingLeft: sortable && hovered ? "8px" : undefined,
          // Archived rows are visible (when the toggle reveals them) but
          // visually demoted so they don't compete with active notes.
          opacity: isArchived ? 0.6 : 1,
          cursor: onDragNote && !isRenaming ? "grab" : undefined,
        }}
      >
        <div className="px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            {isRenaming ? (
              <InlineNoteRenameInput
                initialValue={note.title}
                onCommit={handleRenameCommit}
                onCancel={() => setIsRenaming(false)}
              />
            ) : (
              <>
                <h3
                  className="truncate text-sm font-medium leading-snug"
                  style={{ color: "var(--text-primary)" }}
                  onDoubleClick={onRename ? (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setIsRenaming(true);
                  } : undefined}
                  onKeyDown={onRename ? (e) => {
                    if (e.key === "F2") { e.preventDefault(); setIsRenaming(true); }
                  } : undefined}
                  tabIndex={onRename ? 0 : undefined}
                >
                  {note.title}
                </h3>
                <span
                  className="flex-shrink-0 text-[11px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {formatRelativeDate(note.updatedAt, dateFormat)}
                </span>
              </>
            )}
          </div>

          {preview && !isRenaming && (
            <p
              className="mt-1 line-clamp-2 text-xs leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              {preview}
            </p>
          )}

          {(isArchived || note.tags.length > 0 || attachmentBadge) && !isRenaming && (
            <div className="mt-2 flex flex-wrap gap-1">
              {attachmentBadge && (
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{
                    backgroundColor: attachmentBadge.bg,
                    color: attachmentBadge.fg,
                  }}
                  title={attachmentBadge.title}
                >
                  {attachmentBadge.label}
                </span>
              )}
              {isArchived && (
                <span
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: "var(--surface-3)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border-subtle)",
                  }}
                  title={`Archivée le ${new Date(note.archivedAt!).toLocaleDateString()}`}
                >
                  <Archive size={10} />
                  Archivée
                </span>
              )}
              {note.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: "var(--surface-3)",
                    color: "var(--text-muted)",
                  }}
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {!isRenaming && (
            <CanvasMinimap
              canvasRaw={canvasRaw}
              canvasHref={canvasHref}
            />
          )}
        </div>
        <div
          className="mx-4"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        />
      </button>

      {(onDelete || onArchive) && hovered && !isRenaming && (
        <button
          onClick={openActions}
          aria-label="Actions de la note"
          title="Actions"
          // Opaque idle state — covers the date pill underneath. Hover
          // bumps the icon to the accent color so the menu trigger is
          // visually distinct from the row's "selected" state.
          // Justified native: context-menu positioning requires clientX/clientY.
          className="sn-motion-colors absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-muted)] shadow-sm hover:border-[var(--accent)] hover:bg-[var(--surface-2)] hover:text-[var(--accent)]"
        >
          <DotsThree size={16} weight="bold" />
        </button>
      )}

      <ContextMenu state={ctxMenu.state} onClose={ctxMenu.close} />

      {/* Carte d'aperçu — portal vers body pour échapper à l'overflow
          de la colonne. Position fixe calculée depuis le rect de la ligne. */}
      {hoverPreview &&
        createPortal(
          <div
            className="sn-note-preview"
            style={{ top: hoverPreview.top, left: hoverPreview.left }}
            role="tooltip"
          >
            <p className="sn-note-preview__title">{note.title}</p>
            <p className="sn-note-preview__meta">
              {formatRelativeDate(note.updatedAt, dateFormat)}
            </p>
            {hoverPreview.excerpt ? (
              <p className="sn-note-preview__excerpt">{hoverPreview.excerpt}</p>
            ) : (
              <p className="sn-note-preview__excerpt" style={{ fontStyle: "italic" }}>
                Note vide
              </p>
            )}
            {note.tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {note.tags.slice(0, 6).map((tag) => (
                  <span
                    key={tag}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

/**
 * Pick a foreground/background pair for the extension chip based on the
 * file category. Tuned against the app's light + dark themes — soft pastel
 * backgrounds (10–15 % saturation) so the chip never out-shouts the title.
 */
function badgePalette(ext: string): { bg: string; fg: string } {
  if (
    ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif" ||
    ext === "webp" || ext === "svg" || ext === "avif" || ext === "bmp"
  ) {
    return { bg: "rgba(34,197,94,0.14)", fg: "#16a34a" };
  }
  if (ext === "pdf") {
    return { bg: "rgba(239,68,68,0.14)", fg: "#dc2626" };
  }
  if (ext === "xlsx" || ext === "xls" || ext === "csv" || ext === "tsv" || ext === "gsheet") {
    return { bg: "rgba(34,197,94,0.18)", fg: "#15803d" };
  }
  if (ext === "docx" || ext === "doc" || ext === "gdoc") {
    return { bg: "rgba(59,130,246,0.14)", fg: "#2563eb" };
  }
  if (ext === "pptx" || ext === "ppt" || ext === "gslides") {
    return { bg: "rgba(249,115,22,0.14)", fg: "#ea580c" };
  }
  return { bg: "var(--surface-3)", fg: "var(--text-muted)" };
}

// ── InlineNoteRenameInput ────────────────────────────────────────────────────

interface InlineNoteRenameInputProps {
  initialValue: string;
  onCommit: (value: string) => Promise<void>;
  onCancel: () => void;
}

function InlineNoteRenameInput({ initialValue, onCommit, onCancel }: InlineNoteRenameInputProps) {
  const [draft, setDraft] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    const trimmed = draft.trim().replace(/[/\\]/g, "");
    if (!trimmed) { onCancel(); return; }
    void onCommit(trimmed);
  };

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      className="flex-1 min-w-0 rounded px-1 text-sm font-medium outline-none ring-1 ring-[var(--accent)]"
      style={{ color: "var(--text-primary)", backgroundColor: "var(--surface-1)" }}
      aria-label="Renommer la note"
    />
  );
}
