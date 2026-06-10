/**
 * Persist the online-sync configuration in localStorage.
 *
 * Online sync is the third persistence option (after a local folder and Git):
 * a realtime backend that replicates the vault's entity op-log across devices
 * (web + Android PWA) whenever the server has a database configured.
 *
 * Why localStorage and not IndexedDB: the existing `supernote-vault` IndexedDB
 * is pinned at v3 and shared in lockstep by `vault-handle-storage` and the git
 * `config-storage` (see their comments). Adding a store would force a v4 bump
 * across all of them. The online-sync config is tiny (server URL + room key +
 * optional shared-secret token) and per-origin, so localStorage is the
 * lower-risk home — same trust boundary the user already grants the app.
 */

const CONFIG_KEY = "supernote.onlineSync.config";
const CLIENT_ID_KEY = "supernote.onlineSync.clientId";

export interface OnlineSyncConfig {
  /** Whether the user has turned realtime sync on. */
  enabled: boolean;
  /**
   * Base URL of the sync server. Empty string = same-origin (the Supernote
   * server itself, when deployed with a database). e.g. "" or
   * "https://supernote.example.com".
   */
  serverUrl: string;
  /**
   * Logical room key — every device using the SAME key + server shares one
   * vault op-log. Lets a user pair their phone and laptop with a shared word.
   */
  vaultKey: string;
  /** Optional shared secret, required when the server sets `SYNC_TOKEN`. */
  token: string;
  /** Highest server sequence this device has applied. */
  lastSeq: number;
  /** True once this device has pushed its initial full snapshot. */
  seeded: boolean;
  /**
   * Server op-log epoch last seen by this device. When the server reports a
   * different one (its log was wiped — ephemeral FS redeploy), lastSeq and
   * seeded are reset so the device replays + re-seeds. "" = never connected.
   */
  epoch: string;
}

export const DEFAULT_ONLINE_SYNC_CONFIG: OnlineSyncConfig = {
  enabled: false,
  serverUrl: "",
  vaultKey: "",
  token: "",
  lastSeq: 0,
  seeded: false,
  epoch: "",
};

/**
 * Canonicalise a room key. The server partitions the op-log by an exact,
 * case-sensitive string match (`WHERE vault = ?`), so two devices must send
 * byte-identical keys to share a vault. A human typing the same word on a
 * laptop and a phone is the intended pairing flow — but mobile keyboards
 * auto-capitalise the first letter by default, silently turning `amaury` into
 * `Amaury` and splitting the pair into two empty vaults. Folding to lowercase
 * (after trimming) makes the key case-insensitive so the keyboard can't break
 * pairing. Applied on both save and load, so devices that already persisted a
 * mis-cased key heal themselves on the next boot without re-entering it.
 */
export function normalizeVaultKey(key: string): string {
  return key.trim().toLowerCase();
}

export function loadOnlineSyncConfig(): OnlineSyncConfig {
  if (typeof localStorage === "undefined") return { ...DEFAULT_ONLINE_SYNC_CONFIG };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_ONLINE_SYNC_CONFIG };
    const parsed = JSON.parse(raw) as Partial<OnlineSyncConfig>;
    const merged = { ...DEFAULT_ONLINE_SYNC_CONFIG, ...parsed };
    const normKey = normalizeVaultKey(merged.vaultKey);
    if (normKey !== merged.vaultKey) {
      // The stored key wasn't canonical (e.g. a phone keyboard capitalised it),
      // so it was routing to a different server vault. Server `seq` is a single
      // global sequence shared across all vaults, so the persisted cursor/seed
      // belong to the wrong op-log: keeping them would make the corrected device
      // ask for `seq > <stale>` against the right vault and skip its entire
      // backlog. Reset the sync state to force a clean full replay + re-seed.
      merged.vaultKey = normKey;
      merged.lastSeq = 0;
      merged.seeded = false;
      merged.epoch = "";
    }
    return merged;
  } catch {
    return { ...DEFAULT_ONLINE_SYNC_CONFIG };
  }
}

export function saveOnlineSyncConfig(config: OnlineSyncConfig): void {
  if (typeof localStorage === "undefined") return;
  try {
    const normalized = { ...config, vaultKey: normalizeVaultKey(config.vaultKey) };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(normalized));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

export function clearOnlineSyncConfig(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(CONFIG_KEY);
  } catch {
    /* non-fatal */
  }
}

/* ── Cloud vault registry ─────────────────────────────────────────────── */

const VAULTS_KEY = "supernote.onlineSync.vaults";

/**
 * One known cloud vault — a (server, room key) pair the user has opened on this
 * device. The single {@link OnlineSyncConfig} holds only the *active* pair; this
 * registry remembers the others so the sidebar switcher can list and re-activate
 * them, the same way the FSA registry remembers folder vaults.
 */
export interface CloudVaultEntry {
  /** Stable id derived from the (server, key) pair: `cloud:<server>|<key>`. */
  id: string;
  /** Sync server base URL ("" = same origin as the app). */
  serverUrl: string;
  /** Normalized room key — also the human-facing name in the switcher. */
  vaultKey: string;
  /** Optional shared secret, required only when the server sets `SYNC_TOKEN`. */
  token: string;
  /** Epoch ms of the last activation — drives recents sort order. */
  lastOpenedAt: number;
}

