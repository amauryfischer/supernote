"use client";

import {
  Airplane,
  Archive,
  At,
  Book,
  Bookmark,
  BookmarkSimple,
  BookOpen,
  Brain,
  Briefcase,
  Buildings,
  CaretDoubleLeft,
  Calendar,
  Camera,
  CaretDown,
  CaretRight,
  ChartBar,
  ChartLine,
  ChartPie,
  ChatCircle,
  Clock,
  Code,
  Coffee,
  Coins,
  Compass,
  Cpu,
  Cube,
  CurrencyDollar,
  Database,
  Envelope,
  FileCode,
  Folder,
  FolderLock,
  FolderOpen,
  FolderPlus,
  FolderSimple,
  FolderStar,
  FolderUser,
  Funnel,
  GameController,
  Gift,
  GitBranch,
  Globe,
  GraduationCap,
  Handshake,
  Heart,
  House,
  Image as ImageIcon,
  Key,
  Lightbulb,
  Lightning,
  ListBullets,
  Lock,
  MagnifyingGlass,
  MapPin,
  MapTrifold,
  Medal,
  Megaphone,
  MusicNote,
  Notebook,
  NotePencil,
  PaintBrush,
  Pencil,
  PencilSimple,
  Phone,
  Pizza,
  Plus,
  ShoppingCart,
  SquaresFour,
  Stack,
  Star,
  Tag,
  Target,
  Terminal,
  Toolbox,
  Trash,
  Trophy,
  User,
  Users,
  Wrench,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Folder as FolderType } from "./fixtures";
import { useTranslations } from "next-intl";
import { ContextMenu, useContextMenu } from "@supernote/ui";
import { useUpdateFolder } from "./hooks";
import { folderAccentVars } from "@/lib/folderAccent";

// ── Persisted expanded-folder state ───────────────────────────────────────────
//
// The FileTree previously stored each folder's expanded flag in a per-node
// `useState`, which got blown away whenever the upstream `useFolderTree`
// query refetched and produced fresh node objects (creating a folder, adding
// a sibling, renaming, …). We now lift the state to the FileTree root and
// mirror it to localStorage so it survives both re-renders and full reloads.

const EXPANDED_STORAGE_KEY = "supernote.notes.folderTree.expanded";
// Soft cap on the persisted set to avoid unbounded growth in vaults with
// thousands of folders. We never trim the IN-MEMORY map (so every currently
// open folder stays open during the session); we only trim what hits disk.
const EXPANDED_MAX_PERSISTED = 200;

function readExpandedFromStorage(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((p): p is string => typeof p === "string"));
  } catch {
    return new Set();
  }
}

function writeExpandedToStorage(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    const arr = Array.from(set);
    const trimmed = arr.length > EXPANDED_MAX_PERSISTED
      ? arr.slice(arr.length - EXPANDED_MAX_PERSISTED)
      : arr;
    window.localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota / disabled storage — best-effort */
  }
}

interface ExpandedContextValue {
  isExpanded: (path: string) => boolean;
  setExpanded: (path: string, value: boolean) => void;
  expandPath: (path: string) => void;
}

const ExpandedContext = createContext<ExpandedContextValue | null>(null);

function useExpanded(): ExpandedContextValue {
  const ctx = useContext(ExpandedContext);
  if (!ctx) {
    throw new Error("FolderNode must be rendered inside an ExpandedContext provider");
  }
  return ctx;
}

// ── Icon registry ─────────────────────────────────────────────────────────────
//
// Single source of truth for the per-folder icon picker. Keys are stored
// in the `notes.folders` setting under each folder's `icon` field; we
// resolve them on render via `getFolderIcon`.
//
// Adding an icon? Append the phosphor component AND its key here — the
// picker grid is generated from `FOLDER_ICON_OPTIONS` so no other file
// needs to be touched.

