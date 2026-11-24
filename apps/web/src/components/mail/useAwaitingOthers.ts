import { useEffect, useState } from "react";
import { GMAIL_AUTH_EVENT, hasGmailToken, listUnansweredSent, type ThreadListItem } from "@/lib/gmail";

const CACHE_KEY = "supernote.mail.awaitingOthers";
// ~26 appels Gmail par relecture : quatre fois par jour suffisent, la liste bouge en jours.
const TTL_MS = 6 * 3_600_000;

interface Cache {
  account: string;
  at: number;
  items: ThreadListItem[];
}

function readCache(account: string): Cache | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Cache | null;
    return c?.account === account ? c : null;
  } catch {
    return null;
  }
}

/** Fils où j'ai écrit en dernier, restés sans réponse depuis 3 à 30 jours (« en attente de l'autre »). */
export function useAwaitingOthers(clientId: string, selfAddresses: string[]): ThreadListItem[] {
  const account = selfAddresses[0] ?? "";
  const [items, setItems] = useState<ThreadListItem[]>(() => readCache(account)?.items ?? []);
  // Le jeton arrive souvent après le montage : on retente à chaque changement d'auth.
  const [authTick, setAuthTick] = useState(0);
  useEffect(() => {
    const onAuth = () => setAuthTick((n) => n + 1);
    window.addEventListener(GMAIL_AUTH_EVENT, onAuth);
    return () => window.removeEventListener(GMAIL_AUTH_EVENT, onAuth);
  }, []);

  useEffect(() => {
    if (!clientId || !account) return;
    const cached = readCache(account);
    setItems(cached?.items ?? []);
    // Jamais de popup d'auth pour une lecture de fond : on attend un jeton déjà là.
    if ((cached && Date.now() - cached.at < TTL_MS) || !hasGmailToken(clientId)) return;
    let stale = false;
    listUnansweredSent(clientId, selfAddresses)
      .then((fresh) => {
        if (stale) return;
        setItems(fresh);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ account, at: Date.now(), items: fresh } satisfies Cache));
        } catch {
          /* pas de cache : relu à la prochaine ouverture */
        }
      })
      .catch((err) => console.warn("[mail] « en attente » indisponible", err));
    return () => {
      stale = true;
    };
  }, [clientId, account, selfAddresses, authTick]);

  return items;
}
