"use client";

import { Button, Spinner } from "@heroui/react";
import { DownloadSimple, ArrowSquareOut } from "@phosphor-icons/react";

import type { AttachmentViewerProps } from "../AttachmentRouter";
import { useAttachmentBlob } from "../useAttachmentBlob";

export function HtmlViewer({ path }: AttachmentViewerProps) {
  const { loading, error, text, objectUrl } = useAttachmentBlob(path);
  const basename = path.split("/").pop() ?? path;

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        Erreur lors du chargement : {error}
      </div>
    );
  }

  if (text === null) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        Contenu illisible (encodage non UTF-8).
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1"
        style={{ borderColor: "var(--border)" }}
      >
        <span className="truncate px-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {basename}
        </span>
        <div className="flex-1" />
        {objectUrl && (
          <a href={objectUrl} target="_blank" rel="noreferrer" tabIndex={-1}>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Ouvrir dans un nouvel onglet">
              <ArrowSquareOut size={16} weight="bold" />
            </Button>
          </a>
        )}
        {objectUrl && (
          <a href={objectUrl} download={basename} tabIndex={-1}>
            <Button isIconOnly size="sm" variant="ghost" aria-label="Télécharger">
              <DownloadSimple size={16} weight="bold" />
            </Button>
          </a>
        )}
      </div>
      <iframe
        title={basename}
        srcDoc={text}
        sandbox="allow-popups"
        referrerPolicy="no-referrer"
        className="flex-1"
        style={{ border: "none", background: "#fff" }}
      />
    </div>
  );
}
