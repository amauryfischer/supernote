"use client";

import { CaretDown, CaretRight, Folder, FolderOpen, Plus } from "@phosphor-icons/react";
import { useState } from "react";
import type { Folder as FolderType } from "./fixtures";

interface FileTreeProps {
  folders: FolderType[];
  selectedFolder: string | null;
  onSelectFolder: (path: string) => void;
  onNewFolder: () => void;
  onNewNote: () => void;
}

export function FileTree({
  folders,
  selectedFolder,
  onSelectFolder,
  onNewFolder,
  onNewNote,
}: FileTreeProps) {
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
          Vault
        </span>
        <div className="flex items-center gap-1">
          <ActionButton onClick={onNewNote} label="Nouvelle note" icon={<Plus size={13} />} />
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {folders.map((folder) => (
          <FolderNode
            key={folder.path}
            folder={folder}
            selectedFolder={selectedFolder}
            onSelectFolder={onSelectFolder}
            depth={0}
          />
        ))}
      </nav>

      <div
        className="border-t p-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <button
          onClick={onNewFolder}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-muted)" }}
        >
          <Plus size={12} />
          Nouveau dossier
        </button>
      </div>
    </aside>
  );
}

interface FolderNodeProps {
  folder: FolderType;
  selectedFolder: string | null;
  onSelectFolder: (path: string) => void;
  depth: number;
}

function FolderNode({ folder, selectedFolder, onSelectFolder, depth }: FolderNodeProps) {
  const hasChildren = !!folder.children?.length;
  const [expanded, setExpanded] = useState(depth === 0);
  const isSelected = selectedFolder === folder.path;

  const handleClick = () => {
    onSelectFolder(folder.path);
    if (hasChildren) setExpanded((v) => !v);
  };

  return (
    <div>
      <button
        onClick={handleClick}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors"
        style={{
          paddingLeft: `${8 + depth * 16}px`,
          backgroundColor: isSelected ? "var(--accent-subtle)" : undefined,
          color: isSelected ? "var(--accent)" : "var(--text-secondary)",
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
        <span className="flex w-4 flex-shrink-0 items-center justify-center">
          {hasChildren ? (
            expanded ? <CaretDown size={12} /> : <CaretRight size={12} />
          ) : null}
        </span>
        {isSelected ? <FolderOpen size={14} /> : <Folder size={14} />}
        <span className="flex-1 truncate text-left">{folder.name}</span>
      </button>

      {hasChildren && expanded && (
        <div>
          {folder.children!.map((child) => (
            <FolderNode
              key={child.path}
              folder={child}
              selectedFolder={selectedFolder}
              onSelectFolder={onSelectFolder}
              depth={depth + 1}
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
      className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
      style={{ color: "var(--text-muted)" }}
    >
      {icon}
    </button>
  );
}