// Category-grouped icon catalogue. Icons render in this order in the picker
// and are grouped under the matching header. The flat `FOLDER_ICON_REGISTRY`
// derived below is what `getFolderIcon` resolves against.
const FOLDER_ICON_CATEGORIES: ReadonlyArray<{
  label: string;
  icons: ReadonlyArray<{ key: string; Icon: PhosphorIcon }>;
}> = [
  {
    label: "Général",
    icons: [
      { key: "Folder", Icon: Folder },
      { key: "FolderOpen", Icon: FolderOpen },
      { key: "FolderSimple", Icon: FolderSimple },
      { key: "FolderStar", Icon: FolderStar },
      { key: "FolderLock", Icon: FolderLock },
      { key: "FolderUser", Icon: FolderUser },
      { key: "Archive", Icon: Archive },
      { key: "Bookmark", Icon: Bookmark },
      { key: "BookmarkSimple", Icon: BookmarkSimple },
      { key: "Star", Icon: Star },
      { key: "Heart", Icon: Heart },
      { key: "House", Icon: House },
      { key: "Tag", Icon: Tag },
      { key: "User", Icon: User },
      { key: "Users", Icon: Users },
    ],
  },
  {
    label: "Travail",
    icons: [
      { key: "Briefcase", Icon: Briefcase },
      { key: "Buildings", Icon: Buildings },
      { key: "ChartLine", Icon: ChartLine },
      { key: "ChartBar", Icon: ChartBar },
      { key: "ChartPie", Icon: ChartPie },
      { key: "Coins", Icon: Coins },
      { key: "CurrencyDollar", Icon: CurrencyDollar },
      { key: "Handshake", Icon: Handshake },
      { key: "Target", Icon: Target },
      { key: "Trophy", Icon: Trophy },
      { key: "Medal", Icon: Medal },
    ],
  },
  {
    label: "Étude / Savoir",
    icons: [
      { key: "Book", Icon: Book },
      { key: "BookOpen", Icon: BookOpen },
      { key: "GraduationCap", Icon: GraduationCap },
      { key: "Brain", Icon: Brain },
      { key: "Lightbulb", Icon: Lightbulb },
      { key: "Notebook", Icon: Notebook },
      { key: "NotePencil", Icon: NotePencil },
      { key: "Pencil", Icon: Pencil },
    ],
  },
  {
    label: "Tech",
    icons: [
      { key: "Code", Icon: Code },
      { key: "FileCode", Icon: FileCode },
      { key: "Terminal", Icon: Terminal },
      { key: "Database", Icon: Database },
      { key: "GitBranch", Icon: GitBranch },
      { key: "Cube", Icon: Cube },
      { key: "Cpu", Icon: Cpu },
    ],
  },
  {
    label: "Vie perso",
    icons: [
      { key: "Coffee", Icon: Coffee },
      { key: "MusicNote", Icon: MusicNote },
      { key: "Camera", Icon: Camera },
      { key: "Image", Icon: ImageIcon },
      { key: "GameController", Icon: GameController },
      { key: "Gift", Icon: Gift },
      { key: "Pizza", Icon: Pizza },
    ],
  },
  {
    label: "Voyage",
    icons: [
      { key: "Airplane", Icon: Airplane },
      { key: "Map", Icon: MapTrifold },
      { key: "MapPin", Icon: MapPin },
      { key: "Compass", Icon: Compass },
      { key: "Globe", Icon: Globe },
    ],
  },
  {
    label: "Communication",
    icons: [
      { key: "Envelope", Icon: Envelope },
      { key: "ChatCircle", Icon: ChatCircle },
      { key: "Phone", Icon: Phone },
      { key: "Megaphone", Icon: Megaphone },
      { key: "At", Icon: At },
    ],
  },
  {
    label: "Productivité",
    icons: [
      { key: "Calendar", Icon: Calendar },
      { key: "Clock", Icon: Clock },
      { key: "Lightning", Icon: Lightning },
      { key: "Wrench", Icon: Wrench },
      { key: "Toolbox", Icon: Toolbox },
      { key: "ShoppingCart", Icon: ShoppingCart },
    ],
  },
  {
    label: "Autres",
    icons: [
      { key: "Key", Icon: Key },
      { key: "Lock", Icon: Lock },
      { key: "Stack", Icon: Stack },
      { key: "SquaresFour", Icon: SquaresFour },
      { key: "ListBullets", Icon: ListBullets },
      { key: "Funnel", Icon: Funnel },
      { key: "MagnifyingGlass", Icon: MagnifyingGlass },
    ],
  },
];

