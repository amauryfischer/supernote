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
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
// `drive.file` : accès per-fichier aux fichiers créés/ouverts PAR l'app. Suffit
// pour `files.create` (création d'un Doc/Sheet/Slides vide) sans demander
// l'accès large `drive`. C'est ce scope qui autorise « Nouveau Google Doc ».
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
// On demande les trois scopes en une seule consent : résolution Drive (.gsheet)
// + lecture des valeurs d'une feuille privée (bloc Google Sheet) + création de
// nouveaux fichiers Workspace depuis l'app. Ajouter un scope force un nouveau
// consentement aux comptes déjà connectés (incrémental, géré par GIS).
const OAUTH_SCOPE = `${DRIVE_SCOPE} ${SHEETS_SCOPE} ${DRIVE_FILE_SCOPE}`;
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

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

export interface CachedToken {
  accessToken: string;
  expiresAt: number;
  clientId: string;
  scope: string;
}

// Cache un token PAR (clientId, scope) : Drive et Gmail demandent des scopes
// différents et ne doivent pas s'écraser. Clé = `${clientId} ${scope}`.
const tokenCache = new Map<string, CachedToken>();

const cacheKey = (clientId: string, scope: string) => `${clientId} ${scope}`;

/** Exporté pour les tests — ne pas utiliser ailleurs. */
export function __isTokenFresh(
  token: CachedToken | null,
  clientId: string,
  scope: string,
): boolean {
  if (!token) return false;
  if (token.clientId !== clientId) return false;
  if (token.scope !== scope) return false;
  // 60 s de marge pour ne pas utiliser un token qui expire en plein vol.
  return token.expiresAt > Date.now() + 60_000;
}

/**
 * Récupère un access token pour `scope` (défaut = scopes Drive). Réutilise le
 * token caché s'il est frais ; sinon lance le flux de consentement OAuth.
 *
 * `prompt` : "" (silencieux si déjà accordé), "consent" (force le dialogue),
 * "none" (échoue si pas de grant silencieux).
 */
export async function requestAccessToken(
  clientId: string,
  opts: { prompt?: "" | "consent" | "none"; scope?: string } = {},
): Promise<string> {
  if (!clientId) throw new Error("Google: no clientId configured");
  const scope = opts.scope ?? OAUTH_SCOPE;
  const cached = tokenCache.get(cacheKey(clientId, scope)) ?? null;
  if (__isTokenFresh(cached, clientId, scope)) {
    return cached!.accessToken;
  }
  await loadGis();
  const google = window.google;
  if (!google) throw new Error("GIS not available after load");

  return new Promise<string>((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: (response) => {
        if (response.error) {
          reject(new Error(`OAuth error: ${response.error} ${response.error_description ?? ""}`));
          return;
        }
        if (!response.access_token) {
          reject(new Error("OAuth response missing access_token"));
          return;
        }
        tokenCache.set(cacheKey(clientId, scope), {
          accessToken: response.access_token,
          expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
          clientId,
          scope,
        });
        resolve(response.access_token);
      },
      error_callback: (err) => {
        reject(new Error(`OAuth error: ${err.type} ${err.message ?? ""}`));
      },
    });
    tokenClient.requestAccessToken({ prompt: opts.prompt ?? "" });
  });
}

/**
 * Vide les tokens en cache. `scope` fourni → ne révoque/efface que ce scope
 * (ex. déconnexion Gmail sans casser Drive). Sans scope → tout.
 */
export function clearAccessToken(opts: { clientId?: string; scope?: string } = {}): void {
  for (const [key, token] of [...tokenCache.entries()]) {
    if (opts.clientId && token.clientId !== opts.clientId) continue;
    if (opts.scope && token.scope !== opts.scope) continue;
    tokenCache.delete(key);
    if (window.google?.accounts?.oauth2) {
      try {
        window.google.accounts.oauth2.revoke(token.accessToken);
      } catch {
        /* ignore */
      }
    }
  }
}

