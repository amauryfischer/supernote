import { useState } from "react";
import { Button, Spinner } from "@heroui/react";
import { WarningCircle } from "@phosphor-icons/react";
import { Tooltip } from "@supernote/ui";
import { useMailOutboxStatus } from "./useMailOutboxStatus";
import { mirrorRetryFailed } from "@/lib/mail-mirror";
import { flushOutbox } from "@/lib/mail-sync";

/**
 * Badge d'état de l'outbox mail (write path outbox-authoritative). Invisible
 * quand tout est synchronisé. Affiche :
 *  - « N en attente » (Spinner) : ops en cours d'envoi à Gmail (push background).
 *  - « N échec(s) » (cliquable) : ops ayant épuisé leurs retries → bouton réessayer
 *    (remet les ops en `pending` puis relance un flush).
 * No-op en mode limité (le hook renvoie 0/0).
 */
export function MailOutboxBadge({
  accountId,
  clientId,
}: {
  accountId: string;
  clientId: string;
}) {
  const { pending, failed } = useMailOutboxStatus(accountId);
  const [retrying, setRetrying] = useState(false);

  if (pending === 0 && failed === 0) return null;

  // Les échecs priment : ils demandent une action de l'utilisateur.
  if (failed > 0) {
    const onRetry = () => {
      if (retrying) return;
      setRetrying(true);
      void mirrorRetryFailed(accountId)
        .then(() => flushOutbox(clientId, accountId))
        .finally(() => setRetrying(false));
    };
    return (
      <Tooltip
        content={`${failed} action${failed > 1 ? "s" : ""} non synchronisée${
          failed > 1 ? "s" : ""
        } avec Gmail — cliquez pour réessayer`}
      >
        <Button
          variant="ghost"
          size="sm"
          onPress={onRetry}
          isDisabled={retrying}
          style={{ color: "var(--color-warning, #b45309)" }}
          aria-label={`${failed} action(s) en échec, réessayer la synchronisation`}
        >
          {retrying ? <Spinner size="sm" /> : <WarningCircle size={16} weight="fill" aria-hidden />}
          <span className="ml-1">
            {failed} échec{failed > 1 ? "s" : ""}
          </span>
        </Button>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={`${pending} action${pending > 1 ? "s" : ""} en cours d'envoi à Gmail`}>
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
        style={{ color: "var(--text-muted)", background: "var(--surface-2)" }}
      >
        <Spinner size="sm" aria-hidden />
        <span>
          {pending} en attente
        </span>
      </span>
    </Tooltip>
  );
}
