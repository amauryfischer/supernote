import { useSyncExternalStore } from "react";
import { getLastVaultReady } from "@/lib/trpc/browser-link";

/** Liaisons « dossier du coffre ↔ dossier Drive », propres à l'appareil, rangées par coffre. */

export interface DriveSyncLink {
  id: string;
  vaultFolder: string;
  driveFolderId: string;
  driveFolderPath: string;
  enabled: boolean;
  lastSyncAt?: number;
  /** "pause" = pas de jeton Drive en cache, attend un clic pour la popup Google. */
  lastError?: string;
}

const KEY = "supernote.driveSync.links";
export const DRIVE_SYNC_LINKS_EVENT = "supernote:drive-sync-links";
export const DRIVE_SYNC_REQUEST_EVENT = "supernote:drive-sync-request";
export const DRIVE_SYNC_OPEN_EVENT = "supernote:drive-sync-open";

function readAll(): Record<string, DriveSyncLink[]> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, DriveSyncLink[]>) : {};
  } catch {
    return {};
  }
}

export function readLinks(vaultId: string): DriveSyncLink[] {
  const links = readAll()[vaultId];
  return Array.isArray(links) ? links : [];
}

export function writeLinks(vaultId: string, links: DriveSyncLink[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [vaultId]: links }));
  } catch {
    /* stockage indisponible : la liaison ne survivra pas au rechargement */
  }
  window.dispatchEvent(new CustomEvent(DRIVE_SYNC_LINKS_EVENT));
}

export function patchLink(vaultId: string, id: string, patch: Partial<DriveSyncLink>): void {
  writeLinks(vaultId, readLinks(vaultId).map((l) => (l.id === id ? { ...l, ...patch } : l)));
}

export function requestDriveSync(linkId?: string): void {
  window.dispatchEvent(new CustomEvent(DRIVE_SYNC_REQUEST_EVENT, { detail: { linkId } }));
}

export function addLink(vaultId: string, vaultFolder: string, folder: { id: string; path: string }): void {
  const link: DriveSyncLink = { id: crypto.randomUUID(), vaultFolder, driveFolderId: folder.id, driveFolderPath: folder.path, enabled: true };
  writeLinks(vaultId, [...readLinks(vaultId), link]);
  requestDriveSync(link.id);
}

/** Ouvre le choix du dossier Drive pour `vaultFolder` ; à appeler depuis un geste (la popup Google en dépend). */
export function openDriveSyncFor(vaultFolder: string): void {
  window.dispatchEvent(new CustomEvent(DRIVE_SYNC_OPEN_EVENT, { detail: { vaultFolder } }));
}

const subscribeLinks = (cb: () => void) => {
  window.addEventListener(DRIVE_SYNC_LINKS_EVENT, cb);
  window.addEventListener("supernote:vault-ready", cb);
  return () => {
    window.removeEventListener(DRIVE_SYNC_LINKS_EVENT, cb);
    window.removeEventListener("supernote:vault-ready", cb);
  };
};

/** Liaison active du dossier `path` (lui-même, pas un parent), pour le repère de l'arbre. */
export function useDriveLink(path: string): DriveSyncLink | null {
  const json = useSyncExternalStore(
    subscribeLinks,
    () => {
      const vaultId = getLastVaultReady()?.vaultId;
      const link = vaultId ? readLinks(vaultId).find((l) => l.vaultFolder === path) : undefined;
      return link ? JSON.stringify(link) : "";
    },
    () => "",
  );
  return json ? (JSON.parse(json) as DriveSyncLink) : null;
}
