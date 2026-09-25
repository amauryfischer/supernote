import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CalEventRow } from "@supernote/ipc";
import { useSettings } from "@/components/settings/SettingsContext";
import { useMailCommitments } from "@/components/mail/useMailCommitments";
import { trpc } from "@/lib/trpc/client";
import type { ThreadListItem } from "@/lib/gmail";
import { mirrorAvailable, mirrorSearchThreads } from "@/lib/mail-mirror";
import { BRIEF_ITEMS, briefPeople, briefSummary, mergeThreads, type ContactRow } from "@/lib/meeting-brief";

export function useBriefContacts(enabled: boolean): ContactRow[] {
  const query = trpc.entities.listSummaries.useQuery(
    { typeId: "personne", limit: 2000, offset: 0 },
    { enabled, staleTime: 60_000 },
  );
  return useMemo(
    () => (query.data?.items ?? []).map((c) => ({ id: c.id, fields: (c.fields ?? {}) as Record<string, unknown> })),
    [query.data],
  );
}

/**
 * Miroir local seulement : le brief doit s'afficher hors ligne, sur mobile compris.
 * Expéditeur seulement : `to:` scanne tous les destinataires stockés et reste vide sur mobile
 * (les messages ne voyagent pas), pour un coût de plusieurs secondes sur un gros miroir.
 */
export function usePersonThreads(emails: readonly string[], accountId: string): ThreadListItem[] {
  const query = useQuery({
    queryKey: ["meeting-brief-threads", accountId, emails.join(",")],
    enabled: !!accountId && emails.length > 0 && mirrorAvailable(),
    staleTime: 60_000,
    queryFn: async () =>
      mergeThreads(await Promise.all(emails.map((email) => mirrorSearchThreads(accountId, { from: [email], limit: BRIEF_ITEMS })))),
  });
  return query.data ?? [];
}

/** `event` = null hors de la fenêtre d'avant-réunion : pas de chargement de 2000 contacts pour rien. */
export function useBriefSummary(event: CalEventRow | null): string {
  const { settings } = useSettings();
  const contacts = useBriefContacts(!!event && event.attendees.length > 0);
  const { all } = useMailCommitments();
  if (!event) return "";
  return briefSummary(briefPeople(event, contacts).people, all, settings.gmail.connectedEmail);
}
