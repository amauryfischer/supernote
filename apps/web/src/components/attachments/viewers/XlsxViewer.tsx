"use client";

import { useCallback, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Button, Spinner } from "@heroui/react";
import { Download, Plus } from "@phosphor-icons/react";
import type { AttachmentViewerProps } from "../AttachmentRouter";
import { useAttachmentBlob } from "../useAttachmentBlob";
import { useAttachmentSave } from "../useAttachmentSave";
import type { AttachmentSaveStatus } from "../useAttachmentSave";

const MAX_EDITABLE_ROWS = 5000;

/** 2D string grid for a single sheet. Row 0 = header row. */
type Grid = string[][];

type SheetsState = Record<string, Grid>;

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

function buildGrid(sheet: XLSX.WorkSheet): Grid {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  });
  return raw.map((row) => (row as unknown[]).map((v) => String(v ?? "")));
}

function parseToGrids(bytes: ArrayBuffer): { wb: XLSX.WorkBook; grids: SheetsState } {
  const wb = XLSX.read(new Uint8Array(bytes), { type: "array" });
  const grids: SheetsState = {};
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    grids[name] = sheet ? buildGrid(sheet) : [[]];
  }
  return { wb, grids };
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

function serializeWorkbook(wb: XLSX.WorkBook, grids: SheetsState): ArrayBuffer {
  for (const name of wb.SheetNames) {
    const grid = grids[name];
    if (grid) {
      wb.Sheets[name] = XLSX.utils.aoa_to_sheet(grid);
    }
  }
  const raw = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as Uint8Array;
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

function downloadXlsx(bytes: ArrayBuffer, path: string): void {
  const name = path.split("/").pop() ?? "export.xlsx";
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// SaveIndicator
// ---------------------------------------------------------------------------

function SaveIndicator({ status, error }: { status: AttachmentSaveStatus; error: string | null }) {
  if (status === "idle") return null;
  const label =
    status === "saving"
      ? "Enregistrement…"
      : status === "saved"
        ? "Enregistré"
        : `Erreur${error ? ": " + error : ""}`;
  const color =
    status === "error" ? "var(--color-danger, #ef4444)" : "var(--text-muted)";
  return (
    <span className="text-xs" style={{ color }}>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ReadOnly table (sheets > MAX_EDITABLE_ROWS)
// ---------------------------------------------------------------------------

function ReadOnlySheet({ grid, totalRows }: { grid: Grid; totalRows: number }) {
  const headers = grid[0] ?? [];
  const rows = grid.slice(1, MAX_EDITABLE_ROWS + 1);
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className="shrink-0 px-4 py-1 text-xs"
        style={{ color: "var(--text-muted)", background: "var(--warning-bg, #fef3c7)" }}
      >
        Feuille trop grande ({totalRows} lignes) — lecture seule. Affichage limité à{" "}
        {MAX_EDITABLE_ROWS} lignes.
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead
            className="sticky top-0 z-10"
            style={{ background: "var(--surface-raised, #f8f8f8)" }}
          >
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  className="border-b px-3 py-2 text-left text-xs font-medium"
                  style={{ borderColor: "var(--border)", color: "var(--text-muted)", whiteSpace: "nowrap" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr
                key={ri}
                style={{ background: ri % 2 === 0 ? "transparent" : "var(--surface-stripe, rgba(0,0,0,.02))" }}
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="border-b px-3 py-1.5 text-xs"
                    style={{ borderColor: "var(--border)", maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={cell}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable sheet
// ---------------------------------------------------------------------------

interface EditableSheetProps {
  grid: Grid;
  onCellChange: (ri: number, ci: number, value: string) => void;
}

function EditableSheet({ grid, onCellChange }: EditableSheetProps) {
  const colCount = grid.reduce((max, row) => Math.max(max, row.length), 0);
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="min-w-full border-collapse text-sm">
        <tbody>
          {grid.map((row, ri) => (
            <tr key={ri}>
              {Array.from({ length: colCount }, (_, ci) => {
                const cell = row[ci] ?? "";
                const isHeader = ri === 0;
                return (
                  <td
                    key={ci}
                    className="border-b border-r p-0"
                    style={{ borderColor: "var(--border)", minWidth: "80px" }}
                  >
                    <input
                      type="text"
                      value={cell}
                      onChange={(e) => onCellChange(ri, ci, e.target.value)}
                      className="w-full px-2 py-1 text-xs outline-none focus:bg-[var(--surface-hover)]"
                      style={{
                        background: isHeader ? "var(--surface-raised, #f8f8f8)" : "transparent",
                        fontWeight: isHeader ? 500 : 400,
                        color: "var(--text)",
                        minWidth: "80px",
                      }}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function XlsxViewer({ path }: AttachmentViewerProps) {
  const { loading, error, bytes } = useAttachmentBlob(path);
  const { status: saveStatus, error: saveError, enqueue } = useAttachmentSave(path);

  const [activeSheet, setActiveSheet] = useState<string | null>(null);

  // Parsed workbook reference + mutable grid state
  const parsed = useMemo<{ wb: XLSX.WorkBook; grids: SheetsState } | null>(() => {
    if (!bytes) return null;
    try {
      return parseToGrids(bytes);
    } catch {
      return null;
    }
  }, [bytes]);

  const [grids, setGrids] = useState<SheetsState | null>(null);

  // Sync grids from parsed on first load (don't overwrite user edits on re-render)
  useMemo(() => {
    if (parsed && !grids) {
      setGrids(parsed.grids);
    }
  }, [parsed, grids]);

  const sheetNames = parsed?.wb.SheetNames ?? [];
  const currentSheetName = activeSheet ?? sheetNames[0] ?? null;
  const currentGrid = currentSheetName && grids ? (grids[currentSheetName] ?? null) : null;
  const isLarge = (currentGrid?.length ?? 0) > MAX_EDITABLE_ROWS;
  const rowCount = currentGrid ? currentGrid.length : 0;
  const colCount = currentGrid ? currentGrid.reduce((m, r) => Math.max(m, r.length), 0) : 0;

  const triggerSave = useCallback(
    (nextGrids: SheetsState) => {
      if (!parsed) return;
      const buf = serializeWorkbook(parsed.wb, nextGrids);
      enqueue(buf);
    },
    [parsed, enqueue],
  );

  const handleCellChange = useCallback(
    (ri: number, ci: number, value: string) => {
      if (!currentSheetName || !grids) return;
      setGrids((prev) => {
        if (!prev) return prev;
        const sheet = prev[currentSheetName] ? [...prev[currentSheetName]!] : [];
        const row = sheet[ri] ? [...sheet[ri]!] : [];
        row[ci] = value;
        sheet[ri] = row;
        const next = { ...prev, [currentSheetName]: sheet };
        triggerSave(next);
        return next;
      });
    },
    [currentSheetName, grids, triggerSave],
  );

  const handleAddRow = useCallback(() => {
    if (!currentSheetName || !grids) return;
    setGrids((prev) => {
      if (!prev) return prev;
      const sheet = prev[currentSheetName] ?? [];
      const width = sheet.reduce((m, r) => Math.max(m, r.length), 0);
      const next = { ...prev, [currentSheetName]: [...sheet, Array<string>(width).fill("")] };
      triggerSave(next);
      return next;
    });
  }, [currentSheetName, grids, triggerSave]);

  const handleAddCol = useCallback(() => {
    if (!currentSheetName || !grids) return;
    setGrids((prev) => {
      if (!prev) return prev;
      const sheet = prev[currentSheetName] ?? [];
      const next = { ...prev, [currentSheetName]: sheet.map((r) => [...r, ""]) };
      triggerSave(next);
      return next;
    });
  }, [currentSheetName, grids, triggerSave]);

  const handleDownload = useCallback(() => {
    if (!parsed || !grids) return;
    const buf = serializeWorkbook(parsed.wb, grids);
    downloadXlsx(buf, path);
  }, [parsed, grids, path]);

  // ----- render guards -----

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
        {error}
      </div>
    );
  }

  if (!parsed || !grids) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
        Impossible de parser le fichier Excel.
      </div>
    );
  }

  if (sheetNames.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
        Classeur vide.
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div
        className="flex shrink-0 items-center gap-3 border-b px-4 py-2"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {rowCount} lignes · {colCount} colonnes
        </span>

        {!isLarge && (
          <>
            <Button size="sm" variant="ghost" onPress={handleAddRow}>
              <Plus size={12} />
              Ajouter une ligne
            </Button>
            <Button size="sm" variant="ghost" onPress={handleAddCol}>
              <Plus size={12} />
              Ajouter une colonne
            </Button>
          </>
        )}

        <div className="ml-auto flex items-center gap-3">
          <SaveIndicator status={saveStatus} error={saveError} />
          <Button size="sm" variant="ghost" onPress={handleDownload}>
            <Download size={14} />
            Télécharger
          </Button>
        </div>
      </div>

      {/* Sheet tabs */}
      <div className="shrink-0 border-b px-2" style={{ borderColor: "var(--border)" }}>
        <div className="flex gap-1 overflow-x-auto py-1">
          {sheetNames.map((name) => {
            const active = name === currentSheetName;
            return (
              <Button
                key={name}
                size="sm"
                variant={active ? "primary" : "ghost"}
                onPress={() => setActiveSheet(name)}
              >
                {name}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Sheet content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {currentGrid && currentSheetName && (
          isLarge ? (
            <ReadOnlySheet grid={currentGrid} totalRows={rowCount} />
          ) : (
            <EditableSheet
              grid={currentGrid}
              onCellChange={handleCellChange}
            />
          )
        )}
      </div>
    </div>
  );
}
