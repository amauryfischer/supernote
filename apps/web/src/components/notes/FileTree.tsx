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
  CloudArrowDown,
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
  FileText,
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
  Graph,
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
  Paperclip,
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
  DotsSixVertical,
} from "@phosphor-icons/react";
import { CustomFolderGlyph } from "./CustomFolderGlyph";
import { IconPickerGrid } from "./FolderIconPickerGrid";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "@heroui/react";
import type { Folder as FolderType } from "./fixtures";
import { useTranslations } from "next-intl";
import { ContextMenu, useContextMenu, useToast, type ContextMenuItemDef } from "@supernote/ui";
import { ConnectVaultModal } from "./ConnectVaultModal";
import { useUpdateFolder, useReorderFolders, useMoveFolder } from "./hooks";
import { trpc, trpcVanillaClient } from "@/lib/trpc/client";
import { folderAccentVars } from "@/lib/folderAccent";
import { useConfirm } from "@/hooks/usePrompt";
import { useLongPress } from "@/hooks/useLongPress";
import { GOOGLE_DOC_KINDS, type GoogleDocKind } from "@/lib/google-drive";
import { DRIVE_DOC_ICONS, DRIVE_DOC_ORDER } from "./driveDocMeta";
import {
  cloudRoomSlug,
  cloudVaultId,
  MOUNT_PATH_PREFIX,
  normalizeServerUrl,
  normalizeVaultKey,
} from "@/lib/online-sync/room-id";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
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
import { isAttachmentPath } from "@/lib/attachments-path";

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

/**
 * Crée un Google Doc/Sheet/Slides dans un dossier donné, ou `null` si Google
 * Drive n'est pas connecté. Fourni à la racine du FileTree pour éviter de
 * câbler le handler à travers chaque `FolderNode` récursif — la simple présence
 * d'une valeur non-null sert de gate : pas connecté → pas d'items « Nouveau
 * Google … » dans les menus contextuels.
 */
const NewDriveDocContext = createContext<
  ((kind: GoogleDocKind, parent: string) => void) | null
>(null);


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

// ── Tree geometry (indentation + guides) ──────────────────────────────────────
//
// Une seule échelle pour tout l'arbre, dossiers ET notes :
//   • `ROW_INDENT_BASE` (20px) réserve la gouttière du drag-handle, qui est
//     positionné en absolu à gauche du conteneur de ligne quel que soit le
//     niveau — d'où un décalage constant, pas seulement au niveau 0.
//   • chaque niveau ajoute `ROW_INDENT_STEP` (16px), soit exactement la largeur
//     du chevron : un enfant démarre là où finit le chevron de son parent.
//
// Les guides visuels en découlent :
//   • `guideX(depth)` = axe du chevron du parent → trait vertical qui descend
//     le long de tous ses enfants,
//   • `elbowX(depth)` = même axe, vu depuis l'enfant → petit coude horizontal
//     qui raccroche la ligne au trait vertical de son parent.
const ROW_INDENT_BASE = 20;
const ROW_INDENT_STEP = 16;
/** Padding gauche du contenu d'une ligne à ce niveau. */
function rowPaddingLeft(depth: number): number {
  return ROW_INDENT_BASE + depth * ROW_INDENT_STEP;
}
/** Abscisse du trait vertical qui relie un dossier à ses enfants. */
function guideX(depth: number): number {
  return rowPaddingLeft(depth) + 8;
}
/** Abscisse du coude horizontal d'un enfant (= guide de son parent). */
function elbowX(depth: number): number {
  return guideX(depth - 1);
}

// ── Notes affichées dans l'arbre ──────────────────────────────────────────────
//
// L'arbre ne se contente plus des dossiers : chaque dossier déplié liste aussi
// ses notes directes (les sous-dossiers d'abord, puis les fichiers — convention
// explorateur de fichiers). Le contexte évite de faire descendre trois props de
// plus à travers la récursion de `FolderNode`.

/** Forme minimale consommée par l'arbre — `Note` de fixtures.ts la satisfait. */
export interface TreeNote {
  id: string;
  title: string;
  folderPath: string;
  fields?: Record<string, unknown>;
}

/**
 * Au-delà de ce nombre de notes directes, un dossier n'en affiche qu'un extrait
 * suivi d'une ligne « + N autres » qui bascule sur la liste centrale. Sans cap,
 * un dossier fourre-tout (Inbox à 400 notes) rendrait l'arbre inutilisable.
 */
const NOTES_PER_FOLDER_CAP = 50;

interface NoteTreeContextValue {
  /** Notes directes par chemin de dossier, déjà triées par titre. */
  notesByFolder: Map<string, TreeNote[]>;
  selectedNoteId: string | null;
  onSelectNote: ((id: string) => void) | null;
  /** Renommage inline (double-clic / F2 / menu contextuel). */
  onRenameNote: ((id: string, newTitle: string) => Promise<void>) | null;
  /** Suppression — le call-site est responsable de la confirmation. */
  onDeleteNote: ((id: string) => void) | null;
  onArchiveNote: ((id: string, archived: boolean) => Promise<void>) | null;
  /** Ouvre le menu contextuel partagé (état unique à la racine du FileTree). */
  openContextMenu: ((e: React.MouseEvent, items: ContextMenuItemDef[]) => void) | null;
  /**
   * Même menu, adressé en coordonnées viewport : c'est le chemin de l'appui
   * long tactile, qui n'a pas d'événement souris à passer. iOS n'émet jamais
   * `contextmenu`, donc sans ce point d'entrée le doigt n'aurait aucun accès
   * aux actions depuis que le bouton « … » a disparu des rangées.
   */
  openContextMenuAt: ((x: number, y: number, items: ContextMenuItemDef[]) => void) | null;
}

const NoteTreeContext = createContext<NoteTreeContextValue>({
  notesByFolder: new Map(),
  selectedNoteId: null,
  onSelectNote: null,
  onRenameNote: null,
  onDeleteNote: null,
  onArchiveNote: null,
  openContextMenu: null,
  openContextMenuAt: null,
});

/** Indexe les notes par dossier direct, chaque bucket trié par titre. */
function buildNotesByFolder(notes: ReadonlyArray<TreeNote>): Map<string, TreeNote[]> {
  const map = new Map<string, TreeNote[]>();
  for (const note of notes) {
    const bucket = map.get(note.folderPath);
    if (bucket) bucket.push(note);
    else map.set(note.folderPath, [note]);
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.title.localeCompare(b.title, "fr", { sensitivity: "base" }));
  }
  return map;
}

// ── Filtre de l'arbre ─────────────────────────────────────────────────────────
//
// Un coffre un peu vivant dépasse vite la hauteur du panneau, et l'arbre était
// la seule surface des notes sans champ de filtre — on n'y arrivait qu'à la
// molette. Le filtre porte sur les dossiers ET les fichiers, puisque l'arbre
// affiche les deux.
//
// Règle de conservation : une correspondance entraîne l'affichage de TOUS ses
// ancêtres. Sans ça, un résultat profond apparaîtrait déraciné, et on perdrait
// l'information qui fait la valeur d'un arbre — où la chose se trouve.

/** Repli insensible à la casse ET aux accents (le coffre est francophone). */
function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

interface TreeFilterValue {
  /** Requête repliée, vide quand le filtre est inactif. */
  query: string;
  /** Chemins de dossier à rendre (correspondances + leurs ancêtres). */
  folderPaths: Set<string>;
  /** Identifiants de note à rendre. */
  noteIds: Set<string>;
}

const INACTIVE_FILTER: TreeFilterValue = {
  query: "",
  folderPaths: new Set(),
  noteIds: new Set(),
};

const TreeFilterContext = createContext<TreeFilterValue>(INACTIVE_FILTER);

/**
 * Calcule l'ensemble des nœuds visibles pour une requête.
 *
 * Deux passes, pas de récursion sur l'arbre : on collecte d'abord les
 * correspondances directes (dossiers par leur nom de feuille, notes par leur
 * titre), puis on remonte chaque chemin segment par segment pour ajouter les
 * ancêtres. Un dossier qui correspond n'entraîne PAS ses descendants : filtrer
 * sert à réduire, et rouvrir tout un sous-arbre sur un mot annulerait le gain.
 */
