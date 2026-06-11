import { describe, it, expect } from "vitest";
import { resolveMountWrite, crossProvenanceCollision, isMountedPath } from "./mount-provenance";
import { prefixMountPath } from "../online-sync/room-id";

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

  describe("isMountedPath (garde C1/C2)", () => {
    it("chemin natif : pas monté", () => {
      expect(isMountedPath("Notes/a.md")).toBe(false);
      expect(isMountedPath("Inbox/note.md")).toBe(false);
      expect(isMountedPath("")).toBe(false);
    });

    it("chemin préfixé @mounts/<slug>/ : monté", () => {
      const mounted = prefixMountPath("cloud:|amaury", "Notes/a.md");
      expect(isMountedPath(mounted)).toBe(true);
      expect(mounted.startsWith("@mounts/")).toBe(true);
    });

    it("ne matche que le préfixe exact `@mounts/` (pas une sous-chaîne)", () => {
      // Un dossier nommé "mes-@mounts" ne doit pas être confondu avec un montage.
      expect(isMountedPath("Notes/mes-@mounts/a.md")).toBe(false);
      // `@mounts` sans slash final n'est pas un sous-arbre monté.
      expect(isMountedPath("@mountsfoo/a.md")).toBe(false);
    });
  });
});
