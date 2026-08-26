"use client";

/**
 * AttachmentRouter — dispatches to the right viewer for a virtual-note
 * attachment entity.
 *
 * Entities surfaced by the worker's reindex loop for non-markdown files
 * (image, pdf, docx, xlsx, csv, gdoc, …) carry a `fields.attachmentFile`
 * pointing back at the on-disk file. The note page (`/notes/[id]`)
 * detects that field and renders us instead of the markdown editor /
 * canvas — we pick the appropriate viewer based on extension.
 *
 * Each viewer takes the same props (`{ note, path }`) and is responsible
 * for loading its own content via `useAttachmentBlob(path)`.
 */

import { Suspense } from "react";
import dynamic from "next/dynamic";
import type { Note } from "../notes/fixtures";

const ImageViewer = dynamic(
  () => import("./viewers/ImageViewer").then((m) => m.ImageViewer),
  { ssr: false, loading: () => <ViewerSpinner /> },
);
const PdfViewer = dynamic(
  () => import("./viewers/PdfViewer").then((m) => m.PdfViewer),
  { ssr: false, loading: () => <ViewerSpinner /> },
);
const CsvViewer = dynamic(
  () => import("./viewers/CsvViewer").then((m) => m.CsvViewer),
  { ssr: false, loading: () => <ViewerSpinner /> },
);
const GDocViewer = dynamic(
  () => import("./viewers/GDocViewer").then((m) => m.GDocViewer),
  { ssr: false, loading: () => <ViewerSpinner /> },
);
const DocxViewer = dynamic(
  () => import("./viewers/DocxViewer").then((m) => m.DocxViewer),
  { ssr: false, loading: () => <ViewerSpinner /> },
);
const XlsxViewer = dynamic(
  () => import("./viewers/XlsxViewer").then((m) => m.XlsxViewer),
  { ssr: false, loading: () => <ViewerSpinner /> },
);
const HtmlViewer = dynamic(
  () => import("./viewers/HtmlViewer").then((m) => m.HtmlViewer),
  { ssr: false, loading: () => <ViewerSpinner /> },
);

export interface AttachmentViewerProps {
  /** The virtual-note entity that points at the attachment file. */
  readonly note: Note;
  /** Vault-relative path of the on-disk attachment file. */
  readonly path: string;
}

interface AttachmentRouterProps {
  readonly note: Note;
}

const IMAGE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp",
]);
const OFFICE_DOCX = new Set([".docx", ".doc"]);
const OFFICE_XLSX = new Set([".xlsx", ".xls"]);
const CSV_EXTS = new Set([".csv", ".tsv"]);
const GDOC_EXTS = new Set([".gdoc", ".gsheet", ".gslides"]);
const HTML_EXTS = new Set([".html", ".htm"]);

function getExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export function AttachmentRouter({ note }: AttachmentRouterProps) {
  const attachment = note.fields?.["attachmentFile"];
  if (typeof attachment !== "string" || !attachment) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs"
           style={{ color: "var(--text-muted)" }}>
        Pas de pièce jointe attachée à cette note.
      </div>
    );
  }

  // Build the vault-relative path: same directory as the note, attachment
  // basename appended. note.filePath IS the attachment path for entities
  // surfaced from a non-markdown adopt — but for forward-compat (e.g. a
  // markdown note that gains an attachmentFile pointer later) we derive
  // from the dir.
  const noteFilePath = note.filePath ?? "";
  const dirEnd = noteFilePath.lastIndexOf("/");
  const dir = dirEnd >= 0 ? noteFilePath.slice(0, dirEnd) : "";
  const path = dir ? `${dir}/${attachment}` : attachment;
  const ext = getExt(attachment);

  let viewer: React.ReactNode;
  if (IMAGE_EXTS.has(ext)) {
    viewer = <ImageViewer note={note} path={path} />;
  } else if (ext === ".pdf") {
    viewer = <PdfViewer note={note} path={path} />;
  } else if (CSV_EXTS.has(ext)) {
    viewer = <CsvViewer note={note} path={path} />;
  } else if (GDOC_EXTS.has(ext)) {
    viewer = <GDocViewer note={note} path={path} />;
  } else if (OFFICE_DOCX.has(ext)) {
    viewer = <DocxViewer note={note} path={path} />;
  } else if (OFFICE_XLSX.has(ext)) {
    viewer = <XlsxViewer note={note} path={path} />;
  } else if (HTML_EXTS.has(ext)) {
    viewer = <HtmlViewer note={note} path={path} />;
  } else {
    viewer = (
      <div className="flex h-full w-full items-center justify-center text-xs"
           style={{ color: "var(--text-muted)" }}>
        Type de fichier non supporté : <code>{ext}</code>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden">
      <Suspense fallback={<ViewerSpinner />}>{viewer}</Suspense>
    </div>
  );
}

function ViewerSpinner() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
        style={{ borderColor: "var(--accent)" }}
      />
    </div>
  );
}
