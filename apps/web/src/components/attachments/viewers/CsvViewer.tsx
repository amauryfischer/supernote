"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Button, Chip, Spinner } from "@heroui/react";
import { Download, Plus, Trash } from "@phosphor-icons/react";
import type { AttachmentViewerProps } from "../AttachmentRouter";
import { useAttachmentBlob } from "../useAttachmentBlob";
import { useAttachmentSave } from "../useAttachmentSave";

type Delimiter = "auto" | "," | ";" | "\t";

interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

const LARGE_THRESHOLD = 1000;

function parseContent(text: string, delimiter: Delimiter, isTsv: boolean): ParsedCsv {
  const delim = delimiter !== "auto" ? delimiter : isTsv ? "\t" : undefined;
  const opts: Papa.ParseConfig = {
    header: true,
    dynamicTyping: false,
    skipEmptyLines: true,
    ...(delim !== undefined ? { delimiter: delim } : {}),
  };
  const result = Papa.parse<Record<string, string>>(text, opts);
  const headers = result.meta.fields ?? [];
  const rows = result.data.map((row) => headers.map((h) => String(row[h] ?? "")));
  return { headers, rows };
}

function serializeToBytes(headers: string[], rows: string[][], delimiter: Delimiter): ArrayBuffer {
  const delim = delimiter === "auto" ? "," : delimiter;
  const objects = rows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = row[i] ?? ""; });
    return obj;
  });
  const csv = Papa.unparse(objects, { delimiter: delim, columns: headers });
  return new TextEncoder().encode(csv).buffer;
}

