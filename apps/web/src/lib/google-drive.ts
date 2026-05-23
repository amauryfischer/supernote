/**
 * Google Drive auto-resolution layer for `.gdoc`/`.gsheet`/`.gslides`
 * placeholder files that FSA can't read (Google Drive desktop streams
 * them on demand — the local file is a 0-byte placeholder until the user
 * marks the file "Available offline" or the desktop client decides to
 * cache it).
 *
 * Flow:
 *   1. User sets up an OAuth 2.0 client ID in Google Cloud Console and
 *      pastes it into Settings → Google Drive.
 *   2. First time we need to resolve a .gdoc, we lazy-load Google's
 *      Identity Services script (`https://accounts.google.com/gsi/client`).
 *   3. `requestAccessToken()` runs the OAuth grant flow — pops up a
 *      Google login if needed, returns an access token with the
 *      `drive.readonly` scope.
 *   4. `searchFiles(name, mimeType)` calls `GET /drive/v3/files?q=...`
 *      with that token. Returns matches — the caller picks (usually the
 *      only one matching the basename, since folder context isn't
 *      available client-side).
 *
 * Tokens last ~1h. We keep them in memory only — refresh by re-running
 * `requestAccessToken()` (silent if the user is still in the same Google
 * session, prompted otherwise). Persistence is intentional: we don't
 * want long-lived Google credentials living in localStorage.
 */

const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
}

interface TokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
  callback: (response: TokenResponse) => void;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleNamespace {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (err: { type: string; message?: string }) => void;
      }) => TokenClient;
      revoke: (token: string, done?: () => void) => void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleNamespace;
  }
}

// ── Script loading ───────────────────────────────────────────────────────────

let gisLoadPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("loadGis: SSR not supported"));
      return;
    }
    // Already loaded by a previous call (or another tab).
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.oauth2) resolve();
      else reject(new Error("GIS script loaded but `google.accounts.oauth2` is missing"));
    };
    script.onerror = () => reject(new Error("Failed to load Google Identity Services script"));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

// ── Token management ────────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string;
  expiresAt: number;
  clientId: string;
}

let cachedToken: CachedToken | null = null;

function isTokenFresh(token: CachedToken | null, clientId: string): boolean {
  if (!token) return false;
  if (token.clientId !== clientId) return false;
  // 60 s safety margin so we don't try to use a token that expires
  // mid-request.
  return token.expiresAt > Date.now() + 60_000;
}

/**
 * Get an access token for the configured Drive scope. Reuses the cached
 * token if still fresh; otherwise pops the OAuth grant flow.
 *
 * `prompt`:
 *   - `""` (default): silent grant if the user has already approved the
 *     scope in this Google session — otherwise pops the consent dialog.
 *   - `"consent"`: always shows the consent dialog (use for "Connect"
 *     button to make the act of authorising explicit).
 *   - `"none"`: never prompts — fails if no silent grant available.
 */
export async function requestAccessToken(
  clientId: string,
  opts: { prompt?: "" | "consent" | "none" } = {},
): Promise<string> {
  if (!clientId) throw new Error("Google Drive: no clientId configured");
  if (isTokenFresh(cachedToken, clientId)) {
    return cachedToken!.accessToken;
  }
  await loadGis();
  const google = window.google;
  if (!google) throw new Error("GIS not available after load");

  return new Promise<string>((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(`OAuth error: ${response.error} ${response.error_description ?? ""}`));
          return;
        }
        if (!response.access_token) {
          reject(new Error("OAuth response missing access_token"));
          return;
        }
        cachedToken = {
          accessToken: response.access_token,
          expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
          clientId,
        };
        resolve(response.access_token);
      },
      error_callback: (err) => {
        reject(new Error(`OAuth error: ${err.type} ${err.message ?? ""}`));
      },
    });
    tokenClient.requestAccessToken({ prompt: opts.prompt ?? "" });
  });
}

/** Clear the in-memory token (e.g. on "Disconnect" from settings). */
export function clearAccessToken(): void {
  if (cachedToken) {
    const token = cachedToken.accessToken;
    cachedToken = null;
    // Best-effort: revoke the grant so the next request shows the consent
    // dialog. Fire-and-forget — the user disconnected, we don't care if
    // the revoke fails.
    if (window.google?.accounts?.oauth2) {
      try {
        window.google.accounts.oauth2.revoke(token);
      } catch {
        /* ignore */
      }
    }
  }
}

/** True if we have a non-expired cached token for this clientId. */
export function hasValidToken(clientId: string): boolean {
  return isTokenFresh(cachedToken, clientId);
}

// ── Drive API ────────────────────────────────────────────────────────────────

/**
 * Map an attachment extension to the corresponding Google MIME type for
 * `drive.files.list?q=mimeType=...` queries. Returns `null` for non-Google
 * extensions (the caller shouldn't be searching for those anyway).
 */
export function gdocMimeType(ext: string): string | null {
  switch (ext.toLowerCase()) {
    case ".gdoc":
      return "application/vnd.google-apps.document";
    case ".gsheet":
      return "application/vnd.google-apps.spreadsheet";
    case ".gslides":
      return "application/vnd.google-apps.presentation";
    default:
      return null;
  }
}

/**
 * Search Drive for files matching `name` exactly (case-insensitive) and
 * a Google Workspace mimeType. Returns up to 10 matches ordered by most
 * recent first. The caller should pick the right one (usually unique).
 *
 * The `name` in Drive's metadata is the FULL doc title — which is also
 * what local Drive sync clients use as the .gdoc basename (without ext).
 * E.g. local file "Notes Q4 2025.gdoc" ↔ Drive doc name "Notes Q4 2025".
 */
export async function searchFiles(
  clientId: string,
  name: string,
  mimeType: string,
): Promise<DriveFile[]> {
  const token = await requestAccessToken(clientId, { prompt: "" });
  // Escape single quotes inside the name (Drive query syntax).
  const escaped = name.replace(/'/g, "\\'");
  const q = `name = '${escaped}' and mimeType = '${mimeType}' and trashed = false`;
  const url = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,webViewLink)&pageSize=10&orderBy=modifiedTime desc`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { files?: DriveFile[] };
  return json.files ?? [];
}

/**
 * Fetch the connected user's email — handy for the settings UI to show
 * which account is wired up.
 */
export async function getUserEmail(clientId: string): Promise<string> {
  const token = await requestAccessToken(clientId, { prompt: "" });
  const res = await fetch(`${DRIVE_API_BASE}/about?fields=user(emailAddress)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive about ${res.status}`);
  const json = (await res.json()) as { user?: { emailAddress?: string } };
  return json.user?.emailAddress ?? "";
}
