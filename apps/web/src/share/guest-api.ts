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

// Statuts serveur : 200 ok, 400 mot de passe trop long, 401 faux, 404/410 lien fermé, 429 verrouillé ; tout le reste lève.
export async function unlock(slug: string, password?: string): Promise<Access | "wrong" | "locked" | Closed> {
  const res = await fetch(`${base(slug)}/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(password ? { password } : {}),
  });
  if (res.ok) {
    const body = (await res.json()) as Access;
    try {
      sessionStorage.setItem(tokenKey(slug), JSON.stringify(body));
    } catch {
      /* session privée : on redemandera le mot de passe */
    }
    return body;
  }
  if (res.status === 400 || res.status === 401) return "wrong";
  if (res.status === 429) return "locked";
  if (res.status === 404 || res.status === 410) {
    const body = (await res.json().catch(() => ({}))) as { reason?: Closed };
    return body.reason ?? "missing";
  }
  throw new Error(`unlock ${res.status}`);
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
  if (res.ok) return ((await res.json()) as { snapshot: EmailSnapshot }).snapshot;
  if (res.status === 401 || res.status === 404) return null;
  throw new Error(`content ${res.status}`);
}

export async function fetchBlobUrl(slug: string, token: string, path: string): Promise<string> {
  const res = await fetch(`${base(slug)}/blob?path=${encodeURIComponent(path)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`image ${res.status}`);
  return URL.createObjectURL(await res.blob());
}