function computeTreeFilter(
  query: string,
  folders: FolderType[],
  notes: ReadonlyArray<TreeNote>,
): TreeFilterValue {
  const needle = foldText(query.trim());
  if (!needle) return INACTIVE_FILTER;

  const folderPaths = new Set<string>();
  const noteIds = new Set<string>();

  /** Ajoute un chemin et toute sa chaîne de parents. */
  const keepWithAncestors = (path: string) => {
    const segments = path.split("/");
    for (let i = 1; i <= segments.length; i++) {
      folderPaths.add(segments.slice(0, i).join("/"));
    }
  };

  const walk = (list: FolderType[]) => {
    for (const folder of list) {
      if (foldText(folder.name).includes(needle)) keepWithAncestors(folder.path);
      if (folder.children) walk(folder.children);
    }
  };
  walk(folders);

  for (const note of notes) {
    if (!foldText(note.title).includes(needle)) continue;
    noteIds.add(note.id);
    if (note.folderPath) keepWithAncestors(note.folderPath);
  }

  return { query: needle, folderPaths, noteIds };
}

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
 * Bande de bordure d'une rangée, en pixels, où le geste vaut « insérer AVANT /
 * APRÈS » plutôt que « déposer DEDANS ».
 *
 * En ratio (l'ancien 30%/70%), « dedans » ne valait que 13px sur une rangée de
 * 32 : deux tiers de la rangée réordonnaient, et déposer un dossier dans son
 * voisin de même niveau relevait de la loterie. En pixels fixes, « dedans »
 * occupe le gros de la rangée et reste constant quelle que soit sa hauteur.
 *
 * 6px paraît étroit pour insérer, mais la zone RÉELLE est le cumul de deux
 * bordures adjacentes — bas d'une rangée + haut de la suivante — soit 12px
 * continus centrés sur la frontière, exactement là où l'utilisateur vise quand
 * il veut « entre les deux ».
 */
const ROW_EDGE_PX = 6;

/** Bordure effective : jamais plus du quart d'une rangée courte. */
function rowEdge(height: number): number {
  return Math.min(ROW_EDGE_PX, height * 0.25);
}

/**
 * Préfixe des identifiants dnd-kit d'une note, pour les distinguer des chemins
 * de dossier dans le même DndContext.
 *
 * Les notes se déplaçaient par le drag HTML5 natif, pas par dnd-kit. Deux
 * conséquences : au doigt, le geste n'existait tout simplement pas — l'API
 * HTML5 n'est pas implémentée sur mobile — et à la souris, rien ne signalait
 * qu'une ligne de fichier était saisissable (ni poignée, ni curseur `grab`).
 * Les notes passent donc sur le même moteur que les dossiers.
 *
 * Le drop natif reste branché côté dossier : il sert encore à l'import de
 * fichiers depuis le bureau et aux cartes de la NoteList.
 */
const NOTE_DRAG_PREFIX = "note:";

/**
 * Custom collision detection for the folder tree.
 *
 * Two outcomes only:
 *   "nest:path"  — pointer is away from the row's edges → drop INTO it.
 *   "path"       — pointer is within {@link ROW_EDGE_PX} of a SIBLING folder's
 *                  top/bottom border → reorder.
 *
 * Cross-level, non-center hovers return [] so the active item stays in place
 * visually instead of jumping to an unrelated position in the flat DOM order.
 */
const folderTreeCollision: CollisionDetection = ({ active, droppableContainers, pointerCoordinates }) => {
  if (!pointerCoordinates) return [];
  const { y: py } = pointerCoordinates;
  const activePath = String(active.id);

  // Une NOTE n'a qu'une destination possible : l'intérieur d'un dossier. Ni
  // tri ni changement de niveau — son rang dans un dossier ne se règle pas
  // ici, et « à côté d'un dossier » ne veut rien dire pour un fichier. Toute
  // la hauteur de la rangée est donc acquise à l'imbrication, sans bordures.
  if (activePath.startsWith(NOTE_DRAG_PREFIX)) {
    const hits: Collision[] = [];
    for (const container of droppableContainers) {
      const rect = container.rect.current;
      if (!rect || py < rect.top || py > rect.bottom) continue;
      const id = String(container.id);
      if (!id.startsWith("nest:")) continue;
      hits.push({ id, data: { droppableContainer: container } });
    }
    return hits;
  }

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
      const edge = rowEdge(rect.height);
      if (py >= rect.top + edge && py <= rect.bottom - edge) {
        nestHits.push({ id, data: { droppableContainer: container } });
      }
    } else if (id.startsWith("reparent:")) {
      // Bordure d'une rangée dont le parent diffère → changement de niveau.
      const targetPath = id.slice(9);
      const targetParent = getParentPath(targetPath);
      if (targetParent === activeParent) continue; // same level → sort handles it
      if (targetPath === activePath || targetPath.startsWith(activePath + "/")) continue;
      const edge = rowEdge(rect.height);
      if (py < rect.top + edge || py > rect.bottom - edge) {
        reparentHits.push({ id, data: { droppableContainer: container } });
      }
    } else {
      // Sort: same-parent siblings only (no cross-level visual jumps).
      // Restreint aux bordures, comme les deux branches ci-dessus : sans ça un
      // frère captait la rangée ENTIÈRE (et, déplié, tout son sous-arbre), donc
      // le tri gagnait partout et « dedans » devenait inatteignable.
      if (getParentPath(id) === activeParent && id !== activePath) {
        const edge = rowEdge(rect.height);
        if (py < rect.top + edge || py > rect.bottom - edge) {
          sortHits.push({ id, data: { droppableContainer: container } });
        }
      }
    }
  }

  return nestHits.length > 0 ? nestHits : sortHits.length > 0 ? sortHits : reparentHits;
};

// ── Vault mounts (montages) ────────────────────────────────────────────────────
//
// Les entités d'un coffre monté vivent dans le coffre père sous le chemin
// virtuel `@mounts/<slug>/<cheminOrigine>` (cf. lib/online-sync/room-id.ts).
// L'entité de configuration du montage elle-même (`typeId: "vault_mount"`,
// `defaultPath: "VaultMounts"`) ne doit JAMAIS apparaître comme une note.
//
// Le FileTree reçoit déjà ces deux familles sous forme de NŒUDS de dossier
// (le worker dérive l'arbre des `filePath` de toutes les entités), donc tout
// le regroupement opère sur la prop `folders` — pas sur `notes`, qui ne sert
// qu'au comptage « (N) ».

/** Dossier racine système des configs de montage — à masquer de l'arbre. */
const MOUNT_CONFIG_FOLDER = "VaultMounts";

/** Métadonnées d'un coffre monté, indexées par son slug de salon. */
interface MountRootMeta {
  /** Slug = cloudRoomSlug(cloudVaultId(serverUrl, vaultKey)). */
  slug: string;
  /** Libellé affiché (label du montage, sinon la clé du salon). */
  label: string;
  serverUrl: string;
  vaultKey: string;
}

type MountConnection = { serverUrl: string; vaultKey: string; token: string; label: string };

/** Construit la table slug → métadonnées à partir de la requête listMounts. */
function buildMountMap(mounts: ReadonlyArray<MountConnection>): Map<string, MountRootMeta> {
  const map = new Map<string, MountRootMeta>();
  for (const m of mounts) {
    const slug = cloudRoomSlug(cloudVaultId(m.serverUrl, m.vaultKey));
    map.set(slug, {
      slug,
      label: m.label || m.vaultKey,
      serverUrl: m.serverUrl,
      vaultKey: m.vaultKey,
    });
  }
  return map;
}

/**
 * Transforme l'arbre de dossiers brut pour :
 *   1. retirer le dossier de configs `VaultMounts` (jamais affiché),
 *   2. dé-emballer le wrapper `@mounts` et hisser chaque `<slug>` au niveau
 *      racine, relabellisé avec le nom du coffre monté et marqué comme « racine
 *      de montage » (icône + teinte distinctes, action « Déconnecter »).
 *
 * Les chemins (`folder.path`) restent INCHANGÉS (`@mounts/<slug>/…`) : ils
 * pilotent la sélection et le comptage des notes, qui scannent `notes` par
 * `folderPath`. Seul le `name` de la racine est remplacé par le libellé.
 *
 * Un slug sans entrée dans `mountMap` (montage retiré mais entités pas encore
 * purgées) est volontairement SAUTÉ : on n'affiche pas de données orphelines
 * d'un coffre déconnecté — le manager les purgera, et les rendre sans action
 * de déconnexion serait un cul-de-sac pour l'utilisateur.
 *
 * Renvoie l'arbre transformé + l'ensemble des chemins marqués comme racines de
 * montage (consommé par FolderNode pour son rendu et son menu).
 */
function regroupMounts(
  folders: FolderType[],
  mountMap: Map<string, MountRootMeta>,
): { folders: FolderType[]; mountRoots: Map<string, MountRootMeta> } {
  const mountRoots = new Map<string, MountRootMeta>();
  const out: FolderType[] = [];
  for (const folder of folders) {
    if (folder.path === MOUNT_CONFIG_FOLDER) continue; // 1. masque les configs
    if (folder.path === MOUNT_PATH_PREFIX) {
      // 2. dé-emballe `@mounts` : chaque enfant est un `<slug>`.
      for (const slugNode of folder.children ?? []) {
        const slug = slugNode.path.slice(MOUNT_PATH_PREFIX.length + 1);
        const meta = mountMap.get(slug);
        if (!meta) continue; // slug orphelin → on saute (coffre déconnecté)
        out.push({ ...slugNode, name: meta.label });
        mountRoots.set(slugNode.path, meta);
      }
      continue;
    }
    out.push(folder);
  }
  return { folders: out, mountRoots };
}

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

