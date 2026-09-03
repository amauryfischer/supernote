"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Popover, Switch } from "@heroui/react";
import { ShareNetwork, Copy, Check } from "@phosphor-icons/react";
import { useToast } from "@supernote/ui";
import type { Note } from "./fixtures";
import { exportNoteHtml } from "@/lib/share/exportNoteHtml";
import {
  getShareStatus,
  publishShare,
  shareBackendInfo,
  shareUrl,
  unpublishShare,
  type ShareStatus,
} from "@/lib/share/shareApi";

const REPUBLISH_DEBOUNCE_MS = 4000;

function formatRelativeShort(ts: number): string {
  const min = Math.round((Date.now() - ts) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} j`;
}

/**
 * Header popover: publish/unpublish a note as a public read-only page
 * (`/s/:slug`, see `share-backend.mjs`). While published, edits are
 * republished automatically (debounced) so the link stays current without
 * a manual step.
 */
export function ShareNotePanel({
  note,
  resolveUrl,
}: {
  note: Note;
  /** Résolveur de chemin de coffre → `blob:` (même adaptateur que l'éditeur live), pour inliner les images dans l'export. */
  resolveUrl: (path: string) => Promise<string>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [backendEnabled, setBackendEnabled] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const republishTimer = useRef<number | null>(null);
  const bodyRef = useRef(note.body);
  bodyRef.current = note.body;

  useEffect(() => {
    if (!isOpen || backendEnabled !== null) return;
    void shareBackendInfo().then((info) => setBackendEnabled(info.enabled));
    void getShareStatus(note.id).then(setStatus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const publish = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const html = await exportNoteHtml(bodyRef.current, resolveUrl);
      const result = await publishShare(note.id, note.title || "Note sans titre", html);
      setStatus({ published: true, slug: result.slug, updatedAt: result.updatedAt });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la publication");
    } finally {
      setBusy(false);
    }
  }, [note.id, note.title, resolveUrl]);

  const handleToggle = useCallback(
    (next: boolean) => {
      if (next) {
        void publish();
        return;
      }
      setBusy(true);
      setError(null);
      void unpublishShare(note.id)
        .then(() => setStatus({ published: false }))
        .catch((err) => setError(err instanceof Error ? err.message : "Échec"))
        .finally(() => setBusy(false));
    },
    [note.id, publish],
  );

  // Republication silencieuse (debounced) tant que le partage est actif, pour
  // que le lien public suive les éditions sans étape manuelle.
  useEffect(() => {
    if (!status?.published) return undefined;
    if (republishTimer.current) window.clearTimeout(republishTimer.current);
    republishTimer.current = window.setTimeout(() => void publish(), REPUBLISH_DEBOUNCE_MS);
    return () => {
      if (republishTimer.current) window.clearTimeout(republishTimer.current);
    };
    // Se redéclenche sur le contenu (bodyRef suit note.body), pas sur `publish`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.body, status?.published]);

  const handleCopy = useCallback(() => {
    if (!status?.slug) return;
    void navigator.clipboard.writeText(shareUrl(status.slug)).then(() => {
      setCopied(true);
      toast({ title: "Lien copié" });
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [status?.slug, toast]);

  return (
    <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
      <Button
        variant="ghost"
        size="sm"
        className="sn-hit h-7 min-w-0 gap-1 px-2 text-xs"
        style={{ color: status?.published ? "var(--accent)" : "var(--text-muted)" }}
        aria-label="Partager la note"
      >
        <ShareNetwork size={13} weight={status?.published ? "fill" : "regular"} />
        Partager
      </Button>
      <Popover.Content className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <Popover.Dialog className="outline-none">
          <div className="flex flex-col gap-3 p-3" aria-label="Partager la note">
            <div className="flex items-center gap-1.5">
              <ShareNetwork size={12} weight="bold" style={{ color: "var(--text-muted)" }} />
              <span className="sn-eyebrow">Partage public</span>
            </div>

            {backendEnabled === false && (
              <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
                Le partage public n&apos;est pas disponible sur ce déploiement.
              </p>
            )}

            {backendEnabled && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
                    Lien public en lecture seule
                  </span>
                  <Switch
                    isSelected={!!status?.published}
                    onChange={handleToggle}
                    isDisabled={busy || status === null}
                    aria-label="Activer le partage public"
                  />
                </div>

                {status?.published && status.slug && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <Input
                        readOnly
                        value={shareUrl(status.slug)}
                        onFocus={(e) => e.currentTarget.select()}
                        className="min-w-0 flex-1"
                        aria-label="URL du partage"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onPress={handleCopy}
                        className="h-8 min-w-0 shrink-0 px-2"
                        aria-label="Copier le lien"
                      >
                        {copied ? <Check size={13} /> : <Copy size={13} />}
                      </Button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {busy
                          ? "Republication…"
                          : status.updatedAt
                            ? `Mis à jour il y a ${formatRelativeShort(status.updatedAt)}`
                            : ""}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onPress={() => void publish()}
                        isDisabled={busy}
                        className="h-6 min-w-0 px-1.5 text-[11px]"
                      >
                        Republier
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {error && (
              <p className="text-[12px]" style={{ color: "var(--destructive)" }}>
                {error}
              </p>
            )}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
