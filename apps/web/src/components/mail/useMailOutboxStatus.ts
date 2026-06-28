import { useState, useEffect, useCallback } from "react";
import {
  mirrorAvailable,
  mirrorOutboxStatus,
  MAIL_OUTBOX_EVENT,
  type MailOutboxStatus,
} from "@/lib/mail-mirror";

/** Filet de sécurité : capte les retries du pusher background (échec→push). */
const POLL_MS = 5000;

/**
 * Suit l'état de l'outbox mail (ops en attente / en échec) pour un compte.
 * Rafraîchit sur l'event `MAIL_OUTBOX_EVENT` (enqueue/cancel/flush/retry) +
 * poll de secours. Renvoie {pending:0, failed:0} si le mirror est indispo
 * (mode limité) — le badge ne s'affiche alors jamais.
 */
export function useMailOutboxStatus(accountId: string): MailOutboxStatus {
  const [status, setStatus] = useState<MailOutboxStatus>({ pending: 0, failed: 0 });

  const refresh = useCallback(() => {
    if (!mirrorAvailable() || !accountId) {
      setStatus({ pending: 0, failed: 0 });
      return;
    }
    void mirrorOutboxStatus(accountId)
      .then(setStatus)
      .catch(() => {
        /* best-effort : on garde le dernier état connu */
      });
  }, [accountId]);

  useEffect(() => {
    refresh();
    window.addEventListener(MAIL_OUTBOX_EVENT, refresh);
    const t = window.setInterval(refresh, POLL_MS);
    return () => {
      window.removeEventListener(MAIL_OUTBOX_EVENT, refresh);
      window.clearInterval(t);
    };
  }, [refresh]);

  return status;
}
