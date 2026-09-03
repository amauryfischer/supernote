/**
 * Client for `/api/share/*` (see `share-backend.mjs`). Same-origin only —
 * public sharing lives on whichever server this app was served from, unlike
 * online sync which can point at a different `serverUrl`.
 *
 * Auth reuses the online-sync shared secret (`loadOnlineSyncConfig().token`):
 * one token to configure server-side (`SYNC_TOKEN`), not two.
 */

import { loadOnlineSyncConfig } from "@/lib/online-sync/config-storage";

export interface ShareStatus {
  published: boolean;
  slug?: string;
  updatedAt?: number;
}

function authHeaders(): Record<string, string> {
  const token = loadOnlineSyncConfig().token;
  return token ? { "x-sync-token": token } : {};
}

let infoPromise: Promise<{ enabled: boolean; requiresToken: boolean }> | null = null;

/** Whether this deployment has DATABASE_URL configured (share backend mounted). Cached for the session. */
export function shareBackendInfo(): Promise<{ enabled: boolean; requiresToken: boolean }> {
  infoPromise ??= fetch("/api/share/_info")
    .then((r) => (r.ok ? r.json() : { enabled: false, requiresToken: false }))
    .catch(() => ({ enabled: false, requiresToken: false }));
  return infoPromise;
}

export async function getShareStatus(entityId: string): Promise<ShareStatus> {
  const res = await fetch(`/api/share/${encodeURIComponent(entityId)}`, {
    headers: authHeaders(),
  });
  if (!res.ok) return { published: false };
  return res.json();
}

export async function publishShare(
  entityId: string,
  title: string,
  html: string,
): Promise<{ slug: string; updatedAt: number }> {
  const res = await fetch(`/api/share/${encodeURIComponent(entityId)}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ title, html }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `share publish failed: ${res.status}`);
  }
  return res.json();
}

export async function unpublishShare(entityId: string): Promise<void> {
  const res = await fetch(`/api/share/${encodeURIComponent(entityId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`share unpublish failed: ${res.status}`);
}

export function shareUrl(slug: string): string {
  return `${window.location.origin}/s/${slug}`;
}
