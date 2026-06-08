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
