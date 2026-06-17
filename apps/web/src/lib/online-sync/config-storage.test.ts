// @vitest-environment jsdom
// La clé de salon route le coffre côté serveur (match exact, sensible à la
// casse). Une casse non canonique (auto-majuscule clavier mobile) scinde une
// paire en deux coffres vides — ces tests verrouillent la normalisation et la
// guérison du curseur.
import { describe, it, expect, beforeEach } from "vitest";
import {
  normalizeVaultKey,
  loadOnlineSyncConfig,
  saveOnlineSyncConfig,
  DEFAULT_ONLINE_SYNC_CONFIG,
  cloudVaultId,
  listCloudVaults,
  getCloudVault,
  upsertCloudVault,
  removeCloudVault,
  archiveActiveSyncConfig,
  getVaultSyncBinding,
  restoreFolderSyncConfig,
  removeVaultSyncBinding,
} from "./config-storage";

const CONFIG_KEY = "supernote.onlineSync.config";

describe("normalizeVaultKey", () => {
  it("trims and lowercases so case can't fork a vault", () => {
    expect(normalizeVaultKey("Amaury")).toBe("amaury");
    expect(normalizeVaultKey("  AMAURY  ")).toBe("amaury");
    expect(normalizeVaultKey("amaury")).toBe("amaury");
  });
});

describe("saveOnlineSyncConfig", () => {
  beforeEach(() => localStorage.clear());

  it("persists the canonical key regardless of input case", () => {
    saveOnlineSyncConfig({ ...DEFAULT_ONLINE_SYNC_CONFIG, vaultKey: "Amaury" });
    const raw = JSON.parse(localStorage.getItem(CONFIG_KEY)!);
    expect(raw.vaultKey).toBe("amaury");
  });
});

describe("loadOnlineSyncConfig", () => {
  beforeEach(() => localStorage.clear());

  it("heals a mis-cased stored key and resets the sync cursor", () => {
    // Simulate a device already paired under the wrong (capitalised) vault,
    // with a non-zero global-seq cursor from that orphan op-log.
    localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({
        ...DEFAULT_ONLINE_SYNC_CONFIG,
        enabled: true,
        vaultKey: "Amaury",
        lastSeq: 28,
        seeded: true,
        epoch: "old-epoch",
      }),
    );
    const cfg = loadOnlineSyncConfig();
    expect(cfg.vaultKey).toBe("amaury");
    // Cursor/seed/epoch reset → clean full replay against the correct vault.
    expect(cfg.lastSeq).toBe(0);
    expect(cfg.seeded).toBe(false);
    expect(cfg.epoch).toBe("");
    // Unrelated config preserved.
    expect(cfg.enabled).toBe(true);
  });

  it("leaves an already-canonical key and its cursor untouched", () => {
    localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({
        ...DEFAULT_ONLINE_SYNC_CONFIG,
        enabled: true,
        vaultKey: "amaury",
        lastSeq: 27,
        seeded: true,
        epoch: "live-epoch",
      }),
    );
    const cfg = loadOnlineSyncConfig();
    expect(cfg.vaultKey).toBe("amaury");
    expect(cfg.lastSeq).toBe(27);
    expect(cfg.seeded).toBe(true);
    expect(cfg.epoch).toBe("live-epoch");
  });
});

describe("cloud vault registry", () => {
  beforeEach(() => localStorage.clear());

  it("derives a stable id from the normalized (server, key) pair", () => {
    // Trailing slash + key case must not fork the id — same pair → same id.
    expect(cloudVaultId("https://s.example.com/", "Amaury")).toBe(
      cloudVaultId("https://s.example.com", "amaury"),
    );
    // Different server → different id, even with the same key.
    expect(cloudVaultId("", "amaury")).not.toBe(
      cloudVaultId("https://s.example.com", "amaury"),
    );
  });

  it("upserts, dedupes on the (server, key) pair, and refreshes recency", () => {
    const a = upsertCloudVault({ serverUrl: "", vaultKey: "perso", token: "" });
    upsertCloudVault({ serverUrl: "https://s.example.com", vaultKey: "boulot", token: "x" });
    expect(listCloudVaults()).toHaveLength(2);

    // Re-adding the same pair (case/slash variant) updates, not duplicates.
    const again = upsertCloudVault({ serverUrl: "", vaultKey: "PERSO", token: "tok" });
    expect(again.id).toBe(a.id);
    const all = listCloudVaults();
    expect(all).toHaveLength(2);
    expect(getCloudVault(a.id)?.token).toBe("tok");
  });

  it("sorts most-recently-opened first", () => {
    const old = upsertCloudVault({
      serverUrl: "",
      vaultKey: "old",
      token: "",
      lastOpenedAt: 1000,
    });
    const fresh = upsertCloudVault({
      serverUrl: "",
      vaultKey: "fresh",
      token: "",
      lastOpenedAt: 2000,
    });
    expect(listCloudVaults().map((e) => e.id)).toEqual([fresh.id, old.id]);
  });

  it("removes one entry, leaving the rest", () => {
    const a = upsertCloudVault({ serverUrl: "", vaultKey: "a", token: "" });
    const b = upsertCloudVault({ serverUrl: "", vaultKey: "b", token: "" });
    removeCloudVault(a.id);
    expect(listCloudVaults().map((e) => e.id)).toEqual([b.id]);
    expect(getCloudVault(a.id)).toBeNull();
  });
});

