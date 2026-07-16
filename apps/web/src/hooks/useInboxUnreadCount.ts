"use client";

import { useEffect, useRef, useState } from "react";
import { useSettings } from "@/components/settings";
import { useGmailConnected } from "@/hooks/useGmailConnected";
import { getInboxUnreadCount, hasGmailToken } from "@/lib/gmail";

/** Intervalle de rafraîchissement du compteur (poll léger, 1 appel REST). */
const POLL_MS = 120_000;

/**
 * Nombre de fils non lus en boîte de réception, pour le compteur discret de la
 * nav latérale (« Mail »). Renvoie 0 tant que Gmail n'est pas connecté ou en cas
 * d'erreur (le badge disparaît proprement, jamais d'exception remontée).
 *
 * Source : `getInboxUnreadCount` (labels.get sur INBOX → `threadsUnread`), scope
 * `gmail.readonly` déjà accordé. Rafraîchi au montage, à chaque retour d'onglet
 * (`visibilitychange`) et en poll doux (2 min).
 *
 * IMPORTANT : ce hook tourne en arrière-plan (Sidebar toujours montée) — il ne
 * doit JAMAIS acquérir de token, seulement consommer un token déjà frais
 * (`hasGmailToken`). Le cache token est en mémoire et GIS ouvre une popup à
 * chaque acquisition ; sans ce gate, le poll rouvrait la fenêtre d'autorisation
 * Google toutes les 2 min dès que le cache était froid (reload, expiration,
 * échec). Le token est (ré)acquis par les surfaces interactives — ouverture de
 * la page Mail, bouton Connecter — et le compteur reprend au poll suivant.
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
      // Pas de token frais en cache → on ne tente rien (une acquisition
      // ouvrirait la popup GIS hors user gesture). On garde le dernier compte
      // connu ; la prochaine itération après ré-acquisition rattrapera.
      if (!hasGmailToken(clientId)) return;
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
