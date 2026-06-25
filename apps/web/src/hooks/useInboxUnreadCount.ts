"use client";

import { useEffect, useRef, useState } from "react";
import { useSettings } from "@/components/settings";
import { useGmailConnected } from "@/hooks/useGmailConnected";
import { getInboxUnreadCount } from "@/lib/gmail";

/** Intervalle de rafraîchissement du compteur (poll léger, 1 appel REST). */
const POLL_MS = 120_000;

/**
 * Nombre de fils non lus en boîte de réception, pour le compteur discret de la
 * nav latérale (« Mail »). Renvoie 0 tant que Gmail n'est pas connecté ou en cas
 * d'erreur (le badge disparaît proprement, jamais d'exception remontée).
 *
 * Source : `getInboxUnreadCount` (labels.get sur INBOX → `threadsUnread`), scope
 * `gmail.readonly` déjà accordé. Rafraîchi au montage, à chaque retour d'onglet
 * (`visibilitychange`) et en poll doux (2 min). Le token étant caché par scope,
 * l'appel ne déclenche pas de pop-up de consentement une fois connecté.
 */
export function useInboxUnreadCount(): number {
  const { settings } = useSettings();
  const connected = useGmailConnected();
  const clientId = settings.googleDrive.clientId.trim();
  const [count, setCount] = useState(0);
  // Évite un setState après démontage (le fetch est asynchrone et peut résoudre
  // après que l'utilisateur a quitté la page).
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    if (!connected || !clientId) {
      setCount(0);
      return () => {
        aliveRef.current = false;
      };
    }
    let cancelled = false;
    const refresh = () => {
      getInboxUnreadCount(clientId)
        .then((n) => {
          if (!cancelled && aliveRef.current) setCount(n);
        })
        .catch(() => {
          // Erreur réseau / token expiré : on garde silencieux (pas de badge
          // erroné). La prochaine itération du poll retentera.
          if (!cancelled && aliveRef.current) setCount(0);
        });
    };
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      aliveRef.current = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [connected, clientId]);

  return count;
}
