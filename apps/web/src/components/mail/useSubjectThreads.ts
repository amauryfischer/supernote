import { useEffect, useState } from "react";
import { searchThreadsPage, type EmailThread } from "@/lib/gmail";
import { ensureThread } from "@/lib/mail-sync";

/**
 * Tous les fils d'un sujet, lus par l'id de son label et non par la boîte : le miroir oublie un fil dès
 * qu'il est rangé, et sa réponse passerait alors pour manquante. `null` tant que rien n'est lu.
 * `knownMembers` = fils du sujet visibles dans la boîte : relance la lecture quand il bouge.
 */
export function useSubjectThreads(
  clientId: string,
  accountId: string,
  labelId: string | null,
  knownMembers: number,
): EmailThread[] | null {
  const [threads, setThreads] = useState<EmailThread[] | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => setRetry(0), [labelId, knownMembers]);
  useEffect(() => {
    if (retry === 0) setThreads(null);
    if (!clientId || !labelId) return;
    let stale = false;
    let timer = 0;
    searchThreadsPage(clientId, "", { maxResults: 30, labelIds: [labelId] })
      .then((page) => Promise.all(page.items.map((t) => ensureThread(clientId, accountId, t.id))))
      .then((list) => {
        if (stale) return;
        setThreads(list);
        // Un label posé à l'instant n'est pas encore dans la recherche Gmail : on relit, trois fois au plus.
        if (list.length < knownMembers && retry < 3) timer = window.setTimeout(() => setRetry((n) => n + 1), 2500);
      })
      .catch((err) => console.warn("[mail] sujet indisponible", err));
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [clientId, accountId, labelId, knownMembers, retry]);
  return threads;
}
