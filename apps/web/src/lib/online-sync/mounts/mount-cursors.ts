export interface MountCursor {
  lastSeq: number;
  epoch: string;
}

const DEFAULT: MountCursor = { lastSeq: 0, epoch: "" };

function key(parentVaultId: string, mountId: string): string {
  return `supernote.onlineSync.mountCursors.${parentVaultId}.${mountId}`;
}

export function loadMountCursor(parentVaultId: string, mountId: string): MountCursor {
  if (typeof localStorage === "undefined") return { ...DEFAULT };
  try {
    const raw = localStorage.getItem(key(parentVaultId, mountId));
    if (!raw) return { ...DEFAULT };
    const p = JSON.parse(raw) as Partial<MountCursor>;
    return {
      lastSeq: typeof p.lastSeq === "number" ? p.lastSeq : 0,
      epoch: typeof p.epoch === "string" ? p.epoch : "",
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveMountCursor(parentVaultId: string, mountId: string, cursor: MountCursor): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key(parentVaultId, mountId), JSON.stringify(cursor));
  } catch {
    /* quota — non fatal */
  }
}

export function clearMountCursor(parentVaultId: string, mountId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key(parentVaultId, mountId));
  } catch {
    /* non fatal */
  }
}
