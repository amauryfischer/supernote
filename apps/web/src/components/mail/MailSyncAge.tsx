"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@heroui/react";
import { useSettings } from "@/components/settings/SettingsContext";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { MAIL_SYNCED_EVENT, MAIL_SYNC_STATE_EVENT, mirrorAvailable } from "@/lib/mail-mirror";
import { isMailSyncing } from "@/lib/mail-sync";
import { formatAgo } from "@/lib/dateFormat";

/** Âge de la dernière synchro Gmail réussie (« il y a 2 min »), `null` si inconnue ; `syncing` pendant une synchro. */
export function useMailSyncAge(): { age: string | null; syncing: boolean } {
  const { settings } = useSettings();
  const accountId = settings.gmail.connectedEmail;
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [, setTick] = useState(0);
  const [syncing, setSyncing] = useState(isMailSyncing);

  useEffect(() => {
    const onState = () => setSyncing(isMailSyncing());
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
    window.addEventListener(MAIL_SYNCED_EVENT, read);
    const id = window.setInterval(() => setTick((t) => t + 1), 30_000);
    return () => {
      window.removeEventListener(MAIL_SYNCED_EVENT, read);
      window.clearInterval(id);
    };
  }, [accountId]);

  return { age: lastSyncAt ? formatAgo(lastSyncAt) : null, syncing };
}

export function MailSyncAge() {
  const { age, syncing } = useMailSyncAge();
  if (!age && !syncing) return null;
  return (
    <span
      className="ml-2 flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px]"
      style={{ color: "var(--text-muted)" }}
      aria-live="polite"
    >
      {syncing ? (
        <>
          <Spinner size="sm" className="size-3" aria-hidden />
          Synchronisation…
        </>
      ) : (
        age
      )}
    </span>
  );
}