function downloadCsv(bytes: ArrayBuffer, path: string): void {
  const name = path.split("/").pop() ?? "export.csv";
  const blob = new Blob([bytes], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

interface SaveIndicatorProps {
  status: "idle" | "saving" | "saved" | "error";
}

function SaveIndicator({ status }: SaveIndicatorProps) {
  if (status === "idle") return null;
  const label =
    status === "saving" ? "Enregistrement…" :
    status === "saved" ? "Enregistré" :
    "Erreur";
  const color =
    status === "saving" ? "var(--text-muted)" :
    status === "saved" ? "var(--success, #16a34a)" :
    "var(--error, #dc2626)";
  return (
    <span className="text-xs" style={{ color }}>
      {label}
    </span>
  );
}

interface EditableTableProps {
  headers: string[];
  rows: string[][];
  onCellChange: (ri: number, ci: number, value: string) => void;
  onDeleteRow: (ri: number) => void;
}

function EditableTable({ headers, rows, onCellChange, onDeleteRow }: EditableTableProps) {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  return (
    <table className="min-w-full border-collapse text-sm">
      <thead className="sticky top-0 z-10" style={{ background: "var(--surface-raised, #f8f8f8)" }}>
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
          <th className="w-8 border-b" style={{ borderColor: "var(--border)" }} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr
            key={ri}
            style={{ background: ri % 2 === 0 ? "transparent" : "var(--surface-stripe, rgba(0,0,0,.02))" }}
            onMouseEnter={() => setHoveredRow(ri)}
            onMouseLeave={() => setHoveredRow(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              onDeleteRow(ri);
            }}
          >
            {row.map((cell, ci) => (
              <td
                key={ci}
                className="border-b px-1 py-0.5"
                style={{ borderColor: "var(--border)", minWidth: "80px", maxWidth: "300px" }}
              >
                <input
                  className="w-full bg-transparent px-2 py-1 text-xs outline-none focus:rounded focus:ring-1 focus:ring-[var(--accent)]"
                  value={cell}
                  onChange={(e) => onCellChange(ri, ci, e.target.value)}
                />
              </td>
            ))}
            <td className="border-b px-1 py-0.5" style={{ borderColor: "var(--border)" }}>
              {hoveredRow === ri && (
                <button
                  type="button"
                  onClick={() => onDeleteRow(ri)}
                  className="flex items-center justify-center rounded p-0.5 hover:bg-red-100"
                  style={{ color: "var(--text-muted)" }}
                  title="Supprimer cette ligne"
                >
                  <Trash size={12} />
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface ReadOnlyTableProps {
  headers: string[];
  rows: string[][];
}

function ReadOnlyTable({ headers, rows }: ReadOnlyTableProps) {
  return (
    <table className="min-w-full border-collapse text-sm">
      <thead className="sticky top-0 z-10" style={{ background: "var(--surface-raised, #f8f8f8)" }}>
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
            className="hover:bg-[var(--surface-hover)]"
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
  );
}

export function CsvViewer({ note: _note, path }: AttachmentViewerProps) {
  const { loading, error, text, bytes: initialBytes } = useAttachmentBlob(path);
  const { status: saveStatus, enqueue } = useAttachmentSave(path);
  const [delimiter, setDelimiter] = useState<Delimiter>("auto");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [initialized, setInitialized] = useState(false);
  const isTsv = path.toLowerCase().endsWith(".tsv");

  const content = useMemo<string | null>(() => {
    if (text) return text;
    if (!initialBytes) return null;
    try { return new TextDecoder("utf-8").decode(initialBytes); }
    catch { return null; }
  }, [text, initialBytes]);

  // Initialize editable state from parsed content (once loaded)
  useEffect(() => {
    if (!content || initialized) return;
    const parsed = parseContent(content, delimiter, isTsv);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setInitialized(true);
  }, [content, delimiter, isTsv, initialized]);

  // Re-parse when delimiter changes (reset editable state)
  const prevDelimRef = useRef(delimiter);
  useEffect(() => {
    if (prevDelimRef.current === delimiter) return;
    prevDelimRef.current = delimiter;
    if (!content) return;
    const parsed = parseContent(content, delimiter, isTsv);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
  }, [delimiter, content, isTsv]);

  const triggerSave = useCallback((nextHeaders: string[], nextRows: string[][]) => {
    const buf = serializeToBytes(nextHeaders, nextRows, delimiter);
    enqueue(buf);
  }, [delimiter, enqueue]);

  const handleCellChange = useCallback((ri: number, ci: number, value: string) => {
    setRows((prev) => {
      const next = prev.map((r, i) => i === ri ? r.map((c, j) => j === ci ? value : c) : r);
      triggerSave(headers, next);
      return next;
    });
  }, [headers, triggerSave]);

  const handleDeleteRow = useCallback((ri: number) => {
    setRows((prev) => {
      const next = prev.filter((_, i) => i !== ri);
      triggerSave(headers, next);
      return next;
    });
  }, [headers, triggerSave]);

  const handleAddRow = useCallback(() => {
    setRows((prev) => {
      const next = [...prev, headers.map(() => "")];
      triggerSave(headers, next);
      return next;
    });
  }, [headers, triggerSave]);

  const handleAddColumn = useCallback(() => {
    const newHeader = `Col${headers.length + 1}`;
    const nextHeaders = [...headers, newHeader];
    const nextRows = rows.map((r) => [...r, ""]);
    setHeaders(nextHeaders);
    setRows(nextRows);
    triggerSave(nextHeaders, nextRows);
  }, [headers, rows, triggerSave]);

  const handleDownload = useCallback(() => {
    const buf = serializeToBytes(headers, rows, delimiter);
    downloadCsv(buf, path);
  }, [headers, rows, delimiter, path]);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (error || !content) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs"
           style={{ color: "var(--text-muted)" }}>
        {error ?? "Impossible de lire le fichier."}
      </div>
    );
  }

  if (!initialized) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs"
           style={{ color: "var(--text-muted)" }}>
        Erreur de parsing CSV.
      </div>
    );
  }

  const isLarge = rows.length > LARGE_THRESHOLD;

  const delimiterOptions: { label: string; value: Delimiter }[] = [
    { label: "Auto", value: "auto" },
    { label: "Virgule", value: "," },
    { label: "Point-virgule", value: ";" },
    { label: "Tab", value: "\t" },
  ];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2"
           style={{ borderColor: "var(--border)" }}>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {rows.length} lignes · {headers.length} colonnes
        </span>

        {!isLarge && (
          <>
            <Button size="sm" variant="ghost" onPress={handleAddRow}>
              <Plus size={12} />
              Ajouter une ligne
            </Button>
            <Button size="sm" variant="ghost" onPress={handleAddColumn}>
              <Plus size={12} />
              Ajouter une colonne
            </Button>
          </>
        )}

        <div className="flex items-center gap-1">
          {delimiterOptions.map((opt) => (
            <Chip
              key={opt.value}
              size="sm"
              variant={delimiter === opt.value ? "primary" : "tertiary"}
              onClick={() => setDelimiter(opt.value)}
              className="cursor-pointer"
            >
              {opt.label}
            </Chip>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <SaveIndicator status={saveStatus} />
          <Button size="sm" variant="ghost" onPress={handleDownload}>
            <Download size={14} />
            Télécharger
          </Button>
        </div>
      </div>

      {isLarge && (
        <div className="shrink-0 px-4 py-1 text-xs"
             style={{ color: "var(--text-muted)", background: "var(--warning-bg, #fef3c7)" }}>
          Édition désactivée pour fichiers volumineux ({rows.length} lignes) — affichage seul.
        </div>
      )}

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        {isLarge ? (
          <ReadOnlyTable headers={headers} rows={rows} />
        ) : (
          <EditableTable
            headers={headers}
            rows={rows}
            onCellChange={handleCellChange}
            onDeleteRow={handleDeleteRow}
          />
        )}
      </div>
    </div>
  );
}
