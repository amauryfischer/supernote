"use client";

import { useMemo, useState } from "react";
import Papa from "papaparse";
import { Button, Chip, Spinner } from "@heroui/react";
import { Download } from "@phosphor-icons/react";
import type { AttachmentViewerProps } from "../AttachmentRouter";
import { useAttachmentBlob } from "../useAttachmentBlob";

type Delimiter = "auto" | "," | ";" | "\t";

interface ParsedCsv {
  headers: string[];
  rows: string[][];
  rowCount: number;
  colCount: number;
}

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
  return { headers, rows, rowCount: rows.length, colCount: headers.length };
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

export function CsvViewer({ note: _note, path }: AttachmentViewerProps) {
  const { loading, error, text, bytes } = useAttachmentBlob(path);
  const [delimiter, setDelimiter] = useState<Delimiter>("auto");

  const isTsv = path.toLowerCase().endsWith(".tsv");

  const content = useMemo<string | null>(() => {
    if (text) return text;
    if (!bytes) return null;
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      return null;
    }
  }, [text, bytes]);

  const parsed = useMemo<ParsedCsv | null>(() => {
    if (!content) return null;
    return parseContent(content, delimiter, isTsv);
  }, [content, delimiter, isTsv]);

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

  if (!parsed) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs"
           style={{ color: "var(--text-muted)" }}>
        Erreur de parsing CSV.
      </div>
    );
  }

  const LARGE_THRESHOLD = 1000;
  const isLarge = parsed.rowCount > LARGE_THRESHOLD;

  const delimiterOptions: { label: string; value: Delimiter }[] = [
    { label: "Auto", value: "auto" },
    { label: "Virgule", value: "," },
    { label: "Point-virgule", value: ";" },
    { label: "Tab", value: "\t" },
  ];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2"
           style={{ borderColor: "var(--border)" }}>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {parsed.rowCount} lignes · {parsed.colCount} colonnes
        </span>

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

        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            isDisabled={!bytes}
            onPress={() => { if (bytes) downloadCsv(bytes, path); }}
          >
            <Download size={14} />
            Télécharger
          </Button>
        </div>
      </div>

      {isLarge && (
        <div className="shrink-0 px-4 py-1 text-xs"
             style={{ color: "var(--text-muted)", background: "var(--warning-bg, #fef3c7)" }}>
          Fichier volumineux ({parsed.rowCount} lignes) — affichage non virtualisé.
        </div>
      )}

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10" style={{ background: "var(--surface-raised, #f8f8f8)" }}>
            <tr>
              {parsed.headers.map((h, i) => (
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
            {parsed.rows.map((row, ri) => (
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
      </div>
    </div>
  );
}
