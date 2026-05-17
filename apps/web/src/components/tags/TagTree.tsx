"use client";

/**
 * TagTree — hierarchical tag browser used by /tags.
 *
 * The flat tag list returned by `tags.list` is shaped into a tree based on
 * the slash-separated `path` column. Branches that don't have a matching
 * tag row (e.g. you only ever created `client/premium` and never the bare
 * `client` row) are still rendered as virtual nodes so the hierarchy stays
 * coherent — selecting them works because `tags.entities` runs a recursive
 * descendant lookup against the path prefix.
 *
 * Counts shown next to each node are *recursive*: an entity tagged with
 * `client/premium/europe` contributes to the count of `client/premium` and
 * `client` as well. We rely on `tags.entities` for the actual entity list,
 * so the count here is just a UI hint summed locally over the flat list.
 *
 * Mirrors the FileTree (folders) pattern: chevron toggles expand, click on
 * the row only selects, right-click opens the shared ContextMenu.
 */

import { useMemo, useState, useCallback } from "react";
import { Button } from "@heroui/react";
import {
  CaretDown,
  CaretRight,
  Hash,
  Plus,
  PencilSimple,
  ArrowsOutSimple,
  ArrowsLeftRight,
  Trash,
} from "@phosphor-icons/react";
import { ContextMenu, useContextMenu } from "@supernote/ui";
import type { ContextMenuItemDef } from "@supernote/ui";
import type { Tag } from "@supernote/ipc/schemas/tags";

interface TagNode {
  /** Slash-separated full path. */
  path: string;
  /** Leaf segment (the human-friendly label). */
  name: string;
  /** Direct count from the tag row (0 when the node is virtual). */
  ownCount: number;
  /** Roll-up count: own + every descendant's count. */
  totalCount: number;
  /** Optional hex color from the tag row. */
  color: string | null;
  /** True when no tag row matches this path; the node is purely structural. */
  virtual: boolean;
  children: TagNode[];
}

export interface TagTreeProps {
  tags: Tag[];
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  onCreateChildOf: (parentPath: string | null) => void;
  onRename: (path: string) => void;
  onMove: (path: string) => void;
  onMerge: (path: string) => void;
  onDelete: (path: string) => void;
  onCycleColor: (tag: Tag) => void;
  /** Search filter. Empty string shows the full tree. */
  filter?: string;
}

/**
 * Build a tree of `TagNode` from the flat `Tag[]` returned by tags.list.
 * Walking by sorted `path` lets us materialise virtual ancestor nodes the
 * first time their full path appears as a prefix, without needing an
 * explicit pass.
 */
function buildTree(tags: Tag[]): TagNode[] {
  // Index every node by its full path so child registration is O(1).
  const nodesByPath = new Map<string, TagNode>();
  const roots: TagNode[] = [];

  // Sort by path so parents are always created before children.
  const sorted = [...tags].sort((a, b) => a.path.localeCompare(b.path));

  const ensureNode = (path: string): TagNode => {
    const cached = nodesByPath.get(path);
    if (cached) return cached;
    const segs = path.split("/");
    const node: TagNode = {
      path,
      name: segs[segs.length - 1] ?? path,
      ownCount: 0,
      totalCount: 0,
      color: null,
      virtual: true,
      children: [],
    };
    nodesByPath.set(path, node);
    if (segs.length === 1) {
      roots.push(node);
    } else {
      const parentPath = segs.slice(0, -1).join("/");
      const parent = ensureNode(parentPath);
      parent.children.push(node);
    }
    return node;
  };

  for (const tag of sorted) {
    const node = ensureNode(tag.path);
    node.ownCount = tag.count;
    node.color = tag.color ?? null;
    node.virtual = false;
  }

  // Recursive count rollup. Done bottom-up via a DFS so each node's total is
  // ready by the time its parent reads it.
  const rollup = (node: TagNode): number => {
    let total = node.ownCount;
    for (const child of node.children) total += rollup(child);
    node.totalCount = total;
    // Stable child order: alphabetical by leaf name.
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    return total;
  };
  for (const r of roots) rollup(r);
  roots.sort((a, b) => a.name.localeCompare(b.name));

  return roots;
}

/**
 * Filter the tree by a search query. A node is kept when its path or name
 * matches (case-insensitive); ancestors of any kept node are also retained
 * so the hierarchy remains navigable even when only descendants match.
 *
 * Returns a brand-new tree (no in-place mutation of `roots`).
 */
function filterTree(roots: TagNode[], query: string): TagNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return roots;

  const visit = (node: TagNode): TagNode | null => {
    const matches =
      node.path.toLowerCase().includes(q) ||
      node.name.toLowerCase().includes(q);
    const filteredChildren = node.children
      .map(visit)
      .filter((c): c is TagNode => c !== null);
    if (!matches && filteredChildren.length === 0) return null;
    return { ...node, children: filteredChildren };
  };

  return roots
    .map(visit)
    .filter((c): c is TagNode => c !== null);
}

