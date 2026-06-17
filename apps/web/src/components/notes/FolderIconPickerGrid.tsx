/**
 * Virtualized picker grid over the full Phosphor icon set.
 *
 * The glyph NAMES are available synchronously, so the list, search and
 * virtualization work immediately; each visible cell lazy-loads its own glyph
 * chunk ({@link CustomFolderGlyph-style} via {@link loadFolderIcon}) and shows
 * a blank placeholder until it arrives. Every cell is identical, so we window
 * the visible rows from `scrollTop` alone — no measurement, no virtualization
 * library. Only ~100 cells mount at any scroll position even though the
 * catalogue holds ~1500 glyphs.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "@heroui/react";
import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  ALL_FOLDER_ICON_NAMES,
  loadedFolderIcon,
  loadFolderIcon,
} from "./folderIcons";

const COLS = 8;
const CELL = 44; // 36px button + 8px row gap
const VIEWPORT = 360;
const OVERSCAN = 2;

/** A single grid cell that lazy-loads its glyph and renders it once ready. */
function PickerIconCell({ name }: { name: string }) {
  const [Icon, setIcon] = useState<PhosphorIcon | null>(() =>
    loadedFolderIcon(name),
  );

  useEffect(() => {
    let alive = true;
    const cached = loadedFolderIcon(name);
    if (cached) {
      setIcon(() => cached);
      return;
    }
    setIcon(() => null);
    void loadFolderIcon(name).then((loaded) => {
      if (alive) setIcon(() => loaded);
    });
    return () => {
      alive = false;
    };
  }, [name]);

  return Icon ? (
    <Icon size={18} />
  ) : (
    <span style={{ width: 18, height: 18 }} aria-hidden />
  );
}

export interface IconPickerGridProps {
  onPick: (icon: string) => void;
  onReset: () => void;
}

export function IconPickerGrid({ onPick, onReset }: IconPickerGridProps) {
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Case-insensitive substring filter on the glyph name.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ALL_FOLDER_ICON_NAMES;
    return ALL_FOLDER_ICON_NAMES.filter((name) =>
      name.toLowerCase().includes(needle),
    );
  }, [query]);

  // A new result set must restart from the top, otherwise the window points at
  // rows that no longer exist.
  useEffect(() => {
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [query]);

  const rowCount = Math.ceil(filtered.length / COLS);
  const totalHeight = rowCount * CELL;
  const startRow = Math.max(0, Math.floor(scrollTop / CELL) - OVERSCAN);
  const endRow = Math.min(
    rowCount,
    Math.ceil((scrollTop + VIEWPORT) / CELL) + OVERSCAN,
  );

  const rows: Array<{ row: number; cells: string[] }> = [];
  for (let row = startRow; row < endRow; row++) {
    const cells: string[] = [];
    for (let col = 0; col < COLS; col++) {
      const idx = row * COLS + col;
      if (idx >= filtered.length) break;
      cells.push(filtered[idx]!);
    }
    rows.push({ row, cells });
  }

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
          marginBottom: 6,
          outline: "none",
        }}
      />
      <div
        style={{
          fontSize: 11,
          color: "var(--text-muted, #6b7280)",
          padding: "0 2px 6px",
        }}
      >
        {filtered.length} icône{filtered.length > 1 ? "s" : ""}
      </div>
      {filtered.length === 0 ? (
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
        <div
          ref={scrollRef}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          style={{
            height: VIEWPORT,
            overflowY: "auto",
            paddingRight: 2,
          }}
        >
          {/* Spacer holds the full scroll height; rows are absolutely placed at
              their computed offset so only the visible window mounts. */}
          <div style={{ height: totalHeight, position: "relative" }}>
            {rows.map(({ row, cells }) => (
              <div
                key={row}
                style={{
                  position: "absolute",
                  top: row * CELL,
                  left: 0,
                  right: 0,
                  height: CELL,
                  display: "grid",
                  gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                  gap: 4,
                }}
              >
                {cells.map((name) => (
                  <Button
                    key={name}
                    onPress={() => onPick(name)}
                    aria-label={`Icône ${name}`}
                    style={{
                      width: 36,
                      height: 36,
                      minWidth: 36,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 6,
                      border: "1px solid transparent",
                      backgroundColor: "transparent",
                      cursor: "pointer",
                      padding: 0,
                      color: "var(--text-secondary, #374151)",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                        "var(--surface-2, #f3f4f6)";
                      (e.currentTarget as HTMLButtonElement).style.borderColor =
                        "var(--border-subtle, #e5e7eb)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                        "transparent";
                      (e.currentTarget as HTMLButtonElement).style.borderColor =
                        "transparent";
                    }}
                  >
                    <PickerIconCell name={name} />
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
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
