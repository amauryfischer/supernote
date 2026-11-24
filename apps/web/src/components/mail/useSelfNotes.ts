import { useEffect, useState } from "react";
import { GMAIL_AUTH_EVENT, hasGmailToken, searchThreadsPage } from "@/lib/gmail";

const CACHE_KEY = "supernote.mail.selfNotes";
const TTL_MS = 30 * 60_000;

interface Cache {
  account: string;
  at: number;
  ids: string[];
}

function readCache(account: string): Cache | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as Cache | null;
    return c?.account === account ? c : null;
  } catch {
    return null;
  }
}

/**
 * Fils de la boîte que l'utilisateur s'est envoyés à lui-même. La liste ne porte pas les destinataires :
 * sans cette requête, une réponse à un client (dernier message = moi) passerait pour une note à soi.
 * `null` tant que rien n'est connu. Un seul appel Gmail, mis en cache.
 */
export interface SelfNotes {
  ids: ReadonlySet<string>;
  /** Date du relevé : un fil plus récent n'y figure pas encore, il reste « inconnu ». */
  at: number;
}

const fromCache = (c: Cache | null): SelfNotes | null => (c ? { ids: new Set(c.ids), at: c.at } : null);

export function useSelfNotes(clientId: string, account: string, listLoaded: boolean): SelfNotes | null {
  const [ids, setIds] = useState<SelfNotes | null>(() => fromCache(readCache(account)));
  const [authTick, setAuthTick] = useState(0);
  useEffect(() => {
    const onAuth = () => setAuthTick((n) => n + 1);
    window.addEventListener(GMAIL_AUTH_EVENT, onAuth);
    return () => window.removeEventListener(GMAIL_AUTH_EVENT, onAuth);
  }, []);

  useEffect(() => {
    if (!clientId || !account) return;
    const cached = readCache(account);
    setIds(fromCache(cached));
    // Jamais de popup d'auth pour une lecture de fond : on attend un jeton déjà là.
    if ((cached && Date.now() - cached.at < TTL_MS) || !hasGmailToken(clientId)) return;
    let stale = false;
    searchThreadsPage(clientId, "in:inbox from:me to:me", { maxResults: 200 })
      .then((page) => {
        if (stale) return;
        const cache: Cache = { account, at: Date.now(), ids: page.items.map((t) => t.id) };
        setIds(fromCache(cache));
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch {
          /* pas de cache : relu à la prochaine ouverture */
        }
      })
      .catch((err) => console.warn("[mail] notes à soi indisponibles", err));
    return () => {
      stale = true;
    };
  // `listLoaded` : le premier jeton n'émet aucun événement, mais une liste chargée prouve qu'il est là.
  }, [clientId, account, authTick, listLoaded]);

  return ids;
}