// ── MountContext — racines de montage + action de déconnexion ─────────────────
//
// Partagé par tout l'arbre : FolderNode lit `mountRoots` (par chemin) pour
// distinguer une racine de coffre monté d'un dossier normal (icône, teinte,
// item de menu « Déconnecter »). Seules les racines top-level y figurent ; les
// sous-dossiers d'un montage restent des dossiers ordinaires (lecture seule
// côté affichage, le worker pilote leur cycle de vie).

interface MountContextValue {
  mountRoots: Map<string, MountRootMeta>;
  /** Déconnecte le coffre monté à ce chemin racine (supprime sa config). */
  onDisconnectMount: (meta: MountRootMeta) => void;
}

const MountContext = createContext<MountContextValue>({
  mountRoots: new Map(),
  onDisconnectMount: () => {},
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
  /**
   * Create a Google Doc/Sheet/Slides in the given folder. Absent (undefined)
   * when Google Drive isn't connected → the "Nouveau Google …" context-menu
   * items are hidden.
   */
  onNewDriveDoc?: (kind: GoogleDocKind, parent: string) => void;
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
   * Full unfiltered list of notes — alimente à la fois le compteur récursif
   * « (N) » de chaque dossier ET les lignes de notes affichées sous les
   * dossiers dépliés. Le caller peut passer des objets `Note` complets.
   */
  notes: TreeNote[];
  /** Note actuellement ouverte (surlignée dans l'arbre). */
  selectedNoteId?: string | null;
  /**
   * Clic sur une ligne de note. Absent → les notes restent affichées mais
   * inertes (aucun call-site ne fait ça aujourd'hui).
   */
  onSelectNote?: (id: string) => void;
  /**
   * Renommage d'une note depuis l'arbre (double-clic, F2, ou clic droit →
   * « Renommer »). Doit résoudre une fois le titre commité ; un rejet affiche
   * un toast et la ligne reprend son titre d'origine.
   */
  onRenameNote?: (id: string, newTitle: string) => Promise<void>;
  /**
   * Clic droit → « Supprimer la note ». Le call-site porte la confirmation
   * (modal) — l'arbre se contente de déclencher l'intention.
   */
  onDeleteNote?: (id: string) => void;
  /** Clic droit → « Archiver la note ». */
  onArchiveNote?: (id: string, archived: boolean) => Promise<void>;
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
  folders: rawFolders,
  selectedFolder,
  onSelectFolder,
  onNewFolder,
  onNewNote,
  onNewDriveDoc,
  onRenameFolder,
  onRenameFolderInline,
  onDeleteFolder,
  onArchiveFolder,
  notes: rawNotes,
  selectedNoteId = null,
  onSelectNote,
  onRenameNote,
  onDeleteNote,
  onArchiveNote,
  onCollapse,
  onDropNote,
}: FileTreeProps) {
  const t = useTranslations("notes");
  // Single context-menu state shared by every FolderNode — only one can be
  // open at a time anyway, and the ContextMenu element lives at the FileTree
  // root so it can render above the scroll container without clipping.
  const ctx = useContextMenu();
  const confirm = useConfirm();
  const utils = trpc.useUtils();
  const { toast } = useToast();

  const [connectVaultOpen, setConnectVaultOpen] = useState(false);

  // ── Montages (vault mounts) ────────────────────────────────────────────────
  // Liste les coffres montés directement par l'utilisateur (provenance nulle).
  // Pas de round-trip réseau : c'est une requête worker locale.
  const mountsQuery = trpc.sync.listMounts.useQuery({ sourceVaultId: null });
  const mountMap = useMemo(
    () => buildMountMap(mountsQuery.data?.mounts ?? []),
    [mountsQuery.data],
  );

  // Regroupe l'arbre : masque `VaultMounts`, hisse chaque montage `@mounts/<slug>`
  // en racine labellisée. `folders`/`notes` ci-dessous référencent désormais la
  // version regroupée (filtrée) — toutes les utilisations en aval en héritent.
  const { folders, mountRoots } = useMemo(
    // `_attachments` est technique (images collées dans les notes) : il ne se
    // montre pas dans l'arbre et ne se choisit pas comme destination.
    () => regroupMounts(rawFolders.filter((f) => !isAttachmentPath(f.path)), mountMap),
    [rawFolders, mountMap],
  );

  // Comptage « (N) » : on retire les entités de config `vault_mount`
  // (`VaultMounts/…`) pour qu'elles ne gonflent aucun compteur. NB : le même
  // tableau `allNotes` alimente NoteList côté page ; ce filtre est LOCAL au
  // FileTree, donc une config pourrait encore apparaître dans la liste centrale
  // si la page la sélectionnait — à traiter en suivi si besoin (le dossier
  // `VaultMounts` n'étant plus sélectionnable depuis l'arbre, le risque est nul
  // en pratique).
  const notes = useMemo(
    () =>
      rawNotes.filter(
        (n) =>
          n.folderPath !== MOUNT_CONFIG_FOLDER &&
          !n.folderPath.startsWith(`${MOUNT_CONFIG_FOLDER}/`) &&
          !isAttachmentPath(n.folderPath),
      ),
    [rawNotes],
  );

  // Déconnexion d'un coffre monté : on supprime l'entité `vault_mount`
  // correspondante. Le MountSyncProvider observe ce changement (ENTITY_CHANGE),
  // re-résout ses clients et purge les entités montées — on n'appelle JAMAIS
  // purgeMounted directement, le manager s'en charge.
  const handleDisconnectMount = useCallback(
    (meta: MountRootMeta) => {
      void (async () => {
        const ok = await confirm({
          title: `Déconnecter « ${meta.label} » ?`,
          description:
            "Ce coffre monté sera détaché : ses notes disparaîtront de l'arborescence. Le coffre distant n'est pas affecté ; vous pourrez le remonter à tout moment.",
          confirmLabel: "Déconnecter",
          destructive: true,
        });
        if (!ok) return;
        try {
          // Retrouve l'entité de config par ses champs normalisés (serverUrl +
          // vaultKey), tels que stockés par useCreateMount.
          const wantServer = normalizeServerUrl(meta.serverUrl);
          const wantKey = normalizeVaultKey(meta.vaultKey);
          const res = await trpcVanillaClient.entities.list.query({
            typeId: "vault_mount",
            limit: 200,
            offset: 0,
          });
          const target = res.items.find((e) => {
            const f = e.fields as Record<string, unknown>;
            return (
              normalizeServerUrl(String(f["serverUrl"] ?? "")) === wantServer &&
              normalizeVaultKey(String(f["vaultKey"] ?? "")) === wantKey
            );
          });
          if (!target) {
            toast({ title: "Montage introuvable", variant: "danger" });
            return;
          }
          await trpcVanillaClient.entities.delete.mutate({ id: target.id });
          // Rafraîchit l'arbre et les compteurs comme le fait la suppression de
          // dossier (le MountSyncProvider purgera les entités montées de son côté).
          void utils.entities.list.invalidate();
          void utils.vault.folders.list.invalidate();
          void utils.sync.listMounts.invalidate();
        } catch (err) {
          console.error("[handleDisconnectMount] failed", err);
          toast({ title: "Impossible de déconnecter le coffre", variant: "danger" });
        }
      })();
    },
    [confirm, utils, toast],
  );

  const mountCtx = useMemo<MountContextValue>(
    () => ({ mountRoots, onDisconnectMount: handleDisconnectMount }),
    [mountRoots, handleDisconnectMount],
  );

  // Index notes → dossier direct, calculé UNE fois par changement de liste
  // (chaque FolderNode y lit ses notes en O(1) au lieu de rescanner le tableau).
  const notesByFolder = useMemo(() => buildNotesByFolder(notes), [notes]);
  const noteCtx = useMemo<NoteTreeContextValue>(
    () => ({
      notesByFolder,
      selectedNoteId,
      onSelectNote: onSelectNote ?? null,
      onRenameNote: onRenameNote ?? null,
      onDeleteNote: onDeleteNote ?? null,
      onArchiveNote: onArchiveNote ?? null,
      openContextMenu: ctx.open,
      openContextMenuAt: ctx.openAt,
    }),
    [
      notesByFolder,
      selectedNoteId,
      onSelectNote,
      onRenameNote,
      onDeleteNote,
      onArchiveNote,
      ctx.open,
      ctx.openAt,
    ],
  );
  // Notes posées à la racine du coffre (aucun dossier) : elles n'ont aucun
  // FolderNode pour les héberger, on les rend donc directement dans le nav,
  // sous les dossiers — sinon elles seraient invisibles depuis l'arbre.
  const rootNotes = notesByFolder.get("") ?? [];

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

  // ── Filtre ────────────────────────────────────────────────────────────────
  const [filterQuery, setFilterQuery] = useState("");
  const treeFilter = useMemo(
    () => computeTreeFilter(filterQuery, folders, notes),
    [filterQuery, folders, notes],
  );
  const filterActive = treeFilter.query.length > 0;
  const filterEmpty =
    filterActive && treeFilter.folderPaths.size === 0 && treeFilter.noteIds.size === 0;

  const isExpanded = useCallback((path: string) => {
    // Sous filtre, tout est déplié : le résultat d'une recherche doit être
    // visible sans avoir à rouvrir la branche qui le contient. L'état plié
    // choisi par l'utilisateur n'est pas écrasé pour autant — il reprend tel
    // quel dès que le champ est vidé.
    if (filterActive) return true;
    const explicit = expandedMap.get(path);
    // Explicit value set by the user always wins.
    if (explicit !== undefined) return explicit;
    // Default: root-level folders open, deeper folders closed.
    return !path.includes("/");
  }, [expandedMap, filterActive]);

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

  // ── Navigation verticale au clavier ───────────────────────────────────────
  //
  // Les rangées portent `data-tree-row` et sont déjà focalisables : ↑/↓ n'ont
  // donc qu'à déplacer le focus d'une à l'autre, dans l'ordre du DOM — qui est
  // l'ordre visuel, notes comprises. Sans ça, atteindre le douzième dossier au
  // clavier coûtait vingt-quatre Tab (chaque rangée en consomme deux avec sa
  // poignée), ce qui contredit le « clavier d'abord » du PRODUCT.md.
  //
  // Posé sur le conteneur plutôt que sur chaque rangée : une seule fermeture,
  // et la liste est relue à chaque frappe, donc replier ou filtrer pendant la
  // navigation ne laisse jamais d'index périmé.
  const handleTreeKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    // Renommage en cours : les flèches appartiennent au champ de saisie.
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-tree-row]")];
    if (rows.length === 0) return;
    const current = (e.target as HTMLElement).closest<HTMLElement>("[data-tree-row]");
    const index = current ? rows.indexOf(current) : -1;
    let next: HTMLElement | undefined;
    if (e.key === "Home") next = rows[0];
    else if (e.key === "End") next = rows[rows.length - 1];
    else if (e.key === "ArrowDown") next = rows[index + 1] ?? rows[0];
    else next = index <= 0 ? rows[rows.length - 1] : rows[index - 1];
    if (!next) return;
    // preventDefault APRÈS avoir trouvé une cible : sinon on confisquerait le
    // défilement du panneau quand le focus n'est sur aucune rangée.
    e.preventDefault();
    next.focus();
    next.scrollIntoView({ block: "nearest" });
  }, []);

  // ── Unified folder DnD (reorder + reparent) ───────────────────────────────
  // A single DndContext wraps the entire tree so folders can be dragged
  // across levels. `childOrders` replaces the old per-node `localChildOrder`
  // states; key "" = root, key "a/b" = children of folder "a/b".
  const { reorderFolders } = useReorderFolders();
  const { moveFolder } = useMoveFolder();
  const [childOrders, setChildOrders] = useState<Map<string, string[]>>(new Map());
  const [nestTarget, setNestTarget] = useState<string | null>(null);
  const [reparentTarget, setReparentTarget] = useState<string | null>(null);

  // PointerSensor seul ne permet pas de glisser au doigt dans une liste qui
  // défile : dès que le doigt bouge, le navigateur arbitre en faveur du scroll
  // et envoie `pointercancel`, donc le drag ne démarre jamais. Le TouchSensor
  // lève l'ambiguïté par un appui maintenu — on garde ainsi le scroll libre
  // (pas de `touch-action: none`) tout en rendant le déplacement possible.
  // Souris = MouseSensor et non PointerSensor : ce dernier voit AUSSI les
  // événements tactiles et son seuil en distance gagnerait la course contre
  // les 250ms du TouchSensor, ramenant exactement le conflit qu'on évite.
  const dndSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
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

      // Note déposée dans un dossier — seule issue possible pour un fichier.
      if (activePath.startsWith(NOTE_DRAG_PREFIX)) {
        if (!overId.startsWith("nest:")) return;
        const targetPath = overId.slice(5);
        if (targetPath === MOUNT_PATH_PREFIX || targetPath.startsWith(`${MOUNT_PATH_PREFIX}/`)) return;
        onDropNote?.(activePath.slice(NOTE_DRAG_PREFIX.length), targetPath);
        setExpanded(targetPath, true);
        return;
      }

      // Un sous-arbre monté (`@mounts/...`) est en lecture seule : on refuse
      // tout déplacement dont la source OU la destination y atterrirait. Le
      // worker rejetterait l'écriture ; on évite l'aller-retour + le toast.
      const isMountScopedPath = (p: string) =>
        p === MOUNT_PATH_PREFIX || p.startsWith(`${MOUNT_PATH_PREFIX}/`);
      if (isMountScopedPath(activePath)) return;

      if (overId.startsWith("nest:")) {
        // Drop INTO another folder.
        const targetPath = overId.slice(5);
        if (isMountScopedPath(targetPath)) return;
        const leaf = activePath.split("/").pop()!;
        void moveFolder(activePath, `${targetPath}/${leaf}`);
        setExpanded(targetPath, true);
        return;
      }

      if (overId.startsWith("reparent:")) {
        // Drop ADJACENT to another folder → move to that folder's parent level.
        const siblingPath = overId.slice(9);
        if (isMountScopedPath(siblingPath)) return;
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
    [orderedFolders, childOrders, reorderFolders, moveFolder, setExpanded, onDropNote],
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
          className="sn-eyebrow sn-eyebrow--compact"
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

      {/* Filtre — même gabarit que la recherche de NoteList (panneau voisin) :
          l'arbre était la seule surface des notes à ne pas en avoir. Échap
          vide le champ sans quitter le clavier. */}
      <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div className="relative">
          <MagnifyingGlass
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-muted)" }}
          />
          <Input
            type="text"
            placeholder="Filtrer le coffre…"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && filterQuery) {
                e.preventDefault();
                setFilterQuery("");
              }
            }}
            aria-label="Filtrer les dossiers et les notes"
            className="w-full rounded-md py-1.5 pl-8 pr-3 text-xs outline-none"
            style={{
              backgroundColor: "var(--surface-2)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-subtle)",
            }}
          />
        </div>
      </div>

      <ExpandedContext.Provider value={expandedCtx}>
        <TreeFilterContext.Provider value={treeFilter}>
        <MountContext.Provider value={mountCtx}>
        <NoteTreeContext.Provider value={noteCtx}>
        <NewDriveDocContext.Provider value={onNewDriveDoc ?? null}>
        <FolderDndContext.Provider value={{ nestTarget, reparentTarget, childOrders }}>
          <DndContext
            sensors={dndSensors}
            collisionDetection={folderTreeCollision}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <nav className="flex-1 overflow-y-auto p-2" onKeyDown={handleTreeKeyDown}>
              {filterEmpty && (
                // `role="status"` : le résultat d'une frappe doit être annoncé,
                // sinon un lecteur d'écran voit l'arbre se vider sans un mot.
                <p
                  role="status"
                  className="px-2 py-6 text-center text-xs"
                  style={{ color: "var(--text-muted)" }}
                >
                  Aucun dossier ni fichier ne correspond à «&nbsp;{filterQuery.trim()}&nbsp;».
                </p>
              )}
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
                      openContextMenuAt={ctx.openAt}
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
                    openContextMenuAt={ctx.openAt}
                    openPicker={openPicker}
                    depth={0}
                    notes={notes}
                    onDropNote={onDropNote}
                  />
                ))}
              </SortableContext>
              {rootNotes.length > 0 && (
                <NoteRows notes={rootNotes} depth={0} folderPath="" onSelectFolder={onSelectFolder} />
              )}
            </nav>
          </DndContext>
        </FolderDndContext.Provider>
        </NewDriveDocContext.Provider>
        </NoteTreeContext.Provider>
        </MountContext.Provider>
        </TreeFilterContext.Provider>
      </ExpandedContext.Provider>

      <ContextMenu state={ctx.state} onClose={ctx.close} />
      <FolderCustomizationPicker state={picker} onClose={closePicker} />
      <ConnectVaultModal isOpen={connectVaultOpen} onOpenChange={setConnectVaultOpen} />

      {/* « Nouveau dossier » existait DEUX fois dans ce panneau de 280px : une
          icône en en-tête et ce bouton en pied. Il ne subsiste ici que quand
          l'arbre n'a aucun dossier utilisateur — il n'est alors plus un
          doublon mais l'état vide qui manquait, seule invitation visible dans
          un panneau autrement blanc. L'icône d'en-tête couvre le reste du
          temps. Masqué aussi sous filtre : proposer une création pendant une
          recherche infructueuse détourne du geste en cours (vider le champ). */}
      {otherFolders.length === 0 && !filterActive && (
        <div
          className="border-t p-3"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <p className="mb-2 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Aucun dossier pour l'instant. Range tes notes par sujet, projet ou client.
          </p>
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
      )}
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
  /** Même menu en coordonnées viewport — chemin de l'appui long tactile. */
  openContextMenuAt: (
    x: number,
    y: number,
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
  openContextMenuAt,
  openPicker,
  depth,
  notes,
  onDropNote,
  isPinned = false,
}: FolderNodeProps) {
  const hasChildren = !!folder.children?.length;
  // Notes directes de ce dossier — rendues sous les sous-dossiers quand le
  // nœud est déplié. Un dossier sans sous-dossier mais avec des notes doit
  // rester dépliable : `hasKids` remplace `hasChildren` partout où il s'agit
  // de « ce nœud a-t-il quelque chose à montrer ».
  const { notesByFolder } = useContext(NoteTreeContext);
  const childNotes = notesByFolder.get(folder.path) ?? [];
  const hasKids = hasChildren || childNotes.length > 0;
  // Expanded state is hoisted to FileTree (persisted in localStorage) so it
  // survives tree refetches, sibling additions, and full reloads. See
  // ExpandedContext above.
  const { isExpanded, setExpanded } = useExpanded();
  const expanded = isExpanded(folder.path);
  const isSelected = selectedFolder === folder.path;
  const { toast } = useToast();
  const utils = trpc.useUtils();
  // Racine de coffre monté ? (par chemin — seules les top-level y figurent).
  const { mountRoots, onDisconnectMount } = useContext(MountContext);
  // Présent uniquement quand Google Drive est connecté (cf. FileTreeProps).
  const onNewDriveDoc = useContext(NewDriveDocContext);
  const mountMeta = mountRoots.get(folder.path) ?? null;
  const isMountRoot = mountMeta !== null;
  // « Scoped » = ce nœud est la racine d'un montage OU imbriqué sous un
  // préfixe `@mounts/`. Sert à supprimer toute mutation de structure (création
  // de note/dossier, renommage, suppression) sur l'ensemble du sous-arbre
  // monté — le worker rejette ces écritures, et une suppression locale ne
  // ferait que churner via re-sync. La navigation (sélection/expansion) et
  // l'ouverture des notes restent autorisées.
  const isMountScoped =
    folder.path === MOUNT_PATH_PREFIX ||
    folder.path.startsWith(`${MOUNT_PATH_PREFIX}/`);
  // Filtre actif : ce nœud n'est rendu que s'il correspond ou s'il est
  // l'ancêtre d'une correspondance (cf. computeTreeFilter). Le hook est
  // consommé AVANT tout retour anticipé — l'ordre des hooks doit rester
  // stable entre deux rendus.
  const treeFilter = useContext(TreeFilterContext);
  const isFiltering = treeFilter.query.length > 0;
  const filteredOut = isFiltering && !treeFilter.folderPaths.has(folder.path);
  // Track inline rename pending state to block single-click navigation during edit.
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  // Amène la rangée dans le viewport quand elle devient la sélection. Sans ça,
  // ouvrir une note par URL ou depuis la recherche dépliait bien son dossier —
  // hors écran, donc invisible.
  const rowRef = useRef<HTMLDivElement>(null);
  // Un appui long vient d'ouvrir le menu : le `click` de synthèse émis au
  // relâchement doit être avalé, sinon on navigue vers le dossier DERRIÈRE le
  // menu qu'on vient d'ouvrir. Remis à zéro à chaque nouveau `touchstart`.
  const longPressFired = useRef(false);
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
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
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
    // Racine de coffre monté : seule action pertinente = se déconnecter. Les
    // dossiers d'un montage sont gérés par le worker (lecture seule côté UI),
    // donc on n'offre ni renommage, ni couleur, ni suppression de notes ici.
    if (isMountRoot && mountMeta) {
      return [
        {
          key: "disconnect-mount",
          label: "Déconnecter ce vault",
          icon: <Plugs size={14} />,
          isDanger: true,
          onPress: () => onDisconnectMount(mountMeta),
        },
      ];
    }
    // Dossier imbriqué dans un montage : structurellement en lecture seule.
    // Aucune action de mutation (création note/dossier, renommage, suppression)
    // n'est pertinente — on ne propose donc pas de menu.
    if (isMountScoped) {
      return [];
    }
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
      // Google Doc/Sheet/Slides — seulement si Drive connecté (handler présent).
      ...(onNewDriveDoc
        ? DRIVE_DOC_ORDER.map((kind) => {
            const Icon = DRIVE_DOC_ICONS[kind];
            return {
              key: `new-drive-${kind}`,
              label: `Nouveau ${GOOGLE_DOC_KINDS[kind].label} ici`,
              icon: <Icon size={14} />,
              onPress: () => {
                onNewDriveDoc(kind, folder.path);
                setExpanded(folder.path, true);
              },
            };
          })
        : []),
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
    const items = buildMenuItems({ clientX: e.clientX, clientY: e.clientY });
    // Nœud monté imbriqué : pas d'actions → on laisse le menu natif (rien à
    // ouvrir). buildMenuItems renvoie [] dans ce cas.
    if (items.length === 0) return;
    openContextMenu(e, items);
  };

  // Appui long = clic droit du doigt. Seule voie vers les actions au tactile
  // depuis le retrait du bouton « … », et posée sur la rangée elle-même : la
  // poignée de réordonnancement garde son propre geste (TouchSensor, 250 ms),
  // les deux ne se marchent donc jamais dessus.
  const longPress = useLongPress((x, y) => {
    const items = buildMenuItems({ clientX: x, clientY: y });
    if (items.length === 0) return;
    longPressFired.current = true;
    openContextMenuAt(x, y, items);
  });

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
    // Sous-arbre monté : en lecture seule. On refuse d'être cible de drop
    // (import de fichier ou déplacement de note) — le worker rejetterait
    // l'écriture, autant ne pas l'afficher comme cible valide.
    if (isMountScoped) return;
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
      if (hasKids && !expanded) {
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
    // Cohérent avec handleDragOver : aucun drop accepté dans un sous-arbre monté.
    if (isMountScoped) return;
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

  // Teinte des coffres montés — couleur du type `vault_mount` (#8b5cf6).
  const MOUNT_TINT = "#8b5cf6";
  // Prefer the explicit folder color; falls through to the selection-aware
  // default so legacy folders (no color set) still pick up the accent. Les
  // racines de montage utilisent leur teinte violette dédiée.
  const iconColor = isMountRoot
    ? MOUNT_TINT
    : folder.color ?? (isSelected ? "var(--accent)" : "var(--text-secondary)");

  // Eager glyphs for mount roots and the default folder look. Selected folders
  // show `FolderOpen` only when no custom icon is set — once the user picks an
  // icon it sticks regardless of selection state. Une racine de coffre monté
  // affiche toujours une icône « branchement » distincte.
  const StaticIcon = isMountRoot
    ? expanded
      ? CloudArrowDown
      : Plugs
    : isSelected
      ? FolderOpen
      : Folder;
  // Custom glyphs live in the full Phosphor catalogue, lazy-loaded via
  // `CustomFolderGlyph` so the ~1 MB icon chunk only downloads when a folder
  // actually uses one (or the picker opens). Mount roots ignore custom icons.
  const folderGlyph =
    !isMountRoot && folder.icon ? (
      <CustomFolderGlyph name={folder.icon} size={14} color={iconColor} weight="regular" />
    ) : (
      <StaticIcon size={14} color={iconColor} weight="regular" />
    );

  // When the selected row has a custom color, derive per-row accent vars so
  // the highlight uses the folder's own color instead of the global accent.
  const selectedAccent = isSelected ? folderAccentVars(folder.color) : null;
  const selectedBg = selectedAccent
    ? selectedAccent["--accent-subtle"]
    : isSelected ? "var(--accent-subtle)" : undefined;
  const selectedFg = selectedAccent
    ? selectedAccent["--accent"]
    : isSelected ? "var(--accent)" : "var(--text-secondary)";

  // Indentation : échelle unique `rowPaddingLeft` (cf. « Tree geometry »). La
  // base de 20px dégage la gouttière du drag-handle, qui est positionné en
  // absolu à gauche du conteneur quel que soit le niveau.
  // Racine de montage non sélectionnée : teinte de fond subtile (~10% alpha)
  // pour la lire comme « un coffre monté » sans la confondre avec une sélection.
  // La teinte de montage passe par une variable et non par `backgroundColor` :
  // en style inline elle battrait la classe `hover:` de la rangée, et une
  // racine de coffre serait la seule ligne de l'arbre sans retour au survol.
  // La sélection, elle, RESTE en inline — elle doit gagner sur le survol.
  const mountRowBg = isMountRoot && !isSelected ? `${MOUNT_TINT}14` : undefined;
  const sharedRowStyle: React.CSSProperties = {
    paddingLeft: `${rowPaddingLeft(depth)}px`,
    ["--sn-row-tint" as string]: mountRowBg,
    backgroundColor: selectedBg,
    color: selectedFg,
    fontWeight: isMountRoot ? 500 : isSelected ? 500 : 400,
  };
  /** Renommage inline autorisé : handler fourni ET nœud non monté (lecture seule). */
  const canRenameInline = !!onRenameFolderInline && !isMountScoped;

  // `block: "nearest"` : ne défile QUE si la rangée est hors champ, et sans
  // recentrer le panneau — un arbre qui saute à chaque sélection serait pire
  // que le problème qu'on corrige. Défilement instantané, pas d'animation à
  // désactiver sous `prefers-reduced-motion`.
  useEffect(() => {
    if (!isSelected) return;
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected]);

  const chevronSpan = (
    <span
      // Le chevron ne mesurait que 16×12 : il s'ajuste au caret, pas à la
      // rangée. `self-stretch` lui donne la hauteur de la ligne et l'anneau
      // ::before récupère la gouttière à SA GAUCHE seulement — vers la
      // droite se trouve le nom du dossier, dont le tap ouvre le dossier au
      // lieu de le replier ; un anneau symétrique volerait ce geste. Pas de
      // `sn-hit` ici : porter la largeur à 32px décalerait toute
      // l'indentation de l'arbre.
      //
      // Ni `role="button"` ni `aria-label` : ce span vit DANS le bouton de
      // rangée, donc le rôle y créait un bouton dans un bouton et injectait
      // « Réduire » dans le nom accessible de la ligne (« Réduire Beta (2) »).
      // Le rôle mentait de toute façon — sans `tabIndex`, aucun clavier ne
      // l'atteignait. L'état de dépliage est désormais porté par
      // `aria-expanded` sur la rangée, et le geste par Flèche droite/gauche.
      className="relative flex w-4 flex-shrink-0 items-center justify-center self-stretch before:absolute before:-inset-y-1 before:-left-2 before:right-0 before:content-['']"
      aria-hidden
      onClick={hasKids ? handleChevronClick : undefined}
      style={hasKids ? { cursor: "pointer" } : undefined}
    >
      {hasKids ? (
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

  if (filteredOut) return null;

  // Sous filtre, un dossier qui correspond par son NOM garde des enfants qui,
  // eux, ne correspondent pas : sans ce garde, son bloc enfants se déplierait
  // vide et `.sn-tree-branch` tracerait un trait vertical ne reliant rien.
  const hasVisibleKids = !isFiltering
    ? true
    : orderedChildren.some((c) => treeFilter.folderPaths.has(c.path)) ||
      childNotes.some((n) => treeFilter.noteIds.has(n.id));

  return (
    // `sortableAttributes` NE VA PAS ici : dnd-kit les destine à l'activateur
    // du drag (la poignée), pas au nœud trié. Posées sur ce conteneur, elles
    // en faisaient un `role="button" tabindex="0"` qui ENVELOPPE le bouton de
    // rangée — bouton dans bouton — et dont le nom accessible agrégeait tout
    // le sous-arbre (« Beta(2)Nouvelle noteNouvelle note »). Elles vivent
    // désormais sur la poignée, avec les `listeners` qu'elles décrivent.
    <div
      ref={sortableNodeRef}
      data-folder-drop={folder.path}
      style={sortableDndStyle}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        ref={(el) => { nestNodeRef(el); reparentRef(el); rowRef.current = el; }}
        // .sn-motion-colors → the drop-target tint (background-color) eases in
        // and settles on the shared token instead of snapping, and self-
        // degrades to instant under reduced-motion. The outline stays crisp
        // (instant) so the drop boundary is never ambiguous mid-glide.
        className={`sn-motion-colors group relative flex items-center${depth > 0 ? " sn-tree-elbow" : ""}`}
        onContextMenu={handleContextMenu}
        style={{
          // Coude horizontal (::before) qui raccroche la ligne au trait
          // vertical du parent — inerte au niveau racine (pas de parent).
          ...(depth > 0 ? { ["--sn-tree-elbow-x" as string]: `${elbowX(depth)}px` } : null),
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
        {/* Poignée de réordonnancement — masquée pour l'Inbox épinglée et pour
            tout nœud monté (`@mounts/...`) : leur chemin est virtuel et en
            lecture seule, un déplacement le casserait.

            Deux pièges corrigés ici, tous deux fatals au drag :
            1. `{...sortableListeners}` publie `onMouseDown` (activateur du
               MouseSensor). Un `onMouseDown` déclaré APRÈS le spread l'écrase
               — React garde la dernière prop — et plus aucun drag à la souris
               ne démarrait. Rien à stopper de toute façon : aucun ancêtre
               n'écoute mousedown.
            2. Le montage conditionnel sur un état `hovered` : au doigt il n'y
               a pas de survol, donc la poignée n'existait jamais et le
               TouchSensor n'avait aucune cible. `sn-reveal` fait le travail en
               CSS — révélée au survol à la souris, permanente au doigt.

            La poignée occupe TOUTE la gouttière de 20px (`left-0 w-5`) — même
            centre optique qu'avant, 4px de prise en plus au doigt — et son
            anneau `::before` l'étire à 32px de haut. Pas d'élargissement
            latéral : à gauche c'est le bord du panneau, à droite le chevron
            capte déjà le tap et le lui voler coûterait le repli. */}
        {/* Pas de poignée sous filtre : une vue filtrée cache une partie des
            frères, or le tri et l'imbrication raisonnent sur la fratrie
            complète — on déplacerait « avant le premier visible » sans savoir
            ce qui se trouve au-dessus. Le geste revient dès que le champ est
            vidé. */}
        {!isPinned && !isMountScoped && !isFiltering && (
          <button
            type="button"
            {...sortableAttributes}
            {...sortableListeners}
            aria-label="Réordonner le dossier"
            className="sn-reveal absolute left-0 top-1/2 flex h-5 w-5 -translate-y-1/2 cursor-grab items-center justify-center rounded before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-[''] active:cursor-grabbing"
            style={{ color: "var(--text-muted)", zIndex: 1 }}
          >
            <DotsSixVertical size={12} />
          </button>
        )}
        {/* Row: in edit mode switch the button for a plain div to avoid
            <input> inside <button> (invalid HTML per spec). The InlineFolderRenameInput
            is a small self-contained component that handles focus, commit, cancel. */}
        {isRenaming ? (
          <div
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-[var(--sn-row-tint,transparent)] px-2 py-1.5 text-sm"
            style={sharedRowStyle}
          >
            {chevronSpan}
            {folderGlyph}
            <InlineRenameInput
              initialValue={folder.name}
              onCommit={handleInlineRename}
              onCancel={() => setIsRenaming(false)}
            />
          </div>
        ) : (
          <button
            // Repère de la navigation ↑/↓ (cf. handleTreeKeyDown).
            data-tree-row
            onClick={handleClick}
            {...longPress}
            // `{...longPress}` publie onTouchStart ; on le ré-enveloppe pour
            // remettre le drapeau à zéro AVANT chaque nouvel appui — sinon un
            // appui long suivi d'un tap sur le menu (donc sans click sur la
            // rangée) laisserait le drapeau armé et mangerait le clic suivant.
            onTouchStart={(e) => {
              longPressFired.current = false;
              longPress.onTouchStart(e);
            }}
            // Disclosure standard : la rangée annonce son état de dépliage.
            aria-expanded={hasKids ? expanded : undefined}
            // La rangée concentre les raccourcis du nœud :
            //   • Flèche droite / gauche = déplier / replier. Le chevron était
            //     jusqu'ici la SEULE affordance et n'était pas focalisable :
            //     au clavier, un dossier ne s'ouvrait pas du tout.
            //   • F2 = renommer. Écouté ici et non sur le label, qui portait
            //     un `tabIndex={0}` juste pour recevoir la touche — un arrêt
            //     de tabulation de plus par dossier.
            onKeyDown={(e) => {
              if (hasKids && e.key === "ArrowRight" && !expanded) {
                e.preventDefault();
                setExpanded(folder.path, true);
              } else if (hasKids && e.key === "ArrowLeft" && expanded) {
                e.preventDefault();
                setExpanded(folder.path, false);
              } else if (canRenameInline && e.key === "F2") {
                e.preventDefault();
                setIsRenaming(true);
              }
            }}
            // .sn-motion-colors → tokenized bg/color/border glide (replaces the
            // untokenized Tailwind `transition-colors`). Drives BOTH the
            // selection highlight (when selectedBg/selectedFg change) and the
            // hover tint below, on the caret's standard easing.
            //
            // Survol en CSS et non plus en écriture impérative de
            // `style.backgroundColor` : c'est la convention du reste du
            // fichier (et de TagTree). La teinte des coffres montés passe par
            // `--sn-row-tint` pour que la classe `hover:` puisse la couvrir ;
            // la sélection reste en style inline, qui l'emporte sur les deux —
            // une rangée sélectionnée ne doit pas changer au survol.
            // `min-w-0` : sans lui, un élément flex garde `min-width: auto` et
            // refuse de rétrécir sous la largeur de son contenu — le `truncate`
            // du label ne s'enclenchait jamais et un nom de dossier un peu long
            // débordait le panneau de plusieurs dizaines de pixels, barre de
            // défilement horizontale à la clé.
            className="sn-motion-colors flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-[var(--sn-row-tint,transparent)] px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]"
            style={sharedRowStyle}
          >
            {chevronSpan}
            {folderGlyph}
            <span
              className="flex-1 truncate text-left"
              // Le label suit la même couleur que l'icône : un dossier teinté
              // colore icône ET texte (sinon seule l'icône prenait la couleur,
              // le texte restant gris hors sélection — `iconColor` couvre déjà
              // les cas couleur custom / sélection / montage).
              style={{ color: iconColor }}
              // Renommage inline (double-clic / F2) supprimé sur les nœuds
              // montés : leur chemin est virtuel et en lecture seule.
              onDoubleClick={canRenameInline ? (e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsRenaming(true);
              } : undefined}
            >
              {folder.name}
            </span>
            {/* Compteur muet à zéro : « (0) » sur chaque dossier vide alignait
                une colonne de zéros qui ne porte aucun état, alors que le
                dossier vide se lit déjà à son absence de chevron. Même
                grammaire que TagTree — `(N)` en `text-muted`, jamais de
                pastille — et même infobulle explicite. */}
            {recursiveCount > 0 && (
              <span
                className="ml-1 flex-shrink-0 text-xs tabular-nums"
                style={{ color: "var(--text-muted)" }}
                title={`${recursiveCount} note${recursiveCount > 1 ? "s" : ""}`}
              >
                ({recursiveCount})
              </span>
            )}
          </button>
        )}

        {/* Pas de bouton « … » ici : il se posait en absolu PAR-DESSUS le
            compteur « (N) » de la rangée, et les deux se lisaient superposés
            dès qu'il apparaissait. Les mêmes actions restent joignables par
            les trois gestes standards — clic droit (souris), appui long
            (doigt), touche Menu / Shift+F10 (clavier, dont le `contextmenu`
            remonte jusqu'au handler de cette rangée). */}
      </div>

      {hasKids && expanded && hasVisibleKids && (
        // `.sn-tree-expand` plays a one-shot grid-rows unfold on mount so
        // opening a folder slides its children in instead of snapping
        // (collapse stays instant — children unmount, keeping DnD contexts
        // clean). See globals.css.
        //
        // `.sn-tree-branch` trace le trait vertical du niveau, aligné sur l'axe
        // du chevron de CE dossier (`guideX(depth)`) : tous ses enfants —
        // sous-dossiers comme notes — s'y raccrochent par leur coude.
        <div className="sn-tree-expand">
          <div
            className="sn-tree-expand__inner sn-tree-branch"
            style={{ ["--sn-tree-guide-x" as string]: `${guideX(depth)}px` }}
          >
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
                openContextMenuAt={openContextMenuAt}
                openPicker={openPicker}
                depth={depth + 1}
                notes={notes}
                onDropNote={onDropNote}
              />
            ))}
          </SortableContext>
          {/* Fichiers après les dossiers (convention explorateur). */}
          {childNotes.length > 0 && (
            <NoteRows
              notes={childNotes}
              depth={depth + 1}
              folderPath={folder.path}
              onSelectFolder={onSelectFolder}
            />
          )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Lignes de notes ───────────────────────────────────────────────────────────

/** Extensions Drive (.gdoc/.gsheet/.gslides) → icône dédiée. */
const DRIVE_EXT_TO_KIND = new Map<string, GoogleDocKind>(
  DRIVE_DOC_ORDER.map((kind) => [GOOGLE_DOC_KINDS[kind].ext.slice(1), kind]),
);

/**
 * Glyphe d'une note : emoji perso (`fields.icon`, cf. NoteIcon) sinon un
 * pictogramme dérivé du contenu — canevas, fichier Drive, pièce jointe, note
 * markdown. Volontairement plus discret que les icônes de dossier (couleur
 * `--text-muted`) pour que la hiérarchie reste lisible d'un coup d'œil.
 */
function NoteGlyph({ note, color }: { note: TreeNote; color: string }): React.JSX.Element {
  const fields = note.fields ?? {};
  const emoji = typeof fields["icon"] === "string" ? fields["icon"].trim() : "";
  if (emoji) {
    return (
      <span aria-hidden className="w-[14px] shrink-0 text-center text-[12px] leading-none">
        {emoji}
      </span>
    );
  }
  // Excalidraw rattaché → icône de graphe, juste après l'emoji choisi par
  // l'utilisateur : c'est le trait le plus distinctif d'une note, il passe
  // donc avant le type de pièce jointe.
  //
  // On teste `canvasFile` AVANT `canvas`, et c'est tout l'objet du correctif :
  // `canvas` est le blob Excalidraw hydraté par le worker, et il n'est injecté
  // que sur `entities.get`. L'arbre, lui, se nourrit de `entities.list`, qui
  // ne transporte que les champs bruts du frontmatter — donc `canvasFile`, le
  // pointeur vers le `.excalidraw` voisin, jamais `canvas`. La condition
  // précédente ne pouvait structurellement jamais être vraie ici : aucune note
  // à dessin n'a jamais eu d'icône dans l'arbre. On garde `canvas` en second
  // pour les entités déjà hydratées par une visite.
  if (fields["canvasFile"] || fields["canvas"]) {
    return <Graph size={14} color={color} weight="regular" />;
  }
  const attachment = typeof fields["attachmentFile"] === "string" ? fields["attachmentFile"] : "";
  const dot = attachment.lastIndexOf(".");
  const ext = dot >= 0 ? attachment.slice(dot + 1).toLowerCase() : "";
  const driveKind = ext ? DRIVE_EXT_TO_KIND.get(ext) : undefined;
  if (driveKind) {
    const Icon = DRIVE_DOC_ICONS[driveKind];
    return <Icon size={14} color={color} weight="regular" />;
  }
  if (attachment) return <Paperclip size={14} color={color} weight="regular" />;
  return <FileText size={14} color={color} weight="regular" />;
}

interface NoteRowsProps {
  notes: TreeNote[];
  /** Niveau d'indentation des lignes (= profondeur du dossier parent + 1). */
  depth: number;
  /** Dossier hôte — cible du repli « + N autres ». "" = racine du coffre. */
  folderPath: string;
  onSelectFolder: (path: string) => void;
}

/** Liste des notes d'un dossier, tronquée à {@link NOTES_PER_FOLDER_CAP}. */
function NoteRows({ notes, depth, folderPath, onSelectFolder }: NoteRowsProps) {
  const treeFilter = useContext(TreeFilterContext);
  // Sous filtre, un dossier conservé pour ses sous-dossiers ne doit pas
  // ramener toutes ses notes au passage : seules les notes concordantes
  // restent.
  const matching = treeFilter.query.length > 0
    ? notes.filter((n) => treeFilter.noteIds.has(n.id))
    : notes;
  const visible = matching.length > NOTES_PER_FOLDER_CAP
    ? matching.slice(0, NOTES_PER_FOLDER_CAP)
    : matching;
  const hidden = matching.length - visible.length;
  return (
    <>
      {visible.map((note) => (
        <NoteRow key={note.id} note={note} depth={depth} />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          disabled={folderPath === ""}
          onClick={folderPath === "" ? undefined : () => onSelectFolder(folderPath)}
          className="sn-tree-elbow relative flex w-full items-center gap-1.5 rounded-md py-1 text-left text-xs italic disabled:cursor-default"
          style={{
            ["--sn-tree-elbow-x" as string]: `${elbowX(depth)}px`,
            paddingLeft: `${rowPaddingLeft(depth) + 20}px`,
            color: "var(--text-muted)",
          }}
        >
          + {hidden} autre{hidden > 1 ? "s" : ""}
        </button>
      )}
    </>
  );
}

/**
 * Une note dans l'arbre. Alignée sur le titre des sous-dossiers de même
 * niveau : un espaceur de 16px occupe la colonne du chevron (une note n'a rien
 * à déplier), puis glyphe + titre. Draggable en natif (`text/plain` = id) pour
 * réutiliser le drop des FolderNode et déplacer la note d'un dossier à l'autre
 * sans passer par la liste centrale.
 *
 * Actions (renommer / archiver / supprimer) : clic droit sur la ligne à la
 * souris, appui long au doigt, touche Menu au clavier — comme les lignes de
 * dossier, et sans bouton « … » qui viendrait se poser sur le titre.
 */
function NoteRow({ note, depth }: { note: TreeNote; depth: number }) {
  const {
    selectedNoteId,
    onSelectNote,
    onRenameNote,
    onDeleteNote,
    onArchiveNote,
    openContextMenu,
    openContextMenuAt,
  } = useContext(NoteTreeContext);
  const { toast } = useToast();
  const [isRenaming, setIsRenaming] = useState(false);
  // Voir FolderNode : avale le `click` de synthèse qui suit un appui long.
  const longPressFired = useRef(false);
  // Voir FolderNode : amène la ligne dans le viewport quand elle est ouverte.
  const rowRef = useRef<HTMLDivElement>(null);
  const isSelected = selectedNoteId === note.id;
  const fg = isSelected ? "var(--accent)" : "var(--text-secondary)";
  // Note appartenant à un coffre monté : sous-arbre en lecture seule (le
  // worker rejette les écritures). Aucune action de mutation proposée — même
  // règle que les FolderNode `isMountScoped`.
  const isMountScoped =
    note.folderPath === MOUNT_PATH_PREFIX ||
    note.folderPath.startsWith(`${MOUNT_PATH_PREFIX}/`);
  // Même moteur de glisser que les dossiers : marche à la souris ET au doigt,
  // et se signale par une poignée. Pas de `useSortable` — une note ne
  // s'ordonne pas dans l'arbre, elle change seulement de dossier.
  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: dragNodeRef,
    isDragging,
  } = useDraggable({ id: `${NOTE_DRAG_PREFIX}${note.id}`, disabled: isMountScoped });

  const handleRenameCommit = async (newTitle: string) => {
    setIsRenaming(false);
    if (!onRenameNote || newTitle === note.title) return;
    try {
      await onRenameNote(note.id, newTitle);
    } catch {
      toast({ title: "Impossible de renommer la note", variant: "danger" });
    }
  };

  // Source unique des actions — partagée par le clic droit et l'appui long.
  const buildItems = (): ContextMenuItemDef[] => {
    if (isMountScoped) return [];
    return [
      {
        key: "rename",
        label: "Renommer",
        icon: <PencilSimple size={14} />,
        isDisabled: !onRenameNote,
        onPress: () => setIsRenaming(true),
      },
      {
        key: "archive",
        label: "Archiver la note",
        icon: <Archive size={14} />,
        isDisabled: !onArchiveNote,
        onPress: () => {
          if (!onArchiveNote) return;
          void onArchiveNote(note.id, true).catch(() =>
            toast({ title: "Impossible d'archiver la note", variant: "danger" }),
          );
        },
      },
      { key: "sep-delete", label: "", separator: true },
      {
        key: "delete",
        label: "Supprimer la note",
        icon: <Trash size={14} />,
        isDanger: true,
        isDisabled: !onDeleteNote,
        onPress: () => onDeleteNote?.(note.id),
      },
    ];
  };

  // Sous-arbre monté : aucune action → on laisse le menu natif du navigateur
  // plutôt que d'ouvrir un menu vide.
  const openMenu = (e: React.MouseEvent) => {
    if (!openContextMenu) return;
    const items = buildItems();
    if (items.length === 0) return;
    e.stopPropagation();
    e.preventDefault();
    openContextMenu(e, items);
  };

  // Appui long = clic droit du doigt (iOS n'émet jamais `contextmenu`).
  const longPress = useLongPress((x, y) => {
    if (!openContextMenuAt) return;
    const items = buildItems();
    if (items.length === 0) return;
    longPressFired.current = true;
    openContextMenuAt(x, y, items);
  });

  const rowStyle: React.CSSProperties = {
    paddingLeft: `${rowPaddingLeft(depth)}px`,
    backgroundColor: isSelected ? "var(--accent-subtle)" : undefined,
    color: fg,
    fontWeight: isSelected ? 500 : 400,
  };

  useEffect(() => {
    if (!isSelected) return;
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isSelected]);

  return (
    <div
      ref={(el) => { rowRef.current = el; dragNodeRef(el); }}
      className="sn-tree-elbow group relative flex items-center"
      style={{ ["--sn-tree-elbow-x" as string]: `${elbowX(depth)}px`, opacity: isDragging ? 0.4 : 1 }}
      onContextMenu={openMenu}
    >
      {/* Poignée de déplacement — même gabarit et même gouttière que celle des
          dossiers, pour que l'arbre n'ait qu'une grammaire. Elle manquait
          entièrement aux fichiers : à la souris rien n'indiquait qu'une ligne
          était saisissable, et au doigt le glisser n'existait pas du tout. */}
      {!isRenaming && !isMountScoped && (
        <button
          type="button"
          {...dragAttributes}
          {...dragListeners}
          aria-label="Déplacer la note"
          className="sn-reveal absolute left-0 top-1/2 flex h-5 w-5 -translate-y-1/2 cursor-grab items-center justify-center rounded before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-[''] active:cursor-grabbing"
          style={{ color: "var(--text-muted)", zIndex: 1 }}
        >
          <DotsSixVertical size={12} />
        </button>
      )}
      {isRenaming ? (
        // Un <input> ne peut pas vivre dans un <button> (HTML invalide) : on
        // bascule la ligne en <div> le temps de l'édition, même motif que
        // FolderNode.
        <div
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm"
          style={rowStyle}
        >
          <span aria-hidden className="w-4 flex-shrink-0" />
          <NoteGlyph note={note} color={isSelected ? "var(--accent)" : "var(--text-muted)"} />
          <InlineRenameInput
            initialValue={note.title}
            onCommit={(value) => void handleRenameCommit(value)}
            onCancel={() => setIsRenaming(false)}
            ariaLabel="Renommer la note"
            pathSegment={false}
          />
        </div>
      ) : (
        <button
          type="button"
          // Repère de la navigation ↑/↓ (cf. handleTreeKeyDown) : les notes
          // font partie du parcours, comme dans un explorateur.
          data-tree-row
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", note.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onClick={() => {
            if (longPressFired.current) {
              longPressFired.current = false;
              return;
            }
            onSelectNote?.(note.id);
          }}
          {...longPress}
          // Voir FolderNode : on ré-enveloppe onTouchStart pour désarmer le
          // drapeau à chaque nouvel appui.
          onTouchStart={(e) => {
            longPressFired.current = false;
            longPress.onTouchStart(e);
          }}
          title={note.title}
          // Survol en CSS (voir FolderNode) : `backgroundColor` inline ne vaut
          // que pour la sélection, qui doit l'emporter sur la classe `hover:`.
          // `min-w-0` : voir FolderNode — sans lui le titre ne se tronque pas
          // et la ligne déborde le panneau.
          className="sn-motion-colors flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]"
          style={rowStyle}
        >
          {/* Colonne du chevron, laissée vide : aligne le glyphe des notes sur
              celui des sous-dossiers de même niveau. */}
          <span aria-hidden className="w-4 flex-shrink-0" />
          <NoteGlyph note={note} color={isSelected ? "var(--accent)" : "var(--text-muted)"} />
          {/* Pas de double-clic « renommer » ici (contrairement aux dossiers
              et à la NoteList) : le premier clic navigue déjà vers la note, ce
              qui remonte l'arbre depuis /notes et ferait disparaître l'input.
              Le renommage passe par le menu contextuel — clic droit, appui
              long, ou touche Menu / Shift+F10 depuis cette rangée focalisée,
              dont le `contextmenu` remonte au handler du conteneur. */}
          <span className="flex-1 truncate text-left">{note.title || "Sans titre"}</span>
        </button>
      )}
    </div>
  );
}

// ── InlineRenameInput ─────────────────────────────────────────────────────────

interface InlineRenameInputProps {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  /** Étiquette a11y — le même input sert aux dossiers et aux notes. */
  ariaLabel?: string;
  /**
   * `true` (défaut) : la valeur devient un vrai segment de chemin (dossier) →
   * on retire aussi les `..`. `false` : simple titre de note (seul
   * `fields.title` est écrit) → on garde les points, un titre peut
   * légitimement contenir « … ».
   */
  pathSegment?: boolean;
}

function InlineRenameInput({
  initialValue,
  onCommit,
  onCancel,
  ariaLabel = "Renommer le dossier",
  pathSegment = true,
}: InlineRenameInputProps) {
  const [draft, setDraft] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    const stripped = draft.trim().replace(/[/\\]/g, "");
    const trimmed = pathSegment ? stripped.replace(/\.\./g, "") : stripped;
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
      aria-label={ariaLabel}
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
      // Ces boutons sont côte à côte : leurs zones tactiles se bornent
      // mutuellement, donc 24px de visuel = 24px de cible utile. `sn-hit`
      // porte le plancher dès qu'un doigt peut servir, rendu compact sinon.
      className="sn-hit h-6 w-6 min-w-0 rounded-md hover:bg-[var(--surface-2)]"
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

