"use client";

/**
 * useMailMirror — write path du mail (mirror local + outbox).
 *
 * Trois primitives, extraites de la page pour qu'elle n'ait plus à connaître
 * la mécanique mirror/outbox :
 *
 *  - `patchMirror`   : patch best-effort du mirror SANS enqueue (l'appelant a
 *                      déjà poussé Gmail lui-même) ;
 *  - `pushOutboxNow` : flush en tâche de fond (coalescé par compte) ;
 *  - `commitMutation`: chemin OUTBOX-AUTHORITATIVE — persiste + enqueue + push,
 *                      et renvoie l'opId (pour l'« Annuler »). En mode limité
 *                      (pas de worker), retombe sur l'appel Gmail direct fourni
 *                      et renvoie null.
 */

import { useCallback } from "react";
import { mirrorAvailable, mirrorApplyMutation, type MirrorMutation } from "@/lib/mail-mirror";
import { flushOutbox } from "@/lib/mail-sync";

export interface MailMirrorApi {
  patchMirror: (m: MirrorMutation) => void;
  pushOutboxNow: () => void;
  commitMutation: (m: MirrorMutation, direct: () => Promise<void>) => Promise<string | null>;
}

export function useMailMirror(clientId: string, accountId: string): MailMirrorApi {
  const patchMirror = useCallback(
    (m: MirrorMutation) => {
      if (!mirrorAvailable() || !accountId) return;
      void mirrorApplyMutation(accountId, { ...m, enqueue: false }).catch(() => {
        /* best-effort : la reconciliation rattrapera toute dérive */
      });
    },
    [accountId],
  );

  const pushOutboxNow = useCallback(() => {
    if (!mirrorAvailable() || !accountId || !clientId) return;
    void flushOutbox(clientId, accountId).catch(() => {
      /* best-effort : retry au prochain flush / sync */
    });
  }, [accountId, clientId]);

  const commitMutation = useCallback(
    async (m: MirrorMutation, direct: () => Promise<void>): Promise<string | null> => {
      if (mirrorAvailable() && accountId) {
        const opId = await mirrorApplyMutation(accountId, { ...m, enqueue: true });
        pushOutboxNow();
        return opId;
      }
      await direct();
      return null;
    },
    [accountId, pushOutboxNow],
  );

  return { patchMirror, pushOutboxNow, commitMutation };
}