const FOLDER_ICON_REGISTRY: Record<string, PhosphorIcon> =
  FOLDER_ICON_CATEGORIES.reduce<Record<string, PhosphorIcon>>(
    (acc, category) => {
      for (const { key, Icon } of category.icons) {
        acc[key] = Icon;
      }
      return acc;
    },
    {},
  );

/**
 * Resolve a stored icon name to its phosphor component.
 *
 * Unknown / falsy names fall back to `Folder` so renaming or removing an
 * icon from the registry never crashes the tree — it just reverts to the
 * default look until the user re-picks one.
 */
export function getFolderIcon(name: string | undefined): PhosphorIcon {
  if (!name) return Folder;
  return FOLDER_ICON_REGISTRY[name] ?? Folder;
}

// 12-color palette shown in the popover. The picker also exposes a native
// `<input type="color">` for users who want something off-palette.
const FOLDER_COLOR_PALETTE: ReadonlyArray<string> = [
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#eab308", // yellow
  "#84cc16", // lime
  "#22c55e", // green
  "#10b981", // emerald
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#a855f7", // purple
  "#ec4899", // pink
];

interface FileTreeProps {
  folders: FolderType[];
  selectedFolder: string | null;
  onSelectFolder: (path: string) => void;
  /** Create a new folder. When `parentPath` is provided, nest inside it. */
  onNewFolder: (parentPath?: string | null) => void;
  /** Create a new note. When `parentPath` is provided, place it inside that folder. */
  onNewNote: (parentPath?: string | null) => void;
  /** Right-click → "Renommer". Optional; menu item hidden when absent. */
  onRenameFolder?: (path: string) => void;
  /** Right-click → "Supprimer le dossier et toutes ses notes". */
  onDeleteFolder?: (path: string) => void;
  /**
   * Full unfiltered list of notes — used to render the recursive note count
   * "(N)" next to each folder name. Only the `folderPath` field is read; the
   * caller can pass note objects with extra fields without issue.
   */
  notes: { folderPath: string }[];
  /**
   * Optional collapse handler — when provided, a small chevron button is
   * rendered in the header that calls back to hide the entire FileTree
   * column. The parent owns the collapsed state (so it can persist it).
   */
  onCollapse?: () => void;
}

// Picker popover state lifted to the FileTree root so only one popover is
// ever open at a time and it can render above the scroll container without
// being clipped (same pattern as the shared ContextMenu).
type PickerKind = "color" | "icon";
interface PickerState {
  kind: PickerKind;
  path: string;
  x: number;
  y: number;
}