/** True si un token frais existe pour ce clientId+scope (défaut Drive). */
export function hasValidToken(clientId: string, scope: string = OAUTH_SCOPE): boolean {
  return __isTokenFresh(tokenCache.get(cacheKey(clientId, scope)) ?? null, clientId, scope);
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

/** Type de fichier Google Workspace créable depuis l'app. */
export type GoogleDocKind = "document" | "spreadsheet" | "presentation";

/**
 * Métadonnées par type : MIME Drive (pour `files.create`), extension du
 * fichier placeholder écrit dans le coffre (que `GDocViewer` sait rendre),
 * libellé UI et nom par défaut proposé dans le prompt de création.
 */
export const GOOGLE_DOC_KINDS: Record<
  GoogleDocKind,
  { mimeType: string; ext: string; label: string; defaultName: string }
> = {
  document: {
    mimeType: "application/vnd.google-apps.document",
    ext: ".gdoc",
    label: "Google Docs",
    defaultName: "Nouveau document",
  },
  spreadsheet: {
    mimeType: "application/vnd.google-apps.spreadsheet",
    ext: ".gsheet",
    label: "Google Sheets",
    defaultName: "Nouvelle feuille",
  },
  presentation: {
    mimeType: "application/vnd.google-apps.presentation",
    ext: ".gslides",
    label: "Google Slides",
    defaultName: "Nouvelle présentation",
  },
};

/**
 * Crée un fichier Google Workspace vide (Doc/Sheet/Slides) dans le Drive du
 * compte connecté via `POST /drive/v3/files` avec un `mimeType` Workspace —
 * Drive matérialise alors le document directement (pas d'upload de contenu).
 *
 * Le fichier atterrit à la racine *My Drive* (aucun `parents` fourni). Comme
 * on stocke l'`id` retourné dans le placeholder `.gdoc`, l'emplacement Drive
 * réel n'a aucune importance pour la résolution côté app — l'utilisateur peut
 * le ranger où il veut dans Drive ensuite.
 *
 * Nécessite le scope `drive.file` (inclus dans `OAUTH_SCOPE`).
 */
export async function createDriveFile(
  clientId: string,
  name: string,
  mimeType: string,
  parentFolderId?: string,
): Promise<DriveFile> {
  const token = await requestAccessToken(clientId, { prompt: "" });
  const body: { name: string; mimeType: string; parents?: string[] } = { name, mimeType };
  // Place the file inside the matching Drive folder so Google Drive Desktop
  // materialises the `.gdoc` shortcut in the right local folder. Omitted →
  // lands at My Drive root.
  if (parentFolderId) body.parents = [parentFolderId];
  const res = await fetch(`${DRIVE_API_BASE}/files?fields=id,name,mimeType,webViewLink`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive create ${res.status}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as DriveFile;
}

/**
 * Resolve a vault sub-path (e.g. ["Antennes","Saint-Malo"]) to its Drive
 * folder ID by walking the folder-name chain DOWN from `rootFolderId`. Each
 * step lists child folders of the current parent matching the segment name.
 *
 * Returns the deepest resolved folder ID. If a segment can't be found (the
 * local folder isn't actually Drive-synced, or a name mismatch), returns the
 * last successfully-resolved ID so the caller can still create the file in the
 * closest existing ancestor rather than failing outright. Empty segments →
 * returns `rootFolderId`.
 */
export async function resolveDriveSubfolder(
  clientId: string,
  rootFolderId: string,
  segments: string[],
): Promise<{ folderId: string; unresolved: string[] }> {
  const token = await requestAccessToken(clientId, { prompt: "" });
  let parentId = rootFolderId;
  const clean = segments.filter((s) => s && s.trim());
  for (let i = 0; i < clean.length; i++) {
    const name = clean[i]!;
    const escaped = name.replace(/'/g, "\\'");
    const q = `name = '${escaped}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const url = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      // Treat an API hiccup as "stop here" — return what we have + the rest.
      return { folderId: parentId, unresolved: clean.slice(i) };
    }
    const json = (await res.json()) as { files?: Array<{ id: string }> };
    const hit = json.files?.[0];
    if (!hit) return { folderId: parentId, unresolved: clean.slice(i) };
    parentId = hit.id;
  }
  return { folderId: parentId, unresolved: [] };
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

// ── Sheets API ────────────────────────────────────────────────────────────────

export interface SheetData {
  /** Titre du classeur. */
  spreadsheetTitle: string;
  /** Titre de l'onglet ciblé par le gid. */
  sheetTitle: string;
  /** Lignes de valeurs (formatées comme dans Google), tableau de tableaux. */
  rows: string[][];
}

interface SheetMeta {
  properties?: { title?: string };
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
    };
  }>;
}

/**
 * Lit les valeurs d'un onglet d'une feuille **privée** via l'API Sheets v4
 * (scope `spreadsheets.readonly`). Le `gid` de l'URL est le `sheetId` de
 * l'onglet ; on résout d'abord gid → titre (metadata), puis on tire les valeurs.
 *
 * CORS : `sheets.googleapis.com` autorise les requêtes navigateur avec le
 * Bearer token — pas de proxy serveur nécessaire.
 *
 * Lève une erreur explicite sur 401/403 (token expiré / scope manquant /
 * feuille non accessible par ce compte).
 */
export async function fetchSheetData(
  clientId: string,
  spreadsheetId: string,
  gid: string,
): Promise<SheetData> {
  const token = await requestAccessToken(clientId, { prompt: "" });
  const authHeaders = { Authorization: `Bearer ${token}` };

  // 1. Metadata : titre du classeur + correspondance gid (sheetId) → titre d'onglet.
  const metaUrl = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(
    "properties.title,sheets.properties(sheetId,title)",
  )}`;
  const metaRes = await fetch(metaUrl, { headers: authHeaders });
  if (!metaRes.ok) {
    const text = await metaRes.text().catch(() => "");
    throw new Error(`Sheets API ${metaRes.status}: ${text.slice(0, 200)}`);
  }
  const meta = (await metaRes.json()) as SheetMeta;
  const wanted = Number(gid);
  const tab =
    meta.sheets?.find((s) => s.properties?.sheetId === wanted) ??
    meta.sheets?.[0];
  const sheetTitle = tab?.properties?.title ?? "Feuille 1";

  // 2. Valeurs de l'onglet (par titre — l'API range utilise le nom d'onglet).
  const valuesUrl = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
    sheetTitle,
  )}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`;
  const valuesRes = await fetch(valuesUrl, { headers: authHeaders });
  if (!valuesRes.ok) {
    const text = await valuesRes.text().catch(() => "");
    throw new Error(`Sheets API ${valuesRes.status}: ${text.slice(0, 200)}`);
  }
  const valuesJson = (await valuesRes.json()) as { values?: unknown[][] };
  const rows = (valuesJson.values ?? []).map((r) =>
    r.map((c) => (c == null ? "" : String(c))),
  );

  return {
    spreadsheetTitle: meta.properties?.title ?? "Google Sheet",
    sheetTitle,
    rows,
  };
}
