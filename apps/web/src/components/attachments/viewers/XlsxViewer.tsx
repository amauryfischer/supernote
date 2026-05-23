"use client";

import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Button, Spinner } from "@heroui/react";
import { Download } from "@phosphor-icons/react";
import type { AttachmentViewerProps } from "../AttachmentRouter";
import { useAttachmentBlob } from "../useAttachmentBlob";

const MAX_ROWS = 5000;

interface ParsedSheet {
  name: string;
  headers: string[];
  rows: string[][];
  totalRows: number;
  colCount: number;
}

function parseWorkbook(bytes: ArrayBuffer): ParsedSheet[] {
  const wb = XLSX.read(new Uint8Array(bytes), { type: "array" });
  return wb.SheetNames.map((name) => {
    const sheet = wb.Sheets[name];
    if (!sheet) return { name, headers: [], rows: [], totalRows: 0, colCount: 0 };
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
    });
    const totalRows = raw.length > 0 ? raw.length - 1 : 0;
    const firstRow = raw.length > 0 ? (raw[0] as unknown[]) : [];
    const headers = firstRow.map((v) => String(v));
    const dataRows = raw.slice(1, MAX_ROWS + 1).map((r) => {
      const row = r as unknown[];
      return headers.map((_, ci) => String(row[ci] ?? ""));
    });
    return { name, headers, rows: dataRows, totalRows, colCount: headers.length };
  });
}

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

function SheetTable({ sheet }: { sheet: ParsedSheet }) {
  const truncated = sheet.totalRows > MAX_ROWS;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {truncated && (
        <div
          className="shrink-0 px-4 py-1 text-xs"
          style={{ color: "var(--text-muted)", background: "var(--warning-bg, #fef3c7)" }}
        >
          Affichage limité à {MAX_ROWS} lignes sur {sheet.totalRows}.
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead
            className="sticky top-0 z-10"
            style={{ background: "var(--surface-raised, #f8f8f8)" }}
          >
            <tr>
              {sheet.headers.map((h, i) => (
                <th
                  key={i}
                  className="border-b px-3 py-2 text-left text-xs font-medium"
                  style={{
                    borderColor: "var(--border)",
                    color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, ri) => (
              <tr
                key={ri}
                className="hover:bg-[var(--surface-hover)]"
                style={{
                  background:
                    ri % 2 === 0
                      ? "transparent"
                      : "var(--surface-stripe, rgba(0,0,0,.02))",
                }}
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="border-b px-3 py-1.5 text-xs"
                    style={{
                      borderColor: "var(--border)",
                      maxWidth: "300px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
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

export function XlsxViewer({ path }: AttachmentViewerProps) {
  const { loading, error, bytes } = useAttachmentBlob(path);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);

  const sheets = useMemo<ParsedSheet[] | null>(() => {
    if (!bytes) return null;
    try {
      return parseWorkbook(bytes);
    } catch {
      return null;
    }
  }, [bytes]);

  const parseError = !loading && !error && bytes && sheets === null;

  const currentSheetName = activeSheet ?? sheets?.[0]?.name ?? null;
  const currentSheet = sheets?.find((s) => s.name === currentSheetName) ?? null;

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (error || parseError) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        {error ?? "Impossible de parser le fichier Excel."}
      </div>
    );
  }

  if (!sheets || sheets.length === 0) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-xs"
        style={{ color: "var(--text-muted)" }}
      >
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
          {currentSheet
            ? `${currentSheet.totalRows} lignes · ${currentSheet.colCount} colonnes`
            : ""}
        </span>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            isDisabled={!bytes}
            onPress={() => { if (bytes) downloadXlsx(bytes, path); }}
          >
            <Download size={14} />
            Télécharger
          </Button>
        </div>
      </div>

      {/* Sheet tabs — plain button row (HeroUI v3 Tabs API doesn't fit a
          simple text-only tab strip; rolling our own keeps the visual
          consistent with the rest of the bases module). */}
      <div className="shrink-0 border-b px-2" style={{ borderColor: "var(--border)" }}>
        <div className="flex gap-1 overflow-x-auto py-1">
          {sheets.map((s) => {
            const active = s.name === currentSheetName;
            return (
              <Button
                key={s.name}
                size="sm"
                variant={active ? "primary" : "ghost"}
                onPress={() => setActiveSheet(s.name)}
              >
                {s.name}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Table area */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {currentSheet && <SheetTable sheet={currentSheet} />}
      </div>
    </div>
  );
}
