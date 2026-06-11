import { describe, it, expect } from "vitest";
import { resolveMountWrite, crossProvenanceCollision } from "./mount-provenance";

describe("mount-provenance", () => {
  it("applyOps natif (pas de sourceVaultId) : pas de préfixe, provenance null", () => {
    const r = resolveMountWrite("Notes/a.md", undefined);
    expect(r).toEqual({ filePath: "Notes/a.md", sourceVaultId: null });
  });

  it("applyOps monté : préfixe @mounts/<slug>/ + provenance posée", () => {
    const r = resolveMountWrite("Notes/a.md", "cloud:|amaury");
    expect(r.sourceVaultId).toBe("cloud:|amaury");
    expect(r.filePath).toMatch(/^@mounts\/.+\/Notes\/a\.md$/);
  });

  it("collision cross-provenance détectée (id existant d'une autre source)", () => {
    expect(crossProvenanceCollision({ existingSource: null }, "cloud:|amaury")).toBe(true);
    expect(crossProvenanceCollision({ existingSource: "cloud:|b" }, "cloud:|amaury")).toBe(true);
  });

  it("même provenance : pas de collision (mise à jour normale)", () => {
    expect(crossProvenanceCollision({ existingSource: "cloud:|amaury" }, "cloud:|amaury")).toBe(false);
    expect(crossProvenanceCollision({ existingSource: null }, null)).toBe(false);
  });
});