describe("per-vault sync bindings", () => {
  beforeEach(() => localStorage.clear());

  it("archives the active config's connection params under a vault id", () => {
    saveOnlineSyncConfig({
      ...DEFAULT_ONLINE_SYNC_CONFIG,
      enabled: true,
      serverUrl: "https://s.example.com",
      vaultKey: "strategie",
      token: "tok",
      lastSeq: 42,
      seeded: true,
      epoch: "e",
    });
    archiveActiveSyncConfig("vault-A");
    const binding = getVaultSyncBinding("vault-A");
    expect(binding).toEqual({
      enabled: true,
      serverUrl: "https://s.example.com",
      vaultKey: "strategie",
      token: "tok",
    });
    // Cursor fields are intentionally NOT archived — the local DB is re-indexed
    // on every switch, so the cursor always resets on restore.
    expect(binding).not.toHaveProperty("lastSeq");
  });

  it("is a no-op for a null vault id (no active vault)", () => {
    saveOnlineSyncConfig({ ...DEFAULT_ONLINE_SYNC_CONFIG, enabled: true, vaultKey: "x" });
    archiveActiveSyncConfig(null);
    expect(getVaultSyncBinding("x")).toBeNull();
  });

  it("restores a folder vault's binding as the active config with a reset cursor", () => {
    // Vault A had sync on; archive it, then simulate a switch away that left a
    // different (or default) active config in place.
    saveOnlineSyncConfig({
      ...DEFAULT_ONLINE_SYNC_CONFIG,
      enabled: true,
      serverUrl: "https://s.example.com",
      vaultKey: "strategie",
      token: "tok",
      lastSeq: 42,
      seeded: true,
      epoch: "e",
    });
    archiveActiveSyncConfig("vault-A");
    saveOnlineSyncConfig({ ...DEFAULT_ONLINE_SYNC_CONFIG }); // switched to a sync-off vault

    restoreFolderSyncConfig("vault-A");
    const cfg = loadOnlineSyncConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.serverUrl).toBe("https://s.example.com");
    expect(cfg.vaultKey).toBe("strategie");
    expect(cfg.token).toBe("tok");
    // Re-indexed DB → clean replay + re-seed.
    expect(cfg.lastSeq).toBe(0);
    expect(cfg.seeded).toBe(false);
    expect(cfg.epoch).toBe("");
  });

  it("restores a clean, unconfigured state for a vault that never had sync", () => {
    saveOnlineSyncConfig({ ...DEFAULT_ONLINE_SYNC_CONFIG, enabled: true, vaultKey: "leftover" });
    restoreFolderSyncConfig("never-synced");
    const cfg = loadOnlineSyncConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.vaultKey).toBe("");
  });

  it("survives the report's switch-away-and-back round trip", () => {
    // 1. Folder vault A turns sync on.
    saveOnlineSyncConfig({
      ...DEFAULT_ONLINE_SYNC_CONFIG,
      enabled: true,
      vaultKey: "strategie",
    });
    // 2. Switch to folder vault B: archive A, restore B (never synced → off).
    archiveActiveSyncConfig("vault-A");
    restoreFolderSyncConfig("vault-B");
    expect(loadOnlineSyncConfig().enabled).toBe(false); // B not contaminated
    // 3. Switch back to A: archive B, restore A.
    archiveActiveSyncConfig("vault-B");
    restoreFolderSyncConfig("vault-A");
    const cfg = loadOnlineSyncConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.vaultKey).toBe("strategie"); // still connected
  });

  it("forgets a vault's binding", () => {
    saveOnlineSyncConfig({ ...DEFAULT_ONLINE_SYNC_CONFIG, enabled: true, vaultKey: "k" });
    archiveActiveSyncConfig("vault-A");
    expect(getVaultSyncBinding("vault-A")).not.toBeNull();
    removeVaultSyncBinding("vault-A");
    expect(getVaultSyncBinding("vault-A")).toBeNull();
  });
});
