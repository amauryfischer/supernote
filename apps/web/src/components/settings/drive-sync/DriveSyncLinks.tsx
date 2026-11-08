"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowsClockwise, CloudArrowUp, Trash } from "@phosphor-icons/react";
import { Button, Select, Switch, Tooltip } from "@supernote/ui";
import { FeedbackIcon, useActionFeedback } from "@/lib/action-feedback";
import { DRIVE_FULL_SCOPE, requestAccessToken } from "@/lib/google-drive";
import { getLastVaultReady } from "@/lib/trpc/browser-link";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { useFolderPaths } from "@/components/notes/hooks";
import {
  addLink,
  DRIVE_SYNC_LINKS_EVENT,
  patchLink,
  readLinks,
  requestDriveSync,
  writeLinks,
  type DriveSyncLink,
} from "@/lib/drive-sync/links";
import { DriveFolderBrowser } from "./DriveFolderBrowser";

const subscribe = (cb: () => void) => {
  window.addEventListener(DRIVE_SYNC_LINKS_EVENT, cb);
  return () => window.removeEventListener(DRIVE_SYNC_LINKS_EVENT, cb);
};

const formatWhen = (ts?: number) =>
  ts ? new Date(ts).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "jamais";

export const DRIVE_SYNC_FOLDER_PARAM = "driveSync";

function LinkRow({ vaultId, clientId, link }: { vaultId: string; clientId: string; link: DriveSyncLink }) {
  const sync = useActionFeedback();
  const paused = link.lastError === "pause";
  // Le clic est le geste qui autorise la popup Google si le jeton a expiré.
  const syncNow = () =>
    sync.run(async () => {
      await requestAccessToken(clientId, { scope: DRIVE_FULL_SCOPE });
      patchLink(vaultId, link.id, { lastError: undefined });
      requestDriveSync(link.id);
    });
  const remove = async () => {
    writeLinks(vaultId, readLinks(vaultId).filter((l) => l.id !== link.id));
    await trpcVanillaClient.driveSync.stateClearLink.mutate({ linkId: link.id });
  };

  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center" style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm" style={{ color: "var(--text-primary)" }}>
          {link.vaultFolder} → {link.driveFolderPath}
        </p>
        <p className="text-xs" style={{ color: paused || link.lastError ? "var(--color-danger)" : "var(--text-muted)" }}>
          {paused ? "Synchro en pause, accès Drive à renouveler" : link.lastError ?? `Dernière synchro : ${formatWhen(link.lastSyncAt)}`}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Switch
          isSelected={link.enabled}
          onChange={(enabled: boolean) => patchLink(vaultId, link.id, { enabled })}
          aria-label="Synchro active"
        />
        <Tooltip content={paused ? "Reprendre" : "Synchroniser maintenant"}>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={paused ? "Reprendre" : "Synchroniser maintenant"} onPress={() => void syncNow()}>
            <FeedbackIcon state={sync.state} error={sync.error} idle={<ArrowsClockwise size={16} />} />
          </Button>
        </Tooltip>
        <Tooltip content="Retirer la liaison (rien n'est supprimé)">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Retirer la liaison" onPress={() => void remove()}>
            <Trash size={16} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

/** Liaisons « dossier du coffre ↔ dossier Drive » de cet appareil. */
export function DriveSyncLinks({ clientId }: { clientId: string }) {
  const vaultId = getLastVaultReady()?.vaultId ?? "";
  const links = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(readLinks(vaultId)),
    () => "[]",
  );
  const parsed = JSON.parse(links) as DriveSyncLink[];
  const folderPaths = useFolderPaths();
  const [params] = useSearchParams();
  const [vaultFolder, setVaultFolder] = useState(params.get(DRIVE_SYNC_FOLDER_PARAM) ?? "");
  const [browsing, setBrowsing] = useState(false);
  const add = useActionFeedback();

  useEffect(() => {
    const preset = params.get(DRIVE_SYNC_FOLDER_PARAM);
    if (preset) setVaultFolder(preset);
  }, [params]);

  if (!vaultId) return null;

  const startAdd = () =>
    add.run(async () => {
      await requestAccessToken(clientId, { scope: DRIVE_FULL_SCOPE });
      setBrowsing(true);
    });

  const pick = (folder: { id: string; path: string }) => {
    setBrowsing(false);
    addLink(vaultId, vaultFolder, folder);
    setVaultFolder("");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl" style={{ backgroundColor: "var(--surface-2)" }}>
        {parsed.length ? (
          parsed.map((l) => <LinkRow key={l.id} vaultId={vaultId} clientId={clientId} link={l} />)
        ) : (
          <p className="px-3 py-2.5 text-sm" style={{ color: "var(--text-muted)" }}>Aucun dossier synchronisé.</p>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          aria-label="Dossier du coffre à synchroniser"
          placeholder="Dossier du coffre…"
          options={folderPaths.map((p) => ({ key: p, label: p }))}
          selectedKey={vaultFolder || undefined}
          onSelectionChange={setVaultFolder}
          className="sm:w-72"
        />
        <Button size="sm" className="flex h-9 items-center gap-1.5" isDisabled={!vaultFolder} onPress={() => void startAdd()}>
          <FeedbackIcon state={add.state} error={add.error} idle={<CloudArrowUp size={14} />} />
          Choisir le dossier Drive…
        </Button>
      </div>
      {add.error && <p className="text-xs" style={{ color: "var(--color-danger)" }}>{add.error}</p>}
      <DriveFolderBrowser clientId={clientId} isOpen={browsing} onClose={() => setBrowsing(false)} onPick={pick} />
    </div>
  );
}
