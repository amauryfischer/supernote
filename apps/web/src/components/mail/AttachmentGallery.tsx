"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowSquareOut, File, FileDoc, FileImage, FilePdf, FileXls, FileZip } from "@phosphor-icons/react";
import { Button, Modal, Select, Skeleton, Tooltip } from "@supernote/ui";
import { formatBytes, listAttachments, type AttachmentHit } from "@/lib/gmail";
import { formatMailDate } from "@/lib/mail-date";
import { MobileSheet } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { AttachmentPreviewModal } from "./AttachmentPreviewModal";

export type GalleryScope =
  | { kind: "person"; email: string; name: string }
  | { kind: "label"; labelId: string; name: string };

const PAGE_MESSAGES = 30;

function FileIcon({ mime, name }: { mime: string; name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const props = { size: 22, "aria-hidden": true, className: "shrink-0" } as const;
  if (mime.startsWith("image/")) return <FileImage {...props} />;
  if (mime === "application/pdf" || ext === "pdf") return <FilePdf {...props} />;
  if (/sheet|excel|csv/.test(mime) || ["xls", "xlsx", "csv", "ods"].includes(ext)) return <FileXls {...props} />;
  if (/word|document/.test(mime) || ["doc", "docx", "odt"].includes(ext)) return <FileDoc {...props} />;
  if (/zip|compressed/.test(mime) || ["zip", "rar", "7z"].includes(ext)) return <FileZip {...props} />;
  return <File {...props} />;
}

/** Toutes les pièces jointes d'une personne ou d'un label, rien n'est téléchargé avant l'aperçu. */
export function AttachmentGallery({
  clientId,
  initialScope,
  labelNames,
  onClose,
  onOpenThread,
}: {
  clientId: string;
  initialScope: GalleryScope;
  labelNames: ReadonlyMap<string, string>;
  onClose: () => void;
  onOpenThread: (threadId: string) => void;
}) {
  const [scope, setScope] = useState<GalleryScope>(initialScope);
  const [items, setItems] = useState<AttachmentHit[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AttachmentHit | null>(null);
  const reqRef = useRef(0);
  const isMobile = useIsMobile();

  const load = async (target: GalleryScope, pageToken?: string) => {
    const req = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const page =
        target.kind === "person"
          ? await listAttachments(clientId, `from:${target.email} has:attachment`, { maxMessages: PAGE_MESSAGES, pageToken })
          : await listAttachments(clientId, "has:attachment", { maxMessages: PAGE_MESSAGES, pageToken, labelIds: [target.labelId] });
      if (req !== reqRef.current) return;
      setItems((prev) => (pageToken ? [...prev, ...page.items] : page.items));
      setNext(page.nextPageToken);
    } catch (err) {
      if (req === reqRef.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    setItems([]);
    setNext(undefined);
    void load(scope);
    // `load` lit `clientId`, stable pendant la vie de la galerie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const labelOptions = useMemo(
    () =>
      [...labelNames]
        .filter(([, name]) => !name.startsWith("Supernote/"))
        .sort((a, b) => a[1].localeCompare(b[1], "fr"))
        .map(([key, label]) => ({ key, label })),
    [labelNames],
  );

  const title = scope.kind === "person" ? `Pièces jointes de ${scope.name || scope.email}` : `Pièces jointes · ${scope.name}`;

  const body = (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {initialScope.kind === "person" && scope.kind === "label" && (
              <Button size="sm" variant="ghost" onPress={() => setScope(initialScope)}>
                ← {initialScope.name || initialScope.email}
              </Button>
            )}
            <Select
              aria-label="Voir les pièces jointes d'un label"
              placeholder="Pièces jointes d'un label…"
              options={labelOptions}
              selectedKey={scope.kind === "label" ? scope.labelId : undefined}
              onSelectionChange={(key) => setScope({ kind: "label", labelId: key, name: labelNames.get(key) ?? key })}
              className="w-full sm:w-64"
            />
          </div>

          {error && (
            <p role="alert" className="text-sm" style={{ color: "var(--color-danger)" }}>
              {error}
            </p>
          )}

          {items.length === 0 && loading && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-16 rounded-[var(--radius-md)]" />
              ))}
            </div>
          )}
          {items.length === 0 && !loading && !error && (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Aucune pièce jointe trouvée.
            </p>
          )}

          <ul className="grid max-h-[65vh] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {items.map((a) => (
              <li
                key={`${a.messageId}:${a.attachmentId}`}
                className="flex items-stretch rounded-[var(--radius-md)] border"
                style={{ borderColor: "var(--border-subtle)", background: "var(--surface-1)" }}
              >
                <Button
                  variant="ghost"
                  aria-label={`Aperçu de ${a.filename}`}
                  onPress={() => setPreview(a)}
                  className="h-auto min-h-16 min-w-0 flex-1 justify-start gap-2.5 px-3 py-2 text-left font-normal"
                >
                  <span style={{ color: "var(--text-muted)" }}>
                    <FileIcon mime={a.mimeType} name={a.filename} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
                      {a.filename}
                    </span>
                    <span className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {[scope.kind === "label" ? a.from.name || a.from.email : "", formatMailDate(a.date), a.size ? formatBytes(a.size) : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </Button>
                <Tooltip content={a.subject ? `Ouvrir le fil « ${a.subject} »` : "Ouvrir le fil"}>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Ouvrir le fil"
                    className="sn-hit h-auto min-h-16 w-10 min-w-10 shrink-0"
                    onPress={() => {
                      onOpenThread(a.threadId);
                      onClose();
                    }}
                  >
                    <ArrowSquareOut size={15} aria-hidden />
                  </Button>
                </Tooltip>
              </li>
            ))}
          </ul>

          {next && (
            <Button size="sm" variant="outline" isDisabled={loading} onPress={() => void load(scope, next)} className="self-center">
              {loading ? "Chargement…" : "Charger plus"}
            </Button>
          )}
        </div>
  );

  return (
    <>
      {isMobile ? (
        <MobileSheet isOpen onClose={onClose} title={title} size="lg">
          {body}
        </MobileSheet>
      ) : (
        <Modal isOpen onOpenChange={(open) => !open && onClose()} title={title} size="xl">
          {body}
        </Modal>
      )}
      {preview && <AttachmentPreviewModal attachment={preview} clientId={clientId} onClose={() => setPreview(null)} />}
    </>
  );
}
