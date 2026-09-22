import { useEffect, useState } from "react";
import type { EmailSnapshot, ShareKind, ShareMode } from "./types";

export interface OwnedShare {
  resourceId: string;
  ownerKey: string;
}

export interface ShareLink {
  slug: string;
  mode: ShareMode;
  hasPassword: boolean;
  expiresAt: number | null;
  label: string | null;
  createdAt: number;
  revokedAt: number | null;
}

export class ShareGoneError extends Error {}

async function call<T>(path: string, init: RequestInit, share?: OwnedShare): Promise<T> {
  const headers = new Headers(init.headers);
  if (share) headers.set("x-share-owner", share.ownerKey);
  if (typeof init.body === "string") headers.set("content-type", "application/json");
  const res = await fetch(`/api/share${path}`, { ...init, headers });
  if (res.status === 403 || res.status === 404) throw new ShareGoneError("Ce partage n'existe plus.");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Partage : erreur ${res.status}`);
  }
  return res.json() as Promise<T>;
}

let enabled: Promise<boolean> | null = null;
export function shareBackendEnabled(): Promise<boolean> {
  // Sans DATABASE_URL le serveur sert le shell SPA (200 html) sur cette route : seul un JSON `{enabled:true}` fait foi.
  enabled ??= fetch("/api/share/_info")
    .then((r) => r.json())
    .then((body: { enabled?: boolean }) => body.enabled === true)
    .catch(() => false);
  return enabled;
}

export function useShareEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    void shareBackendEnabled().then(setOn);
  }, []);
  return on;
}

export async function createShareResource(kind: ShareKind, title: string, snapshot?: EmailSnapshot): Promise<OwnedShare> {
  const r = await call<{ id: string; ownerKey: string }>("/resources", {
    method: "POST",
    body: JSON.stringify({ kind, title, snapshot }),
  });
  return { resourceId: r.id, ownerKey: r.ownerKey };
}

export async function seedShareDoc(share: OwnedShare, update: Uint8Array): Promise<void> {
  // `Uint8Array<ArrayBufferLike>` (Yjs) vs `BodyInit` qui veut un ArrayBuffer concret — cast sans risque runtime.
  await call(`/resources/${share.resourceId}/doc`, { method: "PUT", body: update as BodyInit }, share).catch((err: unknown) => {
    // 409 : un autre appareil a déjà amorcé ce document, on le rejoint tel quel.
    if (!(err instanceof Error && err.message.includes("already seeded"))) throw err;
  });
}

export async function deleteShareResource(share: OwnedShare): Promise<void> {
  await call(`/resources/${share.resourceId}`, { method: "DELETE" }, share).catch((err: unknown) => {
    if (!(err instanceof ShareGoneError)) throw err;
  });
}

export async function renameShareResource(share: OwnedShare, title: string): Promise<void> {
  await call(`/resources/${share.resourceId}`, { method: "PATCH", body: JSON.stringify({ title }) }, share);
}

export async function listShareLinks(share: OwnedShare): Promise<ShareLink[]> {
  return (await call<{ links: ShareLink[] }>(`/resources/${share.resourceId}/links`, { method: "GET" }, share)).links;
}

export async function createShareLink(
  share: OwnedShare,
  opts: { mode: ShareMode; password?: string; expiresAt: number | null; label?: string },
): Promise<ShareLink> {
  return (await call<{ link: ShareLink }>(`/resources/${share.resourceId}/links`, { method: "POST", body: JSON.stringify(opts) }, share)).link;
}

export async function updateShareLink(
  share: OwnedShare,
  slug: string,
  patch: { password?: string | null; expiresAt?: number | null; label?: string | null },
): Promise<ShareLink> {
  return (await call<{ link: ShareLink }>(`/links/${slug}`, { method: "PATCH", body: JSON.stringify(patch) }, share)).link;
}

export async function revokeShareLink(share: OwnedShare, slug: string): Promise<void> {
  await call(`/links/${slug}`, { method: "DELETE" }, share);
}

export async function publishShareBlob(share: OwnedShare, path: string, blob: Blob): Promise<void> {
  await call(`/resources/${share.resourceId}/blob?path=${encodeURIComponent(path)}`, { method: "PUT", body: blob }, share);
}

export function shareUrl(slug: string): string {
  return `${window.location.origin}/s/${slug}`;
}
