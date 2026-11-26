import { useEffect, useRef, useState } from "react";
import { googleQuotaBlockedUntil } from "@/lib/google-api";
import type { ThreadListItem } from "@/lib/gmail";
import { isSelfAddress } from "@/lib/mail-awaiting";
import { mirrorAvailable, mirrorGetThread } from "@/lib/mail-mirror";
import { ensureThread } from "@/lib/mail-sync";
import { rememberSubjectTally, tourDeTable } from "@/lib/mail-tour";

const SCAN_LIMIT = 80;
// Lectures Gmail par session : le quota du compte est partagé avec un consommateur inconnu.
const FETCH_LIMIT = 12;

/**
 * Décompte « 2/6 » des fils de la boîte, calculé au repos. Le miroir local sert d'abord ; seuls
 * les fils où j'ai parlé en dernier (une demande sans réponse) sont lus chez Gmail, une fois.
 * ⚠️ Lire tous les fils récents en fond perturbait la liste mobile (feuille d'actions refermée).
 */
export function useTourTallies(
  clientId: string,
  accountId: string,
  items: readonly ThreadListItem[],
  selfEmails: readonly string[],
): number {
  const seen = useRef(new Map<string, string>());
  const fetched = useRef(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!clientId || !accountId || !mirrorAvailable()) return;
    const todo = items.slice(0, SCAN_LIMIT).filter((it) => seen.current.get(it.id) !== it.date);
    if (todo.length === 0) return;
    let stale = false;
    const timer = window.setTimeout(async () => {
      for (const it of todo) {
        if (stale) return;
        let thread = await mirrorGetThread(accountId, it.id)
          .then((c) => (c?.complete ? c.thread : null))
          .catch(() => null);
        const mine = isSelfAddress(it.from.email, selfEmails);
        if (!thread && mine && fetched.current < FETCH_LIMIT && !googleQuotaBlockedUntil("gmail")) {
          fetched.current += 1;
          thread = await ensureThread(clientId, accountId, it.id).catch(() => null);
        }
        if (!thread) continue;
        seen.current.set(it.id, it.date);
        rememberSubjectTally(it.id, tourDeTable([thread], selfEmails));
      }
      if (!stale) setTick((n) => n + 1);
    }, 1500);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [clientId, accountId, items, selfEmails]);
  return tick;
}
