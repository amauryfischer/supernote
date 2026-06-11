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
  Plugs,
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
  DotsThree,
  DotsSixVertical,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "@heroui/react";
import type { Folder as FolderType } from "./fixtures";
import { useTranslations } from "next-intl";
import { ContextMenu, useContextMenu, useToast } from "@supernote/ui";
import { ConnectVaultModal } from "./ConnectVaultModal";
import { useUpdateFolder, useReorderFolders, useMoveFolder } from "./hooks";
import { trpc, trpcVanillaClient } from "@/lib/trpc/client";
import { folderAccentVars } from "@/lib/folderAccent";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type CollisionDetection,
  type Collision,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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

function readExpandedFromStorage(): Map<string, boolean> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    // Legacy format: string[] where presence = open. Migrate transparently.
    if (parsed.length === 0 || typeof parsed[0] === "string") {
      return new Map((parsed as string[]).map((p) => [p, true] as [string, boolean]));
    }
    // Current format: [string, boolean][]
    return new Map(
      (parsed as [unknown, unknown][]).filter(
        (e): e is [string, boolean] => typeof e[0] === "string" && typeof e[1] === "boolean",
      ),
    );
  } catch {
    return new Map();
  }
}

function writeExpandedToStorage(map: Map<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    const arr = Array.from(map.entries());
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

// ── Tree DnD helpers ──────────────────────────────────────────────────────────

/** Parent path of a folder path ("a/b/c" → "a/b", "a" → ""). */
function getParentPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Flatten all visible folders into a depth-first ordered array. */
function flattenVisibleFolders(
  folders: FolderType[],
  isExpanded: (path: string) => boolean,
  childOrders: Map<string, string[]>,
): FolderType[] {
  const result: FolderType[] = [];
  function visit(list: FolderType[], parentKey: string) {
    const order = childOrders.get(parentKey);
    const sorted = order
      ? [...list].sort((a, b) => {
          const ia = order.indexOf(a.path);
          const ib = order.indexOf(b.path);
          return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
        })
      : list;
    for (const f of sorted) {
      result.push(f);
      if (f.children?.length && isExpanded(f.path)) visit(f.children, f.path);
    }
  }
  visit(folders, "");
  return result;
}

/** Get sibling paths for a given folder (same parent, in current order). */
function getSiblingPaths(
  path: string,
  rootFolders: FolderType[],
  childOrders: Map<string, string[]>,
): string[] {
  const parent = getParentPath(path);
  function findChildren(list: FolderType[], targetParent: string): FolderType[] | null {
    for (const f of list) {
      if (f.path === targetParent) return f.children ?? [];
      if (f.children) {
        const found = findChildren(f.children, targetParent);
        if (found !== null) return found;
      }
    }
    return null;
  }
  const siblings = parent === "" ? rootFolders : (findChildren(rootFolders, parent) ?? []);
  const order = childOrders.get(parent);
  if (!order) return siblings.map((f) => f.path);
  return [...siblings]
    .sort((a, b) => {
      const ia = order.indexOf(a.path);
      const ib = order.indexOf(b.path);
      return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
    })
    .map((f) => f.path);
}

/**
 * Custom collision detection for the folder tree.
 *
 * Two outcomes only:
 *   "nest:path"  — pointer is in the middle 40% of a folder → drop INTO it.
 *   "path"       — pointer is at the top/bottom of a SIBLING folder → reorder.
 *
 * Cross-level, non-center hovers return [] so the active item stays in place
 * visually instead of jumping to an unrelated position in the flat DOM order.
 */
const folderTreeCollision: CollisionDetection = ({ active, droppableContainers, pointerCoordinates }) => {
  if (!pointerCoordinates) return [];
  const { y: py } = pointerCoordinates;
  const activePath = String(active.id);
  const activeParent = getParentPath(activePath);

  const nestHits: Collision[] = [];
  const sortHits: Collision[] = [];
  const reparentHits: Collision[] = [];

  for (const container of droppableContainers) {
    const rect = container.rect.current;
    if (!rect || py < rect.top || py > rect.bottom) continue;

    const id = String(container.id);
    if (id.startsWith("nest:")) {
      const targetPath = id.slice(5);
      if (
        targetPath === activePath ||
        targetPath.startsWith(activePath + "/") ||
        targetPath === activeParent
      ) continue;
      const relY = (py - rect.top) / rect.height;
      if (relY >= 0.3 && relY <= 0.7) nestHits.push({ id, data: { droppableContainer: container } });
    } else if (id.startsWith("reparent:")) {
      // Edge zone (top/bottom 30%) on a folder with a different parent → reparent.
      const targetPath = id.slice(9);
      const targetParent = getParentPath(targetPath);
      if (targetParent === activeParent) continue; // same level → sort handles it
      if (targetPath === activePath || targetPath.startsWith(activePath + "/")) continue;
      const relY = (py - rect.top) / rect.height;
      if (relY < 0.3 || relY > 0.7) reparentHits.push({ id, data: { droppableContainer: container } });
    } else {
      // Sort: same-parent siblings only (no cross-level visual jumps).
      if (getParentPath(id) === activeParent && id !== activePath) {
        sortHits.push({ id, data: { droppableContainer: container } });
      }
    }
  }

  return nestHits.length > 0 ? nestHits : sortHits.length > 0 ? sortHits : reparentHits;
};

// ── FolderDndContext — shared drag state ──────────────────────────────────────

interface FolderDndContextValue {
  nestTarget: string | null;
  reparentTarget: string | null;
  childOrders: Map<string, string[]>;
}

const FolderDndContext = createContext<FolderDndContextValue>({
  nestTarget: null,
  reparentTarget: null,
  childOrders: new Map(),
});

// ── FileTreeProps ──────────────────────────────────────────────────────────────

interface FileTreeProps {
  folders: FolderType[];
  selectedFolder: string | null;
  onSelectFolder: (path: string) => void;
  /** Create a new folder. When `parentPath` is provided, nest inside it. */
  onNewFolder: (parentPath?: string | null) => void;
  /** Create a new note. When `parentPath` is provided, place it inside that folder. */
  onNewNote: (parentPath?: string | null) => void;
  /** Right-click → "Renommer" (opens a prompt modal). Optional; menu item hidden when absent. */
  onRenameFolder?: (path: string) => void;
  /**
   * Inline double-click rename callback. Receives (oldPath, newLeafName) and
   * must resolve once the rename is committed. Returning a rejected promise
   * triggers a toast error and the title reverts.
   */
  onRenameFolderInline?: (oldPath: string, newName: string) => Promise<void>;
  /** Right-click → "Supprimer le dossier et toutes ses notes". */
  onDeleteFolder?: (path: string) => void;
  /** Right-click → "Archiver le dossier" (bulk-archive every note inside). */
  onArchiveFolder?: (path: string) => Promise<{ archivedCount: number }>;
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
  /**
   * Called when the user drops a note (dragged from the NoteList) onto a
   * folder. Receives the note ID and the target folder path.
   */
  onDropNote?: (noteId: string, folderPath: string) => void;
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
  onRenameFolderInline,
  onDeleteFolder,
  onArchiveFolder,
  notes,
  onCollapse,
  onDropNote,
}: FileTreeProps) {
  const t = useTranslations("notes");
  // Single context-menu state shared by every FolderNode — only one can be
  // open at a time anyway, and the ContextMenu element lives at the FileTree
  // root so it can render above the scroll container without clipping.
  const ctx = useContextMenu();

  const [connectVaultOpen, setConnectVaultOpen] = useState(false);

  const [picker, setPicker] = useState<PickerState | null>(null);
  const openPicker = (kind: PickerKind, path: string, e: React.MouseEvent) => {
    setPicker({ kind, path, x: e.clientX, y: e.clientY });
  };
  const closePicker = () => setPicker(null);

  // Persisted expanded-folder map. Keys are folder paths; values are explicit
  // booleans (true = open, false = closed). Absence means "use default"
  // (root folders open, sub-folders closed). Using a Map instead of a Set
  // lets us distinguish "explicitly closed by the user" from "never seen yet"
  // — a Set can only represent the open state, so removing a root folder from
  // it would incorrectly fall back to the "default open" rule.
  const [expandedMap, setExpandedMap] = useState<Map<string, boolean>>(() => {
    if (typeof window === "undefined") return new Map();
    const stored = readExpandedFromStorage();
    if (stored.size > 0) return stored;
    // First ever visit: seed root-level folders as explicitly open.
    const seed = new Map<string, boolean>();
    for (const folder of folders) {
      if (!folder.path.includes("/")) seed.set(folder.path, true);
    }
    return seed;
  });

  // Whenever the root folder list changes, make sure NEW root-level folders
  // default to expanded. Folders already tracked in the map keep whatever
  // state the user chose; only truly unseen folders get the soft default.
  const seededRootsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const candidates = folders
      .filter((f) => !f.path.includes("/") && !seededRootsRef.current.has(f.path))
      .map((f) => f.path);
    if (candidates.length === 0) return;
    for (const path of candidates) seededRootsRef.current.add(path);
    setExpandedMap((prev) => {
      let mutated = false;
      const next = new Map(prev);
      for (const path of candidates) {
        if (!next.has(path)) {
          next.set(path, true);
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [folders]);

  // Persist on every change.
  useEffect(() => {
    writeExpandedToStorage(expandedMap);
  }, [expandedMap]);

  const setExpanded = useCallback((path: string, value: boolean) => {
    setExpandedMap((prev) => {
      if (prev.get(path) === value) return prev;
      const next = new Map(prev);
      next.set(path, value);
      return next;
    });
  }, []);

  const expandPath = useCallback((path: string) => {
    if (!path) return;
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) return;
    setExpandedMap((prev) => {
      const next = new Map(prev);
      let acc = "";
      let mutated = false;
      for (const seg of segments) {
        acc = acc ? `${acc}/${seg}` : seg;
        if (next.get(acc) !== true) {
          next.set(acc, true);
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, []);

  const isExpanded = useCallback((path: string) => {
    const explicit = expandedMap.get(path);
    // Explicit value set by the user always wins.
    if (explicit !== undefined) return explicit;
    // Default: root-level folders open, deeper folders closed.
    return !path.includes("/");
  }, [expandedMap]);

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

  // ── Unified folder DnD (reorder + reparent) ───────────────────────────────
  // A single DndContext wraps the entire tree so folders can be dragged
  // across levels. `childOrders` replaces the old per-node `localChildOrder`
  // states; key "" = root, key "a/b" = children of folder "a/b".
  const { reorderFolders } = useReorderFolders();
  const { moveFolder } = useMoveFolder();
  const [childOrders, setChildOrders] = useState<Map<string, string[]>>(new Map());
  const [nestTarget, setNestTarget] = useState<string | null>(null);
  const [reparentTarget, setReparentTarget] = useState<string | null>(null);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const orderedFolders = useMemo(() => {
    const order = childOrders.get("");
    if (!order) return folders;
    const idx = new Map(order.map((p, i) => [p, i]));
    return [...folders].sort((a, b) => {
      const ia = idx.get(a.path) ?? Infinity;
      const ib = idx.get(b.path) ?? Infinity;
      return ia !== ib ? ia - ib : a.path.localeCompare(b.path);
    });
  }, [folders, childOrders]);

  // Inbox is pinned to the top of the tree, visually separated from user
  // folders by a divider. We split it out of the sortable list so it can't
  // be dragged around with the rest.
  const inboxFolder = useMemo(
    () => orderedFolders.find((f) => f.path === "Inbox") ?? null,
    [orderedFolders],
  );
  const otherFolders = useMemo(
    () => orderedFolders.filter((f) => f.path !== "Inbox"),
    [orderedFolders],
  );

  const handleDragStart = useCallback((_event: DragStartEvent) => {
    setNestTarget(null);
    setReparentTarget(null);
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over ? String(event.over.id) : null;
    if (overId?.startsWith("nest:")) {
      setNestTarget(overId.slice(5));
      setReparentTarget(null);
    } else if (overId?.startsWith("reparent:")) {
      setNestTarget(null);
      setReparentTarget(overId.slice(9));
    } else {
      setNestTarget(null);
      setReparentTarget(null);
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      setNestTarget(null);
      setReparentTarget(null);
      if (!over || active.id === over.id) return;

      const activePath = String(active.id);
      const overId = String(over.id);

      if (overId.startsWith("nest:")) {
        // Drop INTO another folder.
        const targetPath = overId.slice(5);
        const leaf = activePath.split("/").pop()!;
        void moveFolder(activePath, `${targetPath}/${leaf}`);
        setExpanded(targetPath, true);
        return;
      }

      if (overId.startsWith("reparent:")) {
        // Drop ADJACENT to another folder → move to that folder's parent level.
        const siblingPath = overId.slice(9);
        const newParent = getParentPath(siblingPath);
        const leaf = activePath.split("/").pop()!;
        const newPath = newParent ? `${newParent}/${leaf}` : leaf;
        void moveFolder(activePath, newPath);
        if (newParent) setExpanded(newParent, true);
        return;
      }

      // Sort: same-parent siblings (collision guarantees this).
      const activeParent = getParentPath(activePath);
      const siblings = getSiblingPaths(activePath, orderedFolders, childOrders);
      const oldIdx = siblings.indexOf(activePath);
      const newIdx = siblings.indexOf(overId);
      if (oldIdx === -1 || newIdx === -1) return;
      const next = arrayMove(siblings, oldIdx, newIdx);
      const prev = [...siblings];
      setChildOrders((m) => new Map(m).set(activeParent, next));
      void reorderFolders(next).catch(() =>
        setChildOrders((m) => new Map(m).set(activeParent, prev)),
      );
    },
    [orderedFolders, childOrders, reorderFolders, moveFolder, setExpanded],
  );

  return (
    <aside
      className="flex h-full w-full flex-col border-r md:w-[280px] md:min-w-[280px]"
      style={{
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
          <ActionButton
            onClick={() => setConnectVaultOpen(true)}
            label="Connecter un vault"
            icon={<Plugs size={13} />}
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
        <FolderDndContext.Provider value={{ nestTarget, reparentTarget, childOrders }}>
          <DndContext
            sensors={dndSensors}
            collisionDetection={folderTreeCollision}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <nav className="flex-1 overflow-y-auto p-2">
              {inboxFolder && (
                <>
                  <SortableContext
                    items={[inboxFolder.path]}
                    strategy={verticalListSortingStrategy}
                  >
                    <FolderNode
                      key={inboxFolder.path}
                      folder={inboxFolder}
                      selectedFolder={selectedFolder}
                      onSelectFolder={onSelectFolder}
                      onNewFolder={onNewFolder}
                      onNewNote={onNewNote}
                      onRenameFolder={onRenameFolder}
                      onRenameFolderInline={onRenameFolderInline}
                      onDeleteFolder={onDeleteFolder}
                      onArchiveFolder={onArchiveFolder}
                      openContextMenu={ctx.open}
                      openPicker={openPicker}
                      depth={0}
                      notes={notes}
                      onDropNote={onDropNote}
                      isPinned
                    />
                  </SortableContext>
                  {otherFolders.length > 0 && (
                    <div
                      className="my-2 border-t"
                      style={{ borderColor: "var(--border-subtle)" }}
                      aria-hidden
                    />
                  )}
                </>
              )}
              <SortableContext
                items={otherFolders.map((f) => f.path)}
                strategy={verticalListSortingStrategy}
              >
                {otherFolders.map((folder) => (
                  <FolderNode
                    key={folder.path}
                    folder={folder}
                    selectedFolder={selectedFolder}
                    onSelectFolder={onSelectFolder}
                    onNewFolder={onNewFolder}
                    onNewNote={onNewNote}
                    onRenameFolder={onRenameFolder}
                    onRenameFolderInline={onRenameFolderInline}
                    onDeleteFolder={onDeleteFolder}
                    onArchiveFolder={onArchiveFolder}
                    openContextMenu={ctx.open}
                    openPicker={openPicker}
                    depth={0}
                    notes={notes}
                    onDropNote={onDropNote}
                  />
                ))}
              </SortableContext>
            </nav>
          </DndContext>
        </FolderDndContext.Provider>
      </ExpandedContext.Provider>

      <ContextMenu state={ctx.state} onClose={ctx.close} />
      <FolderCustomizationPicker state={picker} onClose={closePicker} />
      <ConnectVaultModal isOpen={connectVaultOpen} onOpenChange={setConnectVaultOpen} />

      <div
        className="border-t p-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <Button
          variant="ghost"
          size="sm"
          onPress={() => onNewFolder(null)}
          className="w-full justify-start gap-2 rounded-md px-3 text-xs hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-muted)" }}
        >
          <Plus size={12} />
          {t("newFolder")}
        </Button>
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
  onRenameFolderInline?: (oldPath: string, newName: string) => Promise<void>;
  onDeleteFolder?: (path: string) => void;
  onArchiveFolder?: (path: string) => Promise<{ archivedCount: number }>;
  openContextMenu: (
    e: React.MouseEvent,
    items: import("@supernote/ui").ContextMenuItemDef[],
  ) => void;
  openPicker: (kind: PickerKind, path: string, e: React.MouseEvent) => void;
  depth: number;
  notes: { folderPath: string }[];
  onDropNote?: (noteId: string, folderPath: string) => void;
  /** When true, hide the drag handle (used for the pinned Inbox row). */
  isPinned?: boolean;
}

function FolderNode({
  folder,
  selectedFolder,
  onSelectFolder,
  onNewFolder,
  onNewNote,
  onRenameFolder,
  onRenameFolderInline,
  onDeleteFolder,
  onArchiveFolder,
  openContextMenu,
  openPicker,
  depth,
  notes,
  onDropNote,
  isPinned = false,
}: FolderNodeProps) {
  const hasChildren = !!folder.children?.length;
  // Expanded state is hoisted to FileTree (persisted in localStorage) so it
  // survives tree refetches, sibling additions, and full reloads. See
  // ExpandedContext above.
  const { isExpanded, setExpanded } = useExpanded();
  const expanded = isExpanded(folder.path);
  const isSelected = selectedFolder === folder.path;
  const { toast } = useToast();
  const utils = trpc.useUtils();
  // Track inline rename pending state to block single-click navigation during edit.
  const [isRenaming, setIsRenaming] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── DnD wiring (single context at FileTree level) ────────────────────────
  // All folders participate in the single top-level SortableContext for
  // reordering AND in their own "nest:" / "reparent:" droppable zones.
  const { nestTarget, reparentTarget, childOrders } = useContext(FolderDndContext);
  const isNestTarget = nestTarget === folder.path;
  const isReparentTarget = reparentTarget === folder.path;

  const orderedChildren = useMemo(() => {
    const kids = folder.children ?? [];
    const order = childOrders.get(folder.path);
    if (!order) return kids;
    const idx = new Map(order.map((p, i) => [p, i]));
    return [...kids].sort(
      (a, b) => (idx.get(a.path) ?? Infinity) - (idx.get(b.path) ?? Infinity),
    );
  }, [folder.children, folder.path, childOrders]);

  const {
    attributes: sortableAttributes,
    listeners: sortableListeners,
    setNodeRef: sortableNodeRef,
    transform: sortableTransform,
    transition: sortableTransition,
    isDragging: isSortDragging,
  } = useSortable({ id: folder.path });

  // "nest:" droppable — center 30-70% zone → drop INTO this folder.
  const { setNodeRef: nestNodeRef } = useDroppable({ id: `nest:${folder.path}` });
  // "reparent:" droppable — edge zones (top/bottom 30%) when crossing parent levels.
  const { setNodeRef: reparentRef } = useDroppable({ id: `reparent:${folder.path}` });

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
  // While the inline rename input is active, block navigation so clicking
  // elsewhere (which causes blur → commit) doesn't also navigate.
  const handleClick = () => {
    if (isRenaming) return;
    onSelectFolder(folder.path);
  };

  const handleInlineRename = async (newName: string) => {
    if (!onRenameFolderInline) return;
    setIsRenaming(false);
    try {
      await onRenameFolderInline(folder.path, newName);
    } catch {
      toast({ title: "Impossible de renommer le dossier", variant: "danger" });
    }
  };

  // Chevron click → toggle expand only. stopPropagation so the row's select
  // handler doesn't also fire (which would still be fine — selecting twice
  // is a no-op — but keeps the intent crisp).
  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(folder.path, !expanded);
  };

  // Build the list of actions once — reused by the right-click handler AND
  // the visible "..." button below. Keeping a single source of truth means
  // the two surfaces never drift apart.
  const buildMenuItems = (point: {
    clientX: number;
    clientY: number;
  }): import("@supernote/ui").ContextMenuItemDef[] => {
    const synth = (kind: PickerKind) =>
      openPicker(kind, folder.path, {
        ...point,
        preventDefault: () => {},
      } as unknown as React.MouseEvent);
    return [
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
        key: "archive",
        label: "Archiver le dossier",
        icon: <Archive size={14} />,
        isDisabled: !onArchiveFolder,
        onPress: () => void onArchiveFolder?.(folder.path),
      },
      {
        key: "delete",
        label: "Supprimer le dossier et toutes ses notes",
        icon: <Trash size={14} />,
        isDanger: true,
        isDisabled: !onDeleteFolder,
        onPress: () => onDeleteFolder?.(folder.path),
      },
    ];
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    openContextMenu(e, buildMenuItems({ clientX: e.clientX, clientY: e.clientY }));
  };

  // ── Desktop file drag-drop ─────────────────────────────────────────────────
  //
  // Sanitize a filename: strip characters forbidden on major OSes / URLs, then
  // trim whitespace. Extension is preserved.
  const sanitizeFilename = (name: string): string =>
    name.replace(/[/\\<>:"|?*]/g, "").trim();

  // Write each dropped file into the vault folder, then reindex + invalidate.
  const handleFilesDrop = useCallback(
    async (files: FileList): Promise<void> => {
      const results = await Promise.allSettled(
        Array.from(files).map(async (file) => {
          const safeName = sanitizeFilename(file.name);
          if (!safeName) throw new Error(`Nom de fichier invalide : "${file.name}"`);
          const path = folder.path ? `${folder.path}/${safeName}` : safeName;
          const bytes = await file.arrayBuffer();
          await trpcVanillaClient.vault.writeFile.mutate({ path, bytes });
          return safeName;
        }),
      );
      for (const r of results) {
        if (r.status === "fulfilled") {
          toast({ title: `Importé : ${r.value}`, variant: "success" });
        } else {
          const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
          toast({ title: `Erreur import : ${msg}`, variant: "danger" });
        }
      }
      // Trigger background reindex via raw worker postMessage (vault.reindex
      // is in the worker dispatch table but not in the typed IPC router).
      try {
        const worker = (window as { __supernoteWorker?: Worker }).__supernoteWorker;
        if (worker) {
          worker.postMessage({ id: `rpc-filedrop-${Date.now()}`, path: "vault.reindex", type: "mutation", input: undefined });
        }
      } catch {
        // Best-effort — invalidation below will still surface new files.
      }
      void utils.entities.list.invalidate();
    },
    [folder.path, toast, utils],
  );

  const handleDragOver = (e: React.DragEvent) => {
    // Accept native file drops OR note-card drags (text/plain).
    const hasFiles = e.dataTransfer.types.includes("Files");
    const hasNote = e.dataTransfer.types.includes("text/plain");
    if (!hasFiles && !hasNote) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = hasFiles ? "copy" : "move";
    const innerFolder = (e.target as Element).closest("[data-folder-drop]");
    if (innerFolder && innerFolder !== e.currentTarget) {
      if (isDragOver) setIsDragOver(false);
      return;
    }
    if (!isDragOver) {
      setIsDragOver(true);
      if (hasChildren && !expanded) {
        dragExpandTimerRef.current = setTimeout(() => {
          setExpanded(folder.path, true);
        }, 600);
      }
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
      if (dragExpandTimerRef.current) {
        clearTimeout(dragExpandTimerRef.current);
        dragExpandTimerRef.current = null;
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (dragExpandTimerRef.current) {
      clearTimeout(dragExpandTimerRef.current);
      dragExpandTimerRef.current = null;
    }
    // Native file drop takes priority over note-card drag.
    if (e.dataTransfer.files.length > 0) {
      void handleFilesDrop(e.dataTransfer.files);
      return;
    }
    const noteId = e.dataTransfer.getData("text/plain");
    if (noteId && onDropNote) onDropNote(noteId, folder.path);
  };

  const handleActionsClick = (e: React.MouseEvent) => {
    // Stop here so the row's onClick (folder selection) doesn't also fire.
    e.stopPropagation();
    e.preventDefault();
    openContextMenu(e, buildMenuItems({ clientX: e.clientX, clientY: e.clientY }));
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

  // At depth=0 the drag handle (left-0.5 + w-4 = x:2-18px) would overlap the
  // chevron if paddingLeft were only 8px. Reserve 20px so the chevron starts
  // at x=20px. At depth≥1, paddingLeft ≥ 24px already clears the handle.
  const sharedRowStyle: React.CSSProperties = {
    paddingLeft: `${(depth === 0 ? 20 : 8) + depth * 16}px`,
    backgroundColor: selectedBg,
    color: selectedFg,
    fontWeight: isSelected ? 500 : 400,
  };

  const chevronSpan = (
    <span
      className="flex w-4 flex-shrink-0 items-center justify-center"
      role={hasChildren ? "button" : undefined}
      aria-label={hasChildren ? (expanded ? "Réduire" : "Développer") : undefined}
      onClick={hasChildren ? handleChevronClick : undefined}
      style={hasChildren ? { cursor: "pointer" } : undefined}
    >
      {hasChildren ? (
        // Single caret that rotates 90° on expand instead of swapping icons —
        // a continuous decel glide reads as the disclosure "turning open".
        // reduced-motion is honoured by .sn-motion-glide's transition-only
        // degrade (transform target is identical, so it just snaps).
        <span
          className="sn-motion-glide flex items-center justify-center"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          <CaretRight size={12} />
        </span>
      ) : null}
    </span>
  );

  const sortableDndStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(sortableTransform),
    transition: sortableTransition,
    opacity: isSortDragging ? 0.4 : 1,
    zIndex: isSortDragging ? 10 : undefined,
  };

  return (
    <div
      ref={sortableNodeRef}
      data-folder-drop={folder.path}
      style={sortableDndStyle}
      {...sortableAttributes}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        ref={(el) => { nestNodeRef(el); reparentRef(el); }}
        // .sn-motion-colors → the drop-target tint (background-color) eases in
        // and settles on the shared token instead of snapping, and self-
        // degrades to instant under reduced-motion. The outline stays crisp
        // (instant) so the drop boundary is never ambiguous mid-glide.
        className="sn-motion-colors group relative flex items-center"
        onContextMenu={handleContextMenu}
        style={{
          borderRadius: "6px",
          outlineStyle: isReparentTarget ? "dashed" : "solid",
          outlineWidth: "2px",
          outlineColor:
            isNestTarget || isReparentTarget || isDragOver
              ? "var(--accent)"
              : "transparent",
          outlineOffset: isReparentTarget ? "2px" : "-1px",
          backgroundColor:
            isNestTarget || isDragOver ? "var(--accent-subtle)" : "transparent",
        }}
      >
        {/* Drag handle — visible on hover for all folders except pinned ones */}
        {hovered && !isPinned && (
          <button
            {...sortableListeners}
            aria-label="Réordonner le dossier"
            className="absolute left-0.5 top-1/2 -translate-y-1/2 flex h-5 w-4 items-center justify-center rounded cursor-grab active:cursor-grabbing"
            style={{ color: "var(--text-muted)", zIndex: 1 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <DotsSixVertical size={12} />
          </button>
        )}
        {/* Row: in edit mode switch the button for a plain div to avoid
            <input> inside <button> (invalid HTML per spec). The InlineFolderRenameInput
            is a small self-contained component that handles focus, commit, cancel. */}
        {isRenaming ? (
          <div
            className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm"
            style={sharedRowStyle}
          >
            {chevronSpan}
            <IconComponent size={14} color={iconColor} weight={folder.icon ? "fill" : "regular"} />
            <InlineFolderRenameInput
              initialValue={folder.name}
              onCommit={handleInlineRename}
              onCancel={() => setIsRenaming(false)}
            />
          </div>
        ) : (
          <button
            onClick={handleClick}
            // .sn-motion-colors → tokenized bg/color/border glide (replaces the
            // untokenized Tailwind `transition-colors`). Drives BOTH the
            // selection highlight (when selectedBg/selectedFg change) and the
            // imperative hover bg below, on the caret's standard easing.
            className="sn-motion-colors flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm"
            style={sharedRowStyle}
            onMouseEnter={(e) => {
              if (!isSelected) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--surface-2)";
            }}
            onMouseLeave={(e) => {
              if (!isSelected) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "";
            }}
          >
            {chevronSpan}
            <IconComponent size={14} color={iconColor} weight={folder.icon ? "fill" : "regular"} />
            <span
              className="flex-1 truncate text-left"
              onDoubleClick={onRenameFolderInline ? (e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsRenaming(true);
              } : undefined}
              onKeyDown={onRenameFolderInline ? (e) => {
                if (e.key === "F2") { e.preventDefault(); setIsRenaming(true); }
              } : undefined}
              tabIndex={onRenameFolderInline ? 0 : undefined}
            >
              {folder.name}
            </span>
            <span
              className="ml-1 flex-shrink-0 text-xs tabular-nums"
              style={{ color: "var(--text-muted)" }}
            >
              ({recursiveCount})
            </span>
          </button>
        )}

        {/* Visible on hover — surfaces the same actions as the right-click
            menu (the parent row already has `group` so this works without
            extra hover state in React). Lives outside the <button> because
            nested buttons are invalid HTML; absolute-positioned over the
            count so it never widens the row. */}
        {!isRenaming && (
          <button
            type="button"
            onClick={handleActionsClick}
            onContextMenu={handleActionsClick}
            aria-label="Actions du dossier"
            title="Actions"
            // Justified native: context-menu positioning requires clientX/clientY.
            className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-muted)] opacity-0 shadow-sm transition-opacity hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] focus:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <DotsThree size={14} weight="bold" />
          </button>
        )}
      </div>

      {hasChildren && expanded && (
        // `.sn-tree-expand` plays a one-shot grid-rows unfold on mount so
        // opening a folder slides its children in instead of snapping
        // (collapse stays instant — children unmount, keeping DnD contexts
        // clean). See globals.css.
        <div className="sn-tree-expand">
          <div className="sn-tree-expand__inner">
          {/* SortableContext per level — shared DndContext is at FileTree root.
              This prevents cross-level sort animations: verticalListSortingStrategy
              only displaces items within its own context, never items in sibling
              or ancestor contexts, so dragging across depths causes no visual jump. */}
          <SortableContext
            id={folder.path}
            items={orderedChildren.map((c) => c.path)}
            strategy={verticalListSortingStrategy}
          >
            {orderedChildren.map((child) => (
              <FolderNode
                key={child.path}
                folder={child}
                selectedFolder={selectedFolder}
                onSelectFolder={onSelectFolder}
                onNewFolder={onNewFolder}
                onNewNote={onNewNote}
                onRenameFolder={onRenameFolder}
                onRenameFolderInline={onRenameFolderInline}
                onDeleteFolder={onDeleteFolder}
                onArchiveFolder={onArchiveFolder}
                openContextMenu={openContextMenu}
                openPicker={openPicker}
                depth={depth + 1}
                notes={notes}
                onDropNote={onDropNote}
              />
            ))}
          </SortableContext>
          </div>
        </div>
      )}
    </div>
  );
}

// ── InlineFolderRenameInput ───────────────────────────────────────────────────

interface InlineFolderRenameInputProps {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

function InlineFolderRenameInput({ initialValue, onCommit, onCancel }: InlineFolderRenameInputProps) {
  const [draft, setDraft] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    const trimmed = draft.trim().replace(/[/\\]/g, "").replace(/\.\./g, "");
    if (!trimmed) { onCancel(); return; }
    onCommit(trimmed);
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
      className="flex-1 min-w-0 rounded px-1 text-sm outline-none ring-1 ring-[var(--accent)]"
      style={{ color: "var(--text-primary)", backgroundColor: "var(--surface-1)" }}
      aria-label="Renommer le dossier"
    />
  );
}

interface ActionButtonProps {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}

function ActionButton({ onClick, label, icon }: ActionButtonProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      isIconOnly
      onPress={onClick}
      aria-label={label}
      className="h-6 w-6 min-w-0 rounded-md hover:bg-[var(--surface-2)]"
      style={{ color: "var(--text-muted)" }}
    >
      {icon}
    </Button>
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
          <Button
            key={color}
            onPress={() => onPick(color)}
            aria-label={`Couleur ${color}`}
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
        <Button
          onPress={onReset}
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
        </Button>
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
      <Input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
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
                  <Button
                    key={key}
                    onPress={() => onPick(key)}
                    aria-label={`Icône ${key}`}
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
                  </Button>
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
        <Button
          onPress={onReset}
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
        </Button>
      </div>
    </div>
  );
}
