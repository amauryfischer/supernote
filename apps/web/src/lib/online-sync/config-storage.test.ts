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
