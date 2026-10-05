"use client";

import { useEffect, useState } from "react";
import { Button, Spinner } from "@heroui/react";
import { ArrowsClockwise, WarningCircle } from "@phosphor-icons/react";
import { Tooltip } from "@supernote/ui";
import { useSettings } from "@/components/settings/SettingsContext";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { MAIL_SYNCED_EVENT, MAIL_SYNC_STATE_EVENT, mirrorAvailable } from "@/lib/mail-mirror";
import { isMailSyncing, mailSyncFailed } from "@/lib/mail-sync";
import { formatAgo } from "@/lib/dateFormat";

/** Demande à la page /mail une resynchro complète (Gmail → miroir → liste). */
export const MAIL_SYNC_REQUEST_EVENT = "supernote:mail-sync-request";

/** Âge de la dernière synchro Gmail réussie (« il y a 2 min »), `null` si inconnue ; `syncing` pendant une synchro. */
export function useMailSyncAge(): { age: string | null; syncing: boolean; failed: boolean } {
  const { settings } = useSettings();
  const accountId = settings.gmail.connectedEmail;
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [, setTick] = useState(0);
  const [syncing, setSyncing] = useState(isMailSyncing);
  const [failed, setFailed] = useState(mailSyncFailed);

  useEffect(() => {
    const onState = () => {
      setSyncing(isMailSyncing());
      setFailed(mailSyncFailed());
    };
    onState();
    window.addEventListener(MAIL_SYNC_STATE_EVENT, onState);
    return () => window.removeEventListener(MAIL_SYNC_STATE_EVENT, onState);
  }, []);

  useEffect(() => {
    if (!accountId) return undefined;
    const read = () => {
      if (!mirrorAvailable()) return;
      trpcVanillaClient.mail.getState
        .query({ accountId })
        .then((s) => setLastSyncAt(s.lastSyncAt))
        .catch(() => {});
    };
    read();
    // Le worker n'est souvent pas prêt au montage : on relit aussi au début/fin de chaque synchro.
    window.addEventListener(MAIL_SYNCED_EVENT, read);
    window.addEventListener(MAIL_SYNC_STATE_EVENT, read);
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => {
      window.removeEventListener(MAIL_SYNCED_EVENT, read);
      window.removeEventListener(MAIL_SYNC_STATE_EVENT, read);
      window.clearInterval(id);
    };
  }, [accountId]);

  return { age: lastSyncAt ? formatAgo(lastSyncAt) : null, syncing, failed };
}

export function MailSyncAge() {
  const { settings } = useSettings();
  const { age, syncing, failed } = useMailSyncAge();
  if (!settings.gmail.connectedEmail) return null;
  const label = failed
    ? `Synchro échouée — dernière réussie : ${age ?? "jamais"}`
    : age
      ? `Synchronisé ${age}`
      : "Jamais synchronisé";
  return (
    <span
      className="ml-2 flex shrink-0 items-center gap-1 whitespace-nowrap text-[12px]"
      style={{ color: failed ? "var(--color-warning, #b45309)" : "var(--text-muted)" }}
      aria-live="polite"
    >
      {syncing ? (
        <>
          <Spinner size="sm" className="size-3" aria-hidden />
          Synchronisation…
        </>
      ) : (
        <>
          {failed && <WarningCircle size={14} weight="fill" aria-hidden />}
          {failed ? "Échec de synchro" : age}
        </>
      )}
      <Tooltip content={`${label} · Synchroniser maintenant`}>
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          isDisabled={syncing}
          onPress={() => window.dispatchEvent(new CustomEvent(MAIL_SYNC_REQUEST_EVENT))}
          aria-label="Synchroniser les mails maintenant"
        >
          <ArrowsClockwise size={14} aria-hidden />
        </Button>
      </Tooltip>
    </span>
  );
}
