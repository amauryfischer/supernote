"use client";

import { useEffect } from "react";
import { useSettings } from "@/components/settings/SettingsContext";
import { restoreServerToken } from "@/lib/google-drive";

/** Réchauffe le jeton Google au démarrage et au retour sur l'app : les polls gatés sur un jeton en cache reprennent sans clic. */
export function GoogleTokenRunner() {
  const { settings } = useSettings();
  const clientId = settings.googleDrive.clientId.trim();

  useEffect(() => {
    if (!clientId) return undefined;
    const restore = () => {
      if (document.visibilityState === "visible") void restoreServerToken(clientId);
    };
    restore();
    document.addEventListener("visibilitychange", restore);
    return () => document.removeEventListener("visibilitychange", restore);
  }, [clientId]);

  return null;
}
