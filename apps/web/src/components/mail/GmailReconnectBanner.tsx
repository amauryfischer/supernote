"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { Button, Spinner } from "@heroui/react";
import { WarningCircle } from "@phosphor-icons/react";
import { GMAIL_AUTH_EVENT, gmailReconnectRequired, reconnectGmail } from "@/lib/gmail";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(GMAIL_AUTH_EVENT, onChange);
  return () => window.removeEventListener(GMAIL_AUTH_EVENT, onChange);
}

/**
 * État « reconnexion Gmail requise » et l'action qui la lève. `reconnect` doit
 * partir d'un clic : la popup GIS est bloquée hors geste utilisateur.
 */
export function useGmailReconnect(clientId: string) {
  const required = useSyncExternalStore(subscribe, gmailReconnectRequired, () => false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reconnect = useCallback(() => {
    if (!clientId || busy) return;
    setBusy(true);
    setError(null);
    reconnectGmail(clientId)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  }, [clientId, busy]);

  return { required, busy, error, reconnect };
}

/** Bandeau persistant tant que Gmail refuse le jeton ; invisible sinon. */
export function GmailReconnectBanner({ clientId }: { clientId: string }) {
  const { required, busy, error, reconnect } = useGmailReconnect(clientId);
  if (!required) return null;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-sm"
      style={{
        background: "color-mix(in oklch, var(--warning) 14%, transparent)",
        borderColor: "var(--border-subtle)",
        color: "var(--text-primary)",
      }}
    >
      <WarningCircle size={16} weight="fill" aria-hidden style={{ color: "var(--warning)" }} />
      <span className="min-w-0 flex-1">
        Reconnexion Gmail requise : la liste et vos actions attendent un nouveau jeton.
        {error && (
          <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
            {error}
          </span>
        )}
      </span>
      <Button size="sm" variant="primary" isDisabled={busy} onPress={reconnect}>
        {busy ? <Spinner size="sm" aria-hidden /> : null}
        Reconnecter
      </Button>
    </div>
  );
}
