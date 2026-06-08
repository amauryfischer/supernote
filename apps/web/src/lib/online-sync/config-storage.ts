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

export function loadOnlineSyncConfig(): OnlineSyncConfig {
  if (typeof localStorage === "undefined") return { ...DEFAULT_ONLINE_SYNC_CONFIG };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_ONLINE_SYNC_CONFIG };
    const parsed = JSON.parse(raw) as Partial<OnlineSyncConfig>;
    return { ...DEFAULT_ONLINE_SYNC_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_ONLINE_SYNC_CONFIG };
  }
}

export function saveOnlineSyncConfig(config: OnlineSyncConfig): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
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