export function FileTree({
  folders,
  selectedFolder,
  onSelectFolder,
  onNewFolder,
  onNewNote,
  onRenameFolder,
  onDeleteFolder,
  notes,
  onCollapse,
}: FileTreeProps) {
  const t = useTranslations("notes");
  // Single context-menu state shared by every FolderNode — only one can be
  // open at a time anyway, and the ContextMenu element lives at the FileTree
  // root so it can render above the scroll container without clipping.
  const ctx = useContextMenu();

  const [picker, setPicker] = useState<PickerState | null>(null);
  const openPicker = (kind: PickerKind, path: string, e: React.MouseEvent) => {
    setPicker({ kind, path, x: e.clientX, y: e.clientY });
  };
  const closePicker = () => setPicker(null);

  // Persisted expanded-folder set. Lazy-init from localStorage so the very
  // first render already shows the previously open folders without a flicker.
  // We seed root-level folders as expanded on the first ever visit (i.e. when
  // storage is empty) so the UX matches the pre-bug default.
  const [expandedSet, setExpandedSet] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    const stored = readExpandedFromStorage();
    if (stored.size > 0) return stored;
    const seed = new Set<string>();
    for (const folder of folders) {
      // Only depth-0 (root) folders. Path with no "/" means root.
      if (!folder.path.includes("/")) seed.add(folder.path);
    }
    return seed;
  });

  // Whenever the root folder list changes (first hydration, freshly created
  // root folder, …), make sure NEW root-level folders default to expanded.
  // Folders already present in the persisted set keep whatever state the
  // user chose; folders not yet known get a soft default.
  const seededRootsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const candidates = folders
      .filter((f) => !f.path.includes("/") && !seededRootsRef.current.has(f.path))
      .map((f) => f.path);
    if (candidates.length === 0) return;
    for (const path of candidates) seededRootsRef.current.add(path);
    setExpandedSet((prev) => {
      let mutated = false;
      const next = new Set(prev);
      for (const path of candidates) {
        // Only seed if this path was never persisted — respects user choice
        // to collapse a root folder across reloads.
        if (!next.has(path)) {
          next.add(path);
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [folders]);

  // Persist on every change. Cheap (Set → Array → JSON) and infrequent.
  useEffect(() => {
    writeExpandedToStorage(expandedSet);
  }, [expandedSet]);

  const setExpanded = useCallback((path: string, value: boolean) => {
    setExpandedSet((prev) => {
      const has = prev.has(path);
      if (value === has) return prev;
      const next = new Set(prev);
      if (value) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const expandPath = useCallback((path: string) => {
    if (!path) return;
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) return;
    setExpandedSet((prev) => {
      const next = new Set(prev);
      let acc = "";
      let mutated = false;
      // Expand every ancestor AND the path itself so deep-linking to
      // /foo/bar/baz reveals /foo and /foo/bar in the tree.
      for (const seg of segments) {
        acc = acc ? `${acc}/${seg}` : seg;
        if (!next.has(acc)) {
          next.add(acc);
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, []);

  const isExpanded = useCallback((path: string) => {
    if (expandedSet.has(path)) return true;
    // Default for unseen paths: root-level folders open, deeper folders
    // closed. Mirrors the pre-bug per-node `useState(depth === 0)`.
    return !path.includes("/");
  }, [expandedSet]);

  // Auto-expand the parent chain whenever the externally-selected folder
  // changes. Covers: navigating via the URL (?folder=…), creating a folder
  // (parent calls setSelectedFolder(newPath)), creating a note in a
  // sub-folder, and renames (parent updates the selection to the new path).
  useEffect(() => {
    if (!selectedFolder) return;
    expandPath(selectedFolder);
  }, [selectedFolder, expandPath]);

  const expandedCtx = useMemo<ExpandedContextValue>(
    () => ({ isExpanded, setExpanded, expandPath }),
    [isExpanded, setExpanded, expandPath],
  );

  return (
    <aside
      className="flex h-full flex-col border-r"
      style={{
        width: 280,
        minWidth: 280,
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          {t("vault")}
        </span>
        <div className="flex items-center gap-1">
          <ActionButton
            onClick={() => onNewFolder(null)}
            label={t("newFolder")}
            icon={<FolderPlus size={13} />}
          />
          <ActionButton
            onClick={() => onNewNote(null)}
            label={t("newNote")}
            icon={<Plus size={13} />}
          />
          {onCollapse && (
            <ActionButton
              onClick={onCollapse}
              label="Réduire"
              icon={<CaretDoubleLeft size={13} />}
            />
          )}
        </div>
      </div>

      <ExpandedContext.Provider value={expandedCtx}>
        <nav className="flex-1 overflow-y-auto p-2">
          {folders.map((folder) => (
            <FolderNode
              key={folder.path}
              folder={folder}
              selectedFolder={selectedFolder}
              onSelectFolder={onSelectFolder}
              onNewFolder={onNewFolder}
              onNewNote={onNewNote}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              openContextMenu={ctx.open}
              openPicker={openPicker}
              depth={0}
              notes={notes}
            />
          ))}
        </nav>
      </ExpandedContext.Provider>

      <ContextMenu state={ctx.state} onClose={ctx.close} />
      <FolderCustomizationPicker state={picker} onClose={closePicker} />

      <div
        className="border-t p-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <button
          onClick={() => onNewFolder(null)}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-muted)" }}
        >
          <Plus size={12} />
          {t("newFolder")}
        </button>
      </div>
    </aside>
  );
}

interface FolderNodeProps {
  folder: FolderType;
  selectedFolder: string | null;
  onSelectFolder: (path: string) => void;
  onNewFolder: (parentPath?: string | null) => void;
  onNewNote: (parentPath?: string | null) => void;
  onRenameFolder?: (path: string) => void;
  onDeleteFolder?: (path: string) => void;
  /** Forwarded from FileTree's `useContextMenu().open` — opens the shared menu. */
  openContextMenu: (
    e: React.MouseEvent,
    items: import("@supernote/ui").ContextMenuItemDef[],
  ) => void;
  /** Open the customization popover (color or icon) at the click position. */
  openPicker: (kind: PickerKind, path: string, e: React.MouseEvent) => void;
  depth: number;
  notes: { folderPath: string }[];
}

function FolderNode({
  folder,
  selectedFolder,
  onSelectFolder,
  onNewFolder,
  onNewNote,
  onRenameFolder,
  onDeleteFolder,
  openContextMenu,
  openPicker,
  depth,
  notes,
}: FolderNodeProps) {
  const hasChildren = !!folder.children?.length;
  // Expanded state is hoisted to FileTree (persisted in localStorage) so it
  // survives tree refetches, sibling additions, and full reloads. See
  // ExpandedContext above.
  const { isExpanded, setExpanded } = useExpanded();
  const expanded = isExpanded(folder.path);
  const isSelected = selectedFolder === folder.path;

  // Recursive count: notes whose folderPath equals this folder OR begins with
  // "<folder.path>/" — i.e. notes nested at any depth underneath. Computed
  // here rather than memoized because the folder tree is small (tens of
  // entries) and the notes array is bounded by the tRPC limit (500), so the
  // O(n) scan per node is well under a millisecond on every render.
  const prefix = folder.path + "/";
  const recursiveCount = notes.reduce(
    (acc, n) => (n.folderPath === folder.path || n.folderPath.startsWith(prefix) ? acc + 1 : acc),
    0,
  );

  // Click on the row → just SELECT. Never toggle. The chevron is the sole
  // affordance for expand/collapse so accidental clicks don't collapse a
  // folder the user just wanted to navigate to.
  const handleClick = () => {
    onSelectFolder(folder.path);
  };

  // Chevron click → toggle expand only. stopPropagation so the row's select
  // handler doesn't also fire (which would still be fine — selecting twice
  // is a no-op — but keeps the intent crisp).
  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(folder.path, !expanded);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    // Capture the click position now — the popover opens at the same spot
    // even though the menu closes between picking the entry and the user
    // seeing the popover.
    const px = e.clientX;
    const py = e.clientY;
    const synth = (kind: PickerKind) =>
      openPicker(kind, folder.path, {
        clientX: px,
        clientY: py,
        preventDefault: () => {},
      } as unknown as React.MouseEvent);

    // Always render the same menu shape regardless of which page is hosting
    // the FileTree. Renommer / Supprimer are no-ops when the parent didn't
    // wire a handler (shouldn't happen — both notes pages pass them today).
    const items: import("@supernote/ui").ContextMenuItemDef[] = [
      {
        key: "new-subfolder",
        label: "Créer un sous-dossier",
        icon: <FolderPlus size={14} />,
        onPress: () => {
          onNewFolder(folder.path);
          setExpanded(folder.path, true);
        },
      },
      {
        key: "new-note",
        label: "Nouvelle note ici",
        icon: <Plus size={14} />,
        onPress: () => {
          onNewNote(folder.path);
          setExpanded(folder.path, true);
        },
      },
      {
        key: "rename",
        label: "Renommer",
        icon: <PencilSimple size={14} />,
        isDisabled: !onRenameFolder,
        onPress: () => onRenameFolder?.(folder.path),
      },
      { key: "sep-customize", label: "", separator: true },
      {
        key: "change-color",
        label: "Changer la couleur",
        icon: <PaintBrush size={14} />,
        onPress: () => synth("color"),
      },
      {
        key: "change-icon",
        label: "Changer l'icône",
        icon: <Star size={14} />,
        onPress: () => synth("icon"),
      },
      { key: "sep-delete", label: "", separator: true },
      {
        key: "delete",
        label: "Supprimer le dossier et toutes ses notes",
        icon: <Trash size={14} />,
        isDanger: true,
        isDisabled: !onDeleteFolder,
        onPress: () => onDeleteFolder?.(folder.path),
      },
    ];
    openContextMenu(e, items);
  };

  // Resolve the icon component once per render. Selected folders show
  // `FolderOpen` only when no custom icon is set — once the user picks an
  // icon, it sticks regardless of selection state (consistent with the
  // intent of the customization).
  const CustomIcon = getFolderIcon(folder.icon);
  const IconComponent =
    folder.icon ? CustomIcon : isSelected ? FolderOpen : Folder;
  // Prefer the explicit folder color; falls through to the selection-aware
  // default so legacy folders (no color set) still pick up the accent.
  const iconColor =
    folder.color ?? (isSelected ? "var(--accent)" : "var(--text-secondary)");

  // When the selected row has a custom color, derive per-row accent vars so
  // the highlight uses the folder's own color instead of the global accent.
  const selectedAccent = isSelected ? folderAccentVars(folder.color) : null;
  const selectedBg = selectedAccent
    ? selectedAccent["--accent-subtle"]
    : isSelected ? "var(--accent-subtle)" : undefined;
  const selectedFg = selectedAccent
    ? selectedAccent["--accent"]
    : isSelected ? "var(--accent)" : "var(--text-secondary)";

  return (
    <div>
      <div
        className="group relative flex items-center"
        onContextMenu={handleContextMenu}
      >
        <button
          onClick={handleClick}
          className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors"
          style={{
            paddingLeft: `${8 + depth * 16}px`,
            backgroundColor: selectedBg,
            color: selectedFg,
            fontWeight: isSelected ? 500 : 400,
          }}
          onMouseEnter={(e) => {
            if (!isSelected) {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--surface-2)";
            }
          }}
          onMouseLeave={(e) => {
            if (!isSelected) {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = "";
            }
          }}
        >
          <span
            className="flex w-4 flex-shrink-0 items-center justify-center"
            // The chevron is a span (inside a button) rather than a nested
            // <button> because nested buttons are invalid HTML. We attach
            // an onClick + role="button" + stopPropagation so it behaves
            // like one without the validation warning.
            role={hasChildren ? "button" : undefined}
            aria-label={hasChildren ? (expanded ? "Réduire" : "Développer") : undefined}
            onClick={hasChildren ? handleChevronClick : undefined}
            style={hasChildren ? { cursor: "pointer" } : undefined}
          >
            {hasChildren ? (
              expanded ? <CaretDown size={12} /> : <CaretRight size={12} />
            ) : null}
          </span>
          <IconComponent size={14} color={iconColor} weight={folder.icon ? "fill" : "regular"} />
          <span className="flex-1 truncate text-left">{folder.name}</span>
          <span
            className="ml-1 flex-shrink-0 text-xs tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            ({recursiveCount})
          </span>
        </button>
      </div>

      {hasChildren && expanded && (
        <div>
          {folder.children!.map((child) => (
            <FolderNode
              key={child.path}
              folder={child}
              selectedFolder={selectedFolder}
              onSelectFolder={onSelectFolder}
              onNewFolder={onNewFolder}
              onNewNote={onNewNote}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              openContextMenu={openContextMenu}
              openPicker={openPicker}
              depth={depth + 1}
              notes={notes}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ActionButtonProps {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}

function ActionButton({ onClick, label, icon }: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
      style={{ color: "var(--text-muted)" }}
    >
      {icon}
    </button>
  );
}

// ── Color / icon picker popover ───────────────────────────────────────────────
//
// Single component handling both pickers because their layout (anchored at
// the click position, dismissed on outside-click / Escape) and their wire-
// through to `useUpdateFolder` are identical — only the inner grid differs.

interface FolderCustomizationPickerProps {
  state: PickerState | null;
  onClose: () => void;
}

function FolderCustomizationPicker({
  state,
  onClose,
}: FolderCustomizationPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { updateFolder, isPending } = useUpdateFolder();

  // Outside click + Escape dismiss the popover. We attach the handlers
  // imperatively (not React's onMouseDown) because the popover lives
  // outside its trigger's tree, so React's synthetic event ordering can't
  // help us here.
  useEffect(() => {
    if (!state) return;
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof MouseEvent &&
        ref.current &&
        !ref.current.contains(e.target as Node)
      ) {
        onClose();
      }
      if (e instanceof KeyboardEvent && e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handler);
    };
  }, [state, onClose]);

  if (!state) return null;

  const onPickColor = async (color: string | null) => {
    await updateFolder(state.path, { color });
    onClose();
  };
  const onPickIcon = async (icon: string | null) => {
    await updateFolder(state.path, { icon });
    onClose();
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={state.kind === "color" ? "Choisir une couleur" : "Choisir une icône"}
      style={{
        position: "fixed",
        top: state.y,
        left: state.x,
        zIndex: 1100,
        padding: 12,
        borderRadius: 10,
        border: "1px solid var(--border-subtle, #e5e7eb)",
        backgroundColor: "var(--surface-1, #ffffff)",
        boxShadow: "var(--shadow-lg, 0 10px 30px rgba(0,0,0,.18))",
        minWidth: state.kind === "color" ? 240 : 380,
        maxWidth: state.kind === "color" ? 320 : 400,
        opacity: isPending ? 0.7 : 1,
        pointerEvents: isPending ? "none" : "auto",
      }}
    >
      {state.kind === "color" ? (
        <ColorPickerGrid
          onPick={(color) => void onPickColor(color)}
          onReset={() => void onPickColor(null)}
        />
      ) : (
        <IconPickerGrid
          onPick={(icon) => void onPickIcon(icon)}
          onReset={() => void onPickIcon(null)}
        />
      )}
    </div>
  );
}

interface ColorPickerGridProps {
  onPick: (color: string) => void;
  onReset: () => void;
}

function ColorPickerGrid({ onPick, onReset }: ColorPickerGridProps) {
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: 8,
        }}
      >
        {FOLDER_COLOR_PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => onPick(color)}
            aria-label={`Couleur ${color}`}
            title={color}
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              backgroundColor: color,
              border: "2px solid var(--surface-1, #fff)",
              boxShadow: "0 0 0 1px var(--border-subtle, #e5e7eb)",
              cursor: "pointer",
              padding: 0,
            }}
          />
        ))}
      </div>
      <div
        style={{
          marginTop: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--text-secondary, #374151)",
            cursor: "pointer",
          }}
        >
          <input
            type="color"
            // Bypassing controlled state — `onChange` fires on every drag
            // tick which would spam the worker. We only commit on `onBlur`
            // (color picker closing) so a single update lands on the wire.
            defaultValue="#6366f1"
            onBlur={(e) => onPick(e.currentTarget.value)}
            style={{
              width: 28,
              height: 28,
              border: "1px solid var(--border-subtle, #e5e7eb)",
              borderRadius: 6,
              padding: 0,
              cursor: "pointer",
              background: "none",
            }}
          />
          Personnalisée
        </label>
        <button
          type="button"
          onClick={onReset}
          style={{
            fontSize: 12,
            color: "var(--text-muted, #6b7280)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px 8px",
            borderRadius: 6,
          }}
        >
          Réinitialiser
        </button>
      </div>
    </div>
  );
}

interface IconPickerGridProps {
  onPick: (icon: string) => void;
  onReset: () => void;
}

function IconPickerGrid({ onPick, onReset }: IconPickerGridProps) {
  const [query, setQuery] = useState("");

  // Case-insensitive substring filter on the icon `key`. We pre-build the
  // filtered category list so empty groups don't render an orphaned header.
  const filteredCategories = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return FOLDER_ICON_CATEGORIES;
    return FOLDER_ICON_CATEGORIES.map((category) => ({
      ...category,
      icons: category.icons.filter(({ key }) =>
        key.toLowerCase().includes(needle),
      ),
    })).filter((category) => category.icons.length > 0);
  }, [query]);

  return (
    <div style={{ width: 360 }}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        placeholder="Rechercher une icône…"
        aria-label="Rechercher une icône"
        autoFocus
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "6px 10px",
          fontSize: 13,
          border: "1px solid var(--border-subtle, #e5e7eb)",
          borderRadius: 6,
          backgroundColor: "var(--surface-1, #ffffff)",
          color: "var(--text-primary, #111827)",
          marginBottom: 8,
          outline: "none",
        }}
      />
      <div
        style={{
          maxHeight: 360,
          overflowY: "auto",
          paddingRight: 2,
        }}
      >
        {filteredCategories.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted, #6b7280)",
              padding: "16px 4px",
              textAlign: "center",
            }}
          >
            Aucune icône trouvée
          </div>
        ) : (
          filteredCategories.map((category) => (
            <div key={category.label} style={{ marginBottom: 10 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                  color: "var(--text-muted, #6b7280)",
                  padding: "4px 2px",
                }}
              >
                {category.label}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(8, 1fr)",
                  gap: 4,
                }}
              >
                {category.icons.map(({ key, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onPick(key)}
                    aria-label={`Icône ${key}`}
                    title={key}
                    style={{
                      width: 32,
                      height: 32,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 6,
                      border: "1px solid transparent",
                      backgroundColor: "transparent",
                      cursor: "pointer",
                      color: "var(--text-secondary, #374151)",
                    }}
                    onMouseEnter={(e) => {
                      (
                        e.currentTarget as HTMLButtonElement
                      ).style.backgroundColor = "var(--surface-2, #f3f4f6)";
                      (e.currentTarget as HTMLButtonElement).style.borderColor =
                        "var(--border-subtle, #e5e7eb)";
                    }}
                    onMouseLeave={(e) => {
                      (
                        e.currentTarget as HTMLButtonElement
                      ).style.backgroundColor = "transparent";
                      (e.currentTarget as HTMLButtonElement).style.borderColor =
                        "transparent";
                    }}
                  >
                    <Icon size={18} />
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <button
          type="button"
          onClick={onReset}
          style={{
            fontSize: 12,
            color: "var(--text-muted, #6b7280)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "4px 8px",
            borderRadius: 6,
          }}
        >
          Réinitialiser
        </button>
      </div>
    </div>
  );
}