export function TagTree({
  tags,
  selectedPath,
  onSelectPath,
  onCreateChildOf,
  onRename,
  onMove,
  onMerge,
  onDelete,
  onCycleColor,
  filter = "",
}: TagTreeProps) {
  const ctx = useContextMenu();

  const tree = useMemo(() => filterTree(buildTree(tags), filter), [tags, filter]);
  const tagsByPath = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.path, t);
    return m;
  }, [tags]);

  // When the search field is non-empty, force every node open so the user
  // can see exactly which paths matched without having to click chevrons.
  const forceExpand = filter.trim().length > 0;

  const buildMenu = useCallback(
    (node: TagNode): ContextMenuItemDef[] => {
      const items: ContextMenuItemDef[] = [
        {
          key: "new-subtag",
          label: "Créer un sous-tag",
          icon: <Plus size={14} />,
          onPress: () => onCreateChildOf(node.path),
        },
        {
          key: "rename",
          label: "Renommer",
          icon: <PencilSimple size={14} />,
          isDisabled: node.virtual,
          onPress: () => onRename(node.path),
        },
        {
          key: "move",
          label: "Déplacer…",
          icon: <ArrowsOutSimple size={14} />,
          isDisabled: node.virtual,
          onPress: () => onMove(node.path),
        },
        {
          key: "merge",
          label: "Fusionner dans…",
          icon: <ArrowsLeftRight size={14} />,
          isDisabled: node.virtual,
          onPress: () => onMerge(node.path),
        },
        { key: "sep", label: "", separator: true },
        {
          key: "delete",
          label: "Supprimer",
          icon: <Trash size={14} />,
          isDanger: true,
          isDisabled: node.virtual,
          onPress: () => onDelete(node.path),
        },
      ];
      return items;
    },
    [onCreateChildOf, onRename, onMove, onMerge, onDelete],
  );

  return (
    <div className="flex h-full flex-col">
      <nav className="flex-1 overflow-y-auto p-2">
        {tree.length === 0 && (
          <p
            className="px-3 py-6 text-center text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {tags.length === 0 ? "Aucun tag pour l’instant." : "Aucun résultat."}
          </p>
        )}
        {tree.map((node) => (
          <TagNodeRow
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            onSelectPath={onSelectPath}
            openContextMenu={ctx.open}
            buildMenu={buildMenu}
            tagsByPath={tagsByPath}
            onCycleColor={onCycleColor}
            forceExpand={forceExpand}
          />
        ))}
      </nav>
      <ContextMenu state={ctx.state} onClose={ctx.close} />
    </div>
  );
}

interface TagNodeRowProps {
  node: TagNode;
  depth: number;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  openContextMenu: (e: React.MouseEvent, items: ContextMenuItemDef[]) => void;
  buildMenu: (node: TagNode) => ContextMenuItemDef[];
  tagsByPath: Map<string, Tag>;
  onCycleColor: (tag: Tag) => void;
  forceExpand: boolean;
}

function TagNodeRow({
  node,
  depth,
  selectedPath,
  onSelectPath,
  openContextMenu,
  buildMenu,
  tagsByPath,
  onCycleColor,
  forceExpand,
}: TagNodeRowProps) {
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(depth === 0);
  const isSelected = selectedPath === node.path;
  const effectiveExpanded = forceExpand || expanded;

  const handleChevron = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  const handleContext = (e: React.MouseEvent) => {
    openContextMenu(e, buildMenu(node));
  };

  const tag = tagsByPath.get(node.path) ?? null;

  return (
    <div>
      <div
        className="group relative flex items-center"
        onContextMenu={handleContext}
      >
        <Button
          variant="ghost"
          onPress={() => onSelectPath(node.path)}
          className="flex h-auto flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]"
          style={{
            paddingLeft: `${8 + depth * 16}px`,
            backgroundColor: isSelected ? "var(--accent-subtle)" : undefined,
            color: isSelected ? "var(--accent)" : "var(--text-secondary)",
            fontWeight: isSelected ? 500 : 400,
            fontStyle: node.virtual ? "italic" : undefined,
          }}
        >
          <span
            className="flex w-4 flex-shrink-0 items-center justify-center"
            role={hasChildren ? "button" : undefined}
            aria-label={
              hasChildren ? (effectiveExpanded ? "Réduire" : "Développer") : undefined
            }
            onClick={hasChildren ? handleChevron : undefined}
            style={hasChildren ? { cursor: "pointer" } : undefined}
          >
            {hasChildren ? (
              effectiveExpanded ? (
                <CaretDown size={12} />
              ) : (
                <CaretRight size={12} />
              )
            ) : null}
          </span>
          {tag ? (
            <span
              role="button"
              tabIndex={0}
              title="Changer la couleur"
              onClick={(e) => {
                e.stopPropagation();
                onCycleColor(tag);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onCycleColor(tag);
                }
              }}
              className="h-2.5 w-2.5 shrink-0 cursor-pointer rounded-full"
              style={{
                backgroundColor: node.color ?? "var(--text-muted)",
                border: "1px solid var(--border-subtle)",
              }}
            />
          ) : (
            <Hash size={12} style={{ color: "var(--text-muted)" }} />
          )}
          <span className="flex-1 truncate text-left">{node.name}</span>
          <span
            className="ml-1 flex-shrink-0 text-xs tabular-nums"
            style={{ color: "var(--text-muted)" }}
            title={
              node.ownCount === node.totalCount
                ? `${node.totalCount} entité${node.totalCount > 1 ? "s" : ""}`
                : `${node.ownCount} direct · ${node.totalCount} avec sous-tags`
            }
          >
            ({node.totalCount})
          </span>
        </Button>
      </div>
      {hasChildren && effectiveExpanded && (
        <div>
          {node.children.map((child) => (
            <TagNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelectPath={onSelectPath}
              openContextMenu={openContextMenu}
              buildMenu={buildMenu}
              tagsByPath={tagsByPath}
              onCycleColor={onCycleColor}
              forceExpand={forceExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}
