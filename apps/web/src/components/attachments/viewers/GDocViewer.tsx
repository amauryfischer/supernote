"use client";

import { useMemo } from "react";
import { Button, Chip, Spinner } from "@heroui/react";
import { ArrowSquareOut } from "@phosphor-icons/react";

import type { AttachmentViewerProps } from "../AttachmentRouter";
import { useAttachmentBlob } from "../useAttachmentBlob";

interface GDocPointer {
  url?: string;
  doc_id?: string;
  resource_id?: string;
}

type GDocType = "document" | "spreadsheets" | "presentation";

const EXT_TO_TYPE: Record<string, GDocType> = {
  ".gdoc": "document",
  ".gsheet": "spreadsheets",
  ".gslides": "presentation",
};

const TYPE_LABELS: Record<GDocType, string> = {
  document: "Google Docs",
  spreadsheets: "Google Sheets",
  presentation: "Google Slides",
};

function getExt(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

function docIdFromUrl(url: string): string | null {
  const m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? null;
}

function buildEmbedUrl(docId: string, type: GDocType): string {
  return `https://docs.google.com/${type}/d/${docId}/preview`;
}

export function GDocViewer({ path }: AttachmentViewerProps) {
  const { loading, error, text } = useAttachmentBlob(path);

  const basename = path.split("/").pop() ?? path;
  const ext = getExt(path);
  const docType: GDocType = EXT_TO_TYPE[ext] ?? "document";

  const parsed = useMemo<{ docId: string; originalUrl: string } | null>(() => {
    if (!text) return null;
    try {
      const pointer = JSON.parse(text) as GDocPointer;
      const docId: string | null =
        pointer.doc_id ??
        (pointer.url ? docIdFromUrl(pointer.url) : null);
      if (!docId) return null;
      const originalUrl =
        pointer.url ??
        `https://docs.google.com/${docType}/d/${docId}/edit`;
      return { docId, originalUrl };
    } catch {
      return null;
    }
  }, [text, docType]);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs"
           style={{ color: "var(--text-muted)" }}>
        Erreur de chargement : {error}
      </div>
    );
  }

  if (!parsed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-xs"
           style={{ color: "var(--text-muted)" }}>
        <span>Impossible de lire le fichier Google Workspace.</span>
        {text && (
          <code className="max-w-md break-all rounded px-2 py-1 text-[10px]"
                style={{ background: "var(--bg-subtle)" }}>
            {text.slice(0, 200)}
          </code>
        )}
      </div>
    );
  }

  const embedUrl = buildEmbedUrl(parsed.docId, docType);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5"
           style={{ borderColor: "var(--border)", background: "var(--bg-toolbar, var(--bg))" }}>
        <Chip size="sm" variant="soft" color="default" className="shrink-0">
          {TYPE_LABELS[docType]}
        </Chip>
        <span className="flex-1 truncate text-sm">{basename}</span>
        <Button
          size="sm"
          variant="ghost"
          onPress={() => window.open(parsed.originalUrl, "_blank", "noopener")}
        >
          Ouvrir dans Google
          <ArrowSquareOut size={14} />
        </Button>
      </div>

      {/* Embed */}
      <iframe
        src={embedUrl}
        className="h-full w-full flex-1 border-none"
        title={basename}
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
