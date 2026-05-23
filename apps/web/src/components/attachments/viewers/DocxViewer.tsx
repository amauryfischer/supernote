"use client";

import { useEffect, useMemo, useState } from "react";
import mammoth from "mammoth";
import { Button, Spinner } from "@heroui/react";
import { Download, Warning } from "@phosphor-icons/react";
import type { AttachmentViewerProps } from "../AttachmentRouter";
import { useAttachmentBlob } from "../useAttachmentBlob";

interface ConversionResult {
  html: string;
  warnings: string[];
  wordCount: number;
}

function countWords(html: string): number {
  const stripped = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return stripped ? stripped.split(" ").length : 0;
}

function downloadFile(bytes: ArrayBuffer, path: string): void {
  const name = path.split("/").pop() ?? "document.docx";
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function useDocxConversion(bytes: ArrayBuffer | null, isLegacyDoc: boolean) {
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  useEffect(() => {
    if (!bytes || isLegacyDoc) return;
    let cancelled = false;
    setConverting(true);
    setConvertError(null);
    mammoth
      .convertToHtml({ arrayBuffer: bytes }, { convertImage: mammoth.images.dataUri })
      .then((res) => {
        if (cancelled) return;
        const warnings = res.messages
          .filter((m) => m.type === "warning")
          .map((m) => m.message);
        setResult({ html: res.value, warnings, wordCount: countWords(res.value) });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setConvertError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setConverting(false);
      });
    return () => { cancelled = true; };
  }, [bytes, isLegacyDoc]);

  return { result, converting, convertError };
}

export function DocxViewer({ path }: AttachmentViewerProps) {
  const { loading, error, bytes } = useAttachmentBlob(path);
  const fileName = useMemo(() => path.split("/").pop() ?? path, [path]);
  const isLegacyDoc = path.toLowerCase().endsWith(".doc");
  const { result, converting, convertError } = useDocxConversion(
    isLegacyDoc ? null : (bytes ?? null),
    isLegacyDoc,
  );

  if (loading || converting) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (error || convertError) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {error ?? convertError}
        </span>
        {bytes && (
          <Button size="sm" variant="ghost"
            onPress={() => downloadFile(bytes, path)}>
            <Download size={14} />
            Télécharger
          </Button>
        )}
      </div>
    );
  }

  if (isLegacyDoc) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          Format .doc non supporté (utilisez .docx)
        </span>
        {bytes && (
          <Button size="sm" variant="ghost"
            onPress={() => downloadFile(bytes, path)}>
            <Download size={14} />
            Télécharger
          </Button>
        )}
      </div>
    );
  }

  if (!result) return null;

  const pageEquiv = Math.max(1, Math.round(result.wordCount / 250));

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div
        className="flex shrink-0 items-center gap-3 border-b px-4 py-2"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="truncate text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {fileName}
        </span>
        <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
          ~{result.wordCount} mots · ~{pageEquiv} p.
        </span>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            isDisabled={!bytes}
            onPress={() => bytes && downloadFile(bytes, path)}
          >
            <Download size={14} />
            Télécharger
          </Button>
        </div>
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div
          className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-xs"
          style={{ borderColor: "var(--border)", color: "var(--text-muted)", background: "var(--surface-raised, #f8f8f8)" }}
        >
          <Warning size={14} />
          {result.warnings.join(" · ")}
        </div>
      )}

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
        <div
          className="docx-prose mx-auto max-w-3xl"
          style={{ color: "var(--text-primary)" }}
          dangerouslySetInnerHTML={{ __html: result.html }}
        />
      </div>

      <style>{`
        .docx-prose { line-height: 1.7; font-size: 0.9375rem; }
        .docx-prose h1, .docx-prose h2, .docx-prose h3, .docx-prose h4 {
          font-weight: 600; margin: 1.25em 0 0.5em; color: var(--text-primary);
        }
        .docx-prose h1 { font-size: 1.6rem; }
        .docx-prose h2 { font-size: 1.3rem; }
        .docx-prose h3 { font-size: 1.1rem; }
        .docx-prose p { margin: 0.6em 0; }
        .docx-prose ul, .docx-prose ol { padding-left: 1.5rem; margin: 0.5em 0; }
        .docx-prose li { margin: 0.25em 0; }
        .docx-prose table { border-collapse: collapse; width: 100%; margin: 1em 0; }
        .docx-prose td, .docx-prose th {
          border: 1px solid var(--border); padding: 0.4rem 0.75rem; text-align: left;
        }
        .docx-prose strong { font-weight: 600; }
        .docx-prose em { font-style: italic; }
        .docx-prose img { max-width: 100%; height: auto; border-radius: 4px; }
        .docx-prose a { color: var(--accent); text-decoration: underline; }
      `}</style>
    </div>
  );
}
