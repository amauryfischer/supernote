import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CalEventRow } from "@supernote/ipc";
import { useSettings } from "@/components/settings/SettingsContext";
import { CALENDAR_CHANGED_EVENT, calListEvents } from "@/lib/calendar-mirror";
import { calendarAccount } from "@/lib/calendar-sync";
import { mirrorAvailable } from "@/lib/mail-mirror";
import { addDays, startOfDay } from "@/lib/agenda/dates";

const HORIZON_DAYS = 60;
const NO_EVENTS: CalEventRow[] = [];

export interface ScheduledBlocks {
  accountId: string;
  events: CalEventRow[];
  blocks: ReadonlyMap<string, CalEventRow>;
}

export function useScheduledBlocks(): ScheduledBlocks {
  const { settings } = useSettings();
  const accountId = calendarAccount(settings)?.accountId ?? "";
  const qc = useQueryClient();
  const [from] = useState(() => startOfDay(Date.now()));
  const query = useQuery({
    queryKey: ["calendar", "scheduled", accountId, from],
    queryFn: () => calListEvents(accountId, from, addDays(from, HORIZON_DAYS)),
    enabled: !!accountId && mirrorAvailable(),
    staleTime: 30_000,
  });

  // Hors /agenda, useAgendaData n'est pas monté : personne d'autre n'invalide ce cache.
  useEffect(() => {
    const refresh = () => void qc.invalidateQueries({ queryKey: ["calendar", "scheduled"] });
    window.addEventListener(CALENDAR_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CALENDAR_CHANGED_EVENT, refresh);
  }, [qc]);

  const events = query.data ?? NO_EVENTS;
  const blocks = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, CalEventRow>();
    // listEvents trie par début : le premier bloc à venir gagne, c'est celui que montre la feuille.
    for (const ev of events) {
      if (ev.sourceRef && ev.endAt > now && !map.has(ev.sourceRef)) map.set(ev.sourceRef, ev);
    }
    return map;
  }, [events]);

  return { accountId, events, blocks };
}
