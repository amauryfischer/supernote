import type { EmailSnapshot, ShareKind, ShareMode } from "@/lib/share/types";

export interface LinkMeta {
  kind: ShareKind;
  mode: ShareMode;
  title: string;
  needsPassword: boolean;
}
export type Closed = "expired" | "revoked" | "missing";
export interface Access {
  accessToken: string;
  resourceId: string;
  kind: ShareKind;
  mode: ShareMode;
}

const base = (slug: string) => `/api/share/links/${encodeURIComponent(slug)}`;
const tokenKey = (slug: string) => `supernote.share.token.${slug}`;

// Seuls 404/410 ferment le lien ; réseau/5xx lève, pour rester distinguable d'un lien retiré.
export async function fetchMeta(slug: string): Promise<LinkMeta | Closed> {
  const res = await fetch(`${base(slug)}/meta`);
  if (res.ok) return res.json() as Promise<LinkMeta>;
  if (res.status !== 404 && res.status !== 410) throw new Error(`meta ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as { reason?: Closed };
  return body.reason ?? "missing";
}

export async function unlock(slug: string, password?: string): Promise<Access | "wrong" | "locked" | Closed> {
  const res = await fetch(`${base(slug)}/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(password ? { password } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as Access & { reason?: "wrong" | "locked" | Closed };
  if (!res.ok) return body.reason ?? "missing";
  try {
    sessionStorage.setItem(tokenKey(slug), JSON.stringify(body));
  } catch {
    /* session privée : on redemandera le mot de passe */
  }
  return body;
}

export function cachedAccess(slug: string): Access | null {
  try {
    const raw = sessionStorage.getItem(tokenKey(slug));
    return raw ? (JSON.parse(raw) as Access) : null;
  } catch {
    return null;
  }
}

export function forgetAccess(slug: string): void {
  try {
    sessionStorage.removeItem(tokenKey(slug));
  } catch {
    /* rien à oublier */
  }
}

export async function fetchEmail(slug: string, token: string): Promise<EmailSnapshot | null> {
  const res = await fetch(`${base(slug)}/content`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return ((await res.json()) as { snapshot: EmailSnapshot }).snapshot;
}

export async function fetchBlobUrl(slug: string, token: string, path: string): Promise<string> {
  const res = await fetch(`${base(slug)}/blob?path=${encodeURIComponent(path)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`image ${res.status}`);
  return URL.createObjectURL(await res.blob());
}
