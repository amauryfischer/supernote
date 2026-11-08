"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/components/settings/SettingsContext";
import { DriveFolderBrowser } from "@/components/settings/drive-sync/DriveFolderBrowser";
import { DRIVE_FULL_SCOPE, requestAccessToken } from "@/lib/google-drive";
import { getLastVaultReady } from "@/lib/trpc/browser-link";
import { addLink, DRIVE_SYNC_OPEN_EVENT } from "./links";

/** Choix du dossier Drive ouvert depuis le menu d'un dossier de l'arbre (clic droit ou appui long). */
export function DriveSyncPicker() {
  const { settings } = useSettings();
  const clientId = settings.googleDrive.clientId.trim();
  const [vaultFolder, setVaultFolder] = useState<string | null>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const folder = (e as CustomEvent<{ vaultFolder: string }>).detail.vaultFolder;
      // Appelé dans le geste du menu : la popup Google d'accès complet à Drive n'est pas bloquée.
      requestAccessToken(clientId, { scope: DRIVE_FULL_SCOPE })
        .then(() => setVaultFolder(folder))
        .catch((err: unknown) => console.warn("[drive-sync] accès Drive refusé", err));
    };
    window.addEventListener(DRIVE_SYNC_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(DRIVE_SYNC_OPEN_EVENT, onOpen);
  }, [clientId]);

  if (!clientId || vaultFolder === null) return null;
  return (
    <DriveFolderBrowser
      clientId={clientId}
      isOpen
      title={`Synchroniser « ${vaultFolder} » avec…`}
      onClose={() => setVaultFolder(null)}
      onPick={(folder) => {
        const vaultId = getLastVaultReady()?.vaultId;
        if (vaultId) addLink(vaultId, vaultFolder, folder);
        setVaultFolder(null);
      }}
    />
  );
}
