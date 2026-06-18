import { describe, it, expect } from "vitest";
import { cloudVaultId, cloudRoomSlug, MOUNT_PATH_PREFIX, prefixMountPath, stripMountPath } from "./room-id";

describe("room-id", () => {
  it("cloudVaultId normalise serveur + clé (casse, trailing slash)", () => {
    expect(cloudVaultId("https://x.com/", "Amaury")).toBe("cloud:https://x.com|amaury");
    expect(cloudVaultId("", "  Salon B ")).toBe("cloud:|salon b");
  });

  it("cloudVaultId replie les accents (clavier FR vs desktop → même salon)", () => {
    // « stratégie » (clavier mobile FR) et « strategie » (desktop) doivent viser
    // le MÊME coffre serveur, sinon le téléphone ne voit jamais les notes du PC.
    expect(cloudVaultId("", "Stratégie")).toBe("cloud:|strategie");
    expect(cloudVaultId("", "stratégie")).toBe(cloudVaultId("", "strategie"));
  });

  it("cloudRoomSlug est déterministe et sans caractères de chemin interdits", () => {
    const a = cloudRoomSlug("cloud:|amaury");
    expect(a).toBe(cloudRoomSlug("cloud:|amaury"));
    expect(a).not.toMatch(/[^a-zA-Z0-9._-]/);
  });

  it("cloudRoomSlug évite les collisions après sanitation", () => {
    expect(cloudRoomSlug("cloud:|a/b")).not.toBe(cloudRoomSlug("cloud:|a-b"));
  });

  it("prefixMountPath/stripMountPath font un aller-retour", () => {
    const p = prefixMountPath("cloud:|amaury", "Notes/contact.md");
    expect(p.startsWith(`${MOUNT_PATH_PREFIX}/`)).toBe(true);
    expect(stripMountPath("cloud:|amaury", p)).toBe("Notes/contact.md");
    // Mauvais salon → pas de match.
    expect(stripMountPath("cloud:|autre", p)).toBeNull();
  });
});
