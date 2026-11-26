import { useEffect, useState } from "react";
import { searchThreadsPage, type EmailThread } from "@/lib/gmail";
import { ensureThread } from "@/lib/mail-sync";

/**
 * Tous les fils d'un sujet, lus par son label et non par la boîte : le miroir oublie un fil dès
 * qu'il est rangé, et sa réponse passerait alors pour manquante. `null` tant que rien n'est lu.
 * `refreshKey` change quand la composition du sujet a pu bouger.
 */
export function useSubjectThreads(
  clientId: string,
  accountId: string,
  labelName: string | null,
  refreshKey: unknown,
): EmailThread[] | null {
  const [threads, setThreads] = useState<EmailThread[] | null>(null);
  useEffect(() => {
    setThreads(null);
    if (!clientId || !labelName) return;
    let stale = false;
    // Syntaxe de recherche Gmail : espaces et « / » d'un nom de label deviennent des tirets.
    const query = `label:${labelName.toLowerCase().replace(/[\s/]+/g, "-")}`;
    searchThreadsPage(clientId, query, { maxResults: 30 })
      .then((page) => Promise.all(page.items.map((t) => ensureThread(clientId, accountId, t.id))))
      .then((list) => {
        if (!stale) setThreads(list);
      })
      .catch((err) => console.warn("[mail] sujet indisponible", err));
    return () => {
      stale = true;
    };
  }, [clientId, accountId, labelName, refreshKey]);
  return threads;
}