/** Canonical server url for id/dedup — trimmed, no trailing slash. */
function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Stable id for a cloud vault. Two forms/devices resolving to the same
 * (server, key) pair collapse to one registry entry. The `cloud:` prefix keeps
 * these ids disjoint from the FSA registry's (random uuid) ids, so a single
 * switcher can list both kinds and dispatch on the prefix without collision.
 */
export function cloudVaultId(serverUrl: string, vaultKey: string): string {
  return `cloud:${normalizeServerUrl(serverUrl)}|${normalizeVaultKey(vaultKey)}`;
}

/** All known cloud vaults, most-recently-opened first. */
export function listCloudVaults(): CloudVaultEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(VAULTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CloudVaultEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e.vaultKey === "string" && typeof e.id === "string")
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
  } catch {
    return [];
  }
}

export function getCloudVault(id: string): CloudVaultEntry | null {
  return listCloudVaults().find((e) => e.id === id) ?? null;
}

/**
 * Insert or refresh the registry entry for a (server, key) pair, stamping
 * `lastOpenedAt`. Returns the canonical entry. No-op safe without localStorage.
 */
export function upsertCloudVault(args: {
  serverUrl: string;
  vaultKey: string;
  token: string;
  lastOpenedAt?: number;
}): CloudVaultEntry {
  const serverUrl = normalizeServerUrl(args.serverUrl);
  const vaultKey = normalizeVaultKey(args.vaultKey);
  const entry: CloudVaultEntry = {
    id: cloudVaultId(serverUrl, vaultKey),
    serverUrl,
    vaultKey,
    token: args.token,
    lastOpenedAt: args.lastOpenedAt ?? Date.now(),
  };
  if (typeof localStorage === "undefined") return entry;
  try {
    const others = listCloudVaults().filter((e) => e.id !== entry.id);
    localStorage.setItem(VAULTS_KEY, JSON.stringify([entry, ...others]));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
  return entry;
}

/** Remove one cloud vault from the registry. The active vault still mounts. */
export function removeCloudVault(id: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    const next = listCloudVaults().filter((e) => e.id !== id);
    localStorage.setItem(VAULTS_KEY, JSON.stringify(next));
  } catch {
    /* non-fatal */
  }
}

/* ── Folder vault sync links (dual mode) ──────────────────────────────── */

const FOLDER_LINKS_KEY = "supernote.onlineSync.folderLinks";

/**
 * A folder (FSA) vault can ALSO replicate through an online-sync room — the
 * "dual" mode (local folder + realtime server). Unlike a pure cloud vault
 * (marked by {@link CLOUD_VAULT_KEY}), the folder stays the *canonical* store
 * and the server is a sync layer on top: the worker still boots from the
 * user's folder, never from the OPFS scratch dir.
 *
 * We remember the (server, key, token) attached to each folder vault id so the
 * link re-arms on every open and survives switching between vaults. The active
 * {@link OnlineSyncConfig} only ever holds the *currently mounted* room; this
 * map remembers the binding per folder, the way the FSA registry remembers
 * folder handles.
 */
export interface FolderSyncLink {
  /** Sync server base URL ("" = same origin as the app). */
  serverUrl: string;
  /** Normalized room key shared by every device replicating this vault. */
  vaultKey: string;
  /** Optional shared secret, required only when the server sets `SYNC_TOKEN`. */
  token: string;
}

function loadFolderLinks(): Record<string, FolderSyncLink> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(FOLDER_LINKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, FolderSyncLink>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveFolderLinks(links: Record<string, FolderSyncLink>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(FOLDER_LINKS_KEY, JSON.stringify(links));
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

/** The sync room attached to a folder vault, or null if it syncs locally only. */
export function getFolderSyncLink(vaultId: string): FolderSyncLink | null {
  const link = loadFolderLinks()[vaultId];
  if (!link || typeof link.vaultKey !== "string" || !link.vaultKey) return null;
  return { ...link, vaultKey: normalizeVaultKey(link.vaultKey) };
}

/** Attach (or update) the sync room a folder vault replicates through. */
export function setFolderSyncLink(vaultId: string, link: FolderSyncLink): void {
  const links = loadFolderLinks();
  links[vaultId] = {
    serverUrl: normalizeServerUrl(link.serverUrl),
    vaultKey: normalizeVaultKey(link.vaultKey),
    token: link.token,
  };
  saveFolderLinks(links);
}

/** Detach a folder vault from its sync room (back to local-only). */
export function removeFolderSyncLink(vaultId: string): void {
  const links = loadFolderLinks();
  if (vaultId in links) {
    delete links[vaultId];
    saveFolderLinks(links);
  }
}

/**
 * Stable per-device id. Generated once and reused so a device can recognise
 * (and ignore) the echoes of its own ops coming back on the stream.
 */
export function getOrCreateClientId(): string {
  if (typeof localStorage === "undefined") {
    return `eph-${Math.random().toString(36).slice(2)}`;
  }
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return `eph-${Math.random().toString(36).slice(2)}`;
  }
}
