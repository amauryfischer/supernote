"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/components/settings/SettingsContext";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { MAIL_SYNCED_EVENT, mirrorAvailable } from "@/lib/mail-mirror";
import { formatAgo } from "@/lib/dateFormat";

/** Âge de la dernière synchro Gmail réussie (« il y a 2 min »), `null` si inconnue. */
export function useMailSyncAge(): string | null {
  const { settings } = useSettings();
  const accountId = settings.gmail.connectedEmail;
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [, setTick] = useState(0);

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

  return lastSyncAt ? formatAgo(lastSyncAt) : null;
}

export function MailSyncAge() {
  const age = useMailSyncAge();
  if (!age) return null;
  return (
    <span
      className="ml-2 shrink-0 whitespace-nowrap text-[12px]"
      style={{ color: "var(--text-muted)" }}
    >
      {age}
    </span>
  );
}
