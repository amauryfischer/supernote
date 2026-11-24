"use client";

import { useEffect, useState } from "react";
import { DownloadSimple, FolderSimplePlus } from "@phosphor-icons/react";
import { Spinner } from "@heroui/react";
import { Button, Modal } from "@supernote/ui";
import { fetchAttachmentBlob, saveBlobAs, type EmailAttachment } from "@/lib/gmail";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { useActionFeedback, FeedbackIcon } from "@/lib/action-feedback";
import { useIsMobile } from "@/hooks/useIsMobile";

/** Chemin du coffre où ranger la pièce : suffixé par le message, deux « facture.pdf » ne s'écrasent pas. */
function vaultPathFor(att: EmailAttachment): string {
  const name = (att.filename || "piece-jointe").replace(/[\\/:*?"<>|]/g, "_");
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  return `Inbox/${base}-${att.messageId.slice(-6)}${ext}`;
}

/**
 * Aperçu d'une pièce jointe Gmail sans la télécharger sur le disque. Image et
 * PDF sont rendus par le navigateur depuis un Blob (jamais d'HTML interprété) ;
 * les autres types se rangent dans le coffre, où leurs visionneuses les ouvrent.
 */
export function AttachmentPreviewModal({
  attachment,
  clientId,
  onClose,
}: {
  attachment: EmailAttachment;
  clientId: string;
  onClose: () => void;
}) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveFb = useActionFeedback();
  const isMobile = useIsMobile();

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchAttachmentBlob(clientId, attachment)
      .then((b) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(b);
        setBlob(b);
        setUrl(objectUrl);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [clientId, attachment]);

  const isImage = attachment.mimeType.startsWith("image/");
  // Les navigateurs mobiles n'affichent pas un PDF dans une iframe.
  const isPdf = attachment.mimeType === "application/pdf" && !isMobile;
  const path = vaultPathFor(attachment);

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={attachment.filename || "Pièce jointe"}
      size="xl"
    >
      <div className="flex flex-col gap-3">
        <div
          className="flex h-[65vh] items-center justify-center overflow-auto rounded-lg"
          style={{ backgroundColor: "var(--surface-2)" }}
        >
          {error ? (
            <p className="px-4 text-sm" style={{ color: "var(--text-muted)" }}>
              Pièce jointe indisponible : {error}
            </p>
          ) : !url ? (
            <Spinner size="sm" aria-label="Chargement de la pièce jointe" />
          ) : isImage ? (
            <img src={url} alt={attachment.filename} className="max-h-full max-w-full object-contain" />
          ) : isPdf ? (
            <iframe src={url} title={attachment.filename} className="h-full w-full border-0" />
          ) : (
            <p className="px-4 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              Pas d'aperçu direct pour ce type. Range-la dans le coffre pour l'ouvrir dans Supernote, ou télécharge-la.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saveFb.state === "success" && (
            <span className="mr-auto truncate text-xs" style={{ color: "var(--text-muted)" }}>
              Rangée dans {path}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="flex min-h-8 items-center gap-1.5"
            isDisabled={!blob || saveFb.isPending}
            onPress={() => {
              if (!blob) return;
              void saveFb.run(async () => {
                await trpcVanillaClient.vault.writeFile.mutate({ path, bytes: await blob.arrayBuffer() });
              });
            }}
          >
            <FeedbackIcon state={saveFb.state} error={saveFb.error} idle={<FolderSimplePlus size={15} />} />
            Ranger dans le coffre
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex min-h-8 items-center gap-1.5"
            isDisabled={!blob}
            onPress={() => blob && saveBlobAs(blob, attachment.filename || "piece-jointe")}
          >
            <DownloadSimple size={15} />
            Télécharger
          </Button>
        </div>
      </div>
    </Modal>
  );
}
