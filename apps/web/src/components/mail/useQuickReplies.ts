import { useEffect, useState } from "react";
import { instantReplies, type MailAiThread } from "@/lib/mail-ai";

// Mémoire de session : rouvrir le composeur d'un fil déjà vu ne relance pas Ollama.
const cache = new Map<string, Promise<string[]>>();

/**
 * Réponses éclair d'un fil, générées paresseusement au premier `enabled`.
 * Erreur Ollama → liste vide, sans bruit : elles n'ont pas été demandées.
 */
export function useQuickReplies(threadId: string, thread: MailAiThread, enabled: boolean) {
  const [state, setState] = useState<{ id: string; items: string[]; busy: boolean }>({
    id: threadId,
    items: [],
    busy: false,
  });
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const dismissed = dismissedId === threadId;

  useEffect(() => {
    if (!enabled || dismissed) return undefined;
    let cancelled = false;
    let pending = cache.get(threadId);
    if (!pending) {
      pending = instantReplies(thread);
      cache.set(threadId, pending);
      pending.catch(() => cache.delete(threadId));
    }
    setState((s) => (s.id === threadId && s.items.length ? s : { id: threadId, items: [], busy: true }));
    // shortcut: le client Ollama n'accepte pas de signal, l'annulation ignore juste la réponse ; brancher un AbortSignal dans @supernote/ai si la charge GPU gêne.
    pending.then(
      (items) => !cancelled && setState({ id: threadId, items, busy: false }),
      () => !cancelled && setState({ id: threadId, items: [], busy: false }),
    );
    return () => {
      cancelled = true;
    };
    // `thread` dérive de `threadId` : une génération par fil, pas par rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, enabled, dismissed]);

  const current = state.id === threadId && !dismissed;
  return {
    items: current ? state.items : [],
    busy: current && enabled && state.busy,
    dismiss: () => setDismissedId(threadId),
  };
}
