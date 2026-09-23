/**
 * Appels REST Google authentifiés, partagés par Gmail et l'agenda : jeton GIS
 * par scope, rejeu unique sur 401, puis état « reconnexion requise » par famille
 * de scopes. Sans geste de l'utilisateur, GIS ne peut qu'ouvrir une popup
 * bloquée : après un échec, on attend le clic plutôt que de retenter.
 */

import { requestAccessToken, hasValidToken, forgetAccessToken } from "./google-drive";

/** Réponse HTTP non-2xx d'une API Google. */
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

/** Aucun token utilisable sans geste de l'utilisateur. */
export class GoogleAuthError extends Error {
  constructor(detail = "") {
    super(`Reconnexion Google requise${detail ? ` (${detail})` : ""}`);
    this.name = "GoogleAuthError";
  }
}

/** Échec qui ne dit rien de l'opération elle-même : réseau, jeton, quota, serveur. */
export function isTransientGoogleError(err: unknown): boolean {
  if (err instanceof GoogleAuthError || err instanceof TypeError) return true;
  if (err instanceof GoogleApiError) {
    // Google signale aussi ses quotas en 403 (`rateLimitExceeded`, `userRateLimitExceeded`).
    return err.status === 429 || err.status >= 500 || (err.status === 403 && /rateLimit|quota/i.test(err.message));
  }
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// Valeur historique conservée : les écouteurs Gmail existants s'y abonnent déjà.
export const GOOGLE_AUTH_EVENT = "supernote:gmail-auth";

export type GoogleScopeFamily = "gmail" | "calendar";

export function scopeFamily(scope: string): GoogleScopeFamily {
  return scope.includes("/auth/calendar") ? "calendar" : "gmail";
}

const failedScopes = new Set<string>();

function setScopeFailed(scope: string, failed: boolean): void {
  if (failedScopes.has(scope) === failed) return;
  if (failed) failedScopes.add(scope);
  else failedScopes.delete(scope);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(GOOGLE_AUTH_EVENT));
}

export function failedScopesOf(family: GoogleScopeFamily): string[] {
  return [...failedScopes].filter((s) => scopeFamily(s) === family);
}

export function googleReconnectRequired(family: GoogleScopeFamily): boolean {
  return failedScopesOf(family).length > 0;
}

export function markScopeRecovered(scope: string): void {
  setScopeFailed(scope, false);
}

const pendingTokens = new Map<string, Promise<string>>();

function acquireToken(clientId: string, scope: string): Promise<string> {
  if (hasValidToken(clientId, scope)) return requestAccessToken(clientId, { scope, prompt: "" });
  if (googleReconnectRequired(scopeFamily(scope))) {
    setScopeFailed(scope, true);
    return Promise.reject(new GoogleAuthError());
  }
  const key = `${clientId} ${scope}`;
  const pending = pendingTokens.get(key);
  if (pending) return pending;
  const p = requestAccessToken(clientId, { scope, prompt: "" })
    .catch((err: unknown) => {
      setScopeFailed(scope, true);
      throw new GoogleAuthError(err instanceof Error ? err.message : String(err));
    })
    .finally(() => pendingTokens.delete(key));
  pendingTokens.set(key, p);
  return p;
}

// Le quota Gmail se compte par minute et par utilisateur, tous appareils confondus :
// insister pendant la minute le maintient dépassé, et un pool de lectures en vol
// continuerait de tirer après le premier refus.
const QUOTA_COOLDOWN_MS = 60_000;
const quotaBlockedUntil = new Map<GoogleScopeFamily, { until: number; error: GoogleApiError }>();

/** Sur 401, le token est oublié et l'appel rejoué une fois ; un second refus lève la reconnexion. */
export async function googleRequest(
  clientId: string,
  scope: string,
  url: string,
  init: { method?: string; body?: string; json?: boolean; headers?: Record<string, string> } = {},
  label = "Google API",
): Promise<Response> {
  const family = scopeFamily(scope);
  const blocked = quotaBlockedUntil.get(family);
  if (blocked && blocked.until > Date.now()) throw blocked.error;
  for (let attempt = 0; ; attempt++) {
    const token = await acquireToken(clientId, scope);
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.json ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    if (res.status === 401) {
      forgetAccessToken(token);
      if (attempt === 0) continue;
      setScopeFailed(scope, true);
      throw new GoogleAuthError("401");
    }
    setScopeFailed(scope, false);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const error = new GoogleApiError(res.status, `${label} ${res.status}: ${text.slice(0, 300)}`);
      if ((res.status === 403 || res.status === 429) && /quota/i.test(text)) {
        quotaBlockedUntil.set(family, { until: Date.now() + QUOTA_COOLDOWN_MS, error });
      }
      throw error;
    }
    return res;
  }
}
