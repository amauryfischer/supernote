"use client";

import { useEffect } from "react";
import type { EntityOp } from "@supernote/sync";
import { useSettings } from "@/components/settings/SettingsContext";
import { DRIVE_FULL_SCOPE, GOOGLE_TOKEN_EVENT, hasValidToken } from "@/lib/google-drive";
import { hasWorkerBackend } from "@/lib/trpc/client";
import { getLastVaultReady, isWorkerReady, onWorkerMessage } from "@/lib/trpc/browser-link";
import { DRIVE_SYNC_REQUEST_EVENT, patchLink, readLinks } from "./links";
import { syncLink } from "./engine";

const TICK_MS = 5 * 60_000;
const CHANGE_DEBOUNCE_MS = 10_000;

/**
 * Passes de synchro des dossiers liés à Drive. Seulement avec un jeton Drive en
 * cache : une acquisition ouvrirait la popup Google hors geste, la liaison passe
 * alors « en pause » jusqu'au clic « Reprendre ».
 */
export function DriveSyncRunner() {
  const { settings } = useSettings();
  const clientId = settings.googleDrive.clientId.trim();

  useEffect(() => {
    if (!clientId || !hasWorkerBackend()) return undefined;
    let running = false;
    let again = false;
    let debounce: number | undefined;

    const run = async (onlyLinkId?: string): Promise<void> => {
      const vaultId = getLastVaultReady()?.vaultId;
      if (!vaultId || !isWorkerReady()) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        for (const link of readLinks(vaultId)) {
          if (!link.enabled || (onlyLinkId && link.id !== onlyLinkId)) continue;
          if (!hasValidToken(clientId, DRIVE_FULL_SCOPE)) {
            patchLink(vaultId, link.id, { lastError: "pause" });
            continue;
          }
          try {
            const report = await syncLink(clientId, link);
            patchLink(vaultId, link.id, {
              lastSyncAt: Date.now(),
              lastError: report.errors ? `${report.errors} fichier(s) en erreur` : undefined,
            });
          } catch (err) {
            console.warn("[drive-sync]", link.vaultFolder, err);
            patchLink(vaultId, link.id, { lastError: err instanceof Error ? err.message : String(err) });
          }
        }
      } finally {
        running = false;
        if (again) {
          again = false;
          void run();
        }
      }
    };

    const soon = (delay = 1_000) => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void run(), delay);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") soon();
    };
    const onRequest = (e: Event) => void run((e as CustomEvent<{ linkId?: string }>).detail?.linkId);
    const onToken = () => soon();
    const stopWorker = onWorkerMessage((msg) => {
      const m = msg as { type?: string; op?: EntityOp };
      if (m.type === "VAULT_READY") return soon();
      if (m.type !== "ENTITY_CHANGE" || !m.op) return;
      const vaultId = getLastVaultReady()?.vaultId;
      const path = m.op.payload?.filePath;
      const linked = vaultId ? readLinks(vaultId).filter((l) => l.enabled) : [];
      if (m.op.kind === "delete" ? linked.length : linked.some((l) => path?.startsWith(`${l.vaultFolder}/`))) {
        soon(CHANGE_DEBOUNCE_MS);
      }
    });

    soon();
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, TICK_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(DRIVE_SYNC_REQUEST_EVENT, onRequest);
    window.addEventListener(GOOGLE_TOKEN_EVENT, onToken);
    return () => {
      stopWorker();
      window.clearTimeout(debounce);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(DRIVE_SYNC_REQUEST_EVENT, onRequest);
      window.removeEventListener(GOOGLE_TOKEN_EVENT, onToken);
    };
  }, [clientId]);

  return null;
}
