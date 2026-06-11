// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MountSyncManager } from "./MountSyncManager";
import type { MountNode } from "./resolve-mounts";

beforeEach(() => localStorage.clear());

const M = (vaultKey: string): MountNode => ({ serverUrl: "", vaultKey, token: "", label: vaultKey });

function makeDeps(direct: MountNode[]) {
  const started: string[] = [];
  const stopped: string[] = [];
  const pushed: Array<{ mountId: string; filePath: string }> = [];
  const purged: string[] = [];
  return {
    started, stopped, pushed, purged,
    deps: {
      parentVaultId: "parent1",
      selfId: null as string | null,
      getDirectMounts: async () => direct,
      getMountsIn: async () => [] as MountNode[],
      applyOps: vi.fn(async () => {}),
      purgeMounted: async (sourceVaultId: string) => { purged.push(sourceVaultId); },
      makeClient: (cloudId: string) => ({
        start: async () => { started.push(cloudId); },
        stop: () => { stopped.push(cloudId); },
        enqueue: (ops: Array<{ payload?: { filePath: string } }>) =>
          ops.forEach((o) => { if (o.payload) pushed.push({ mountId: cloudId, filePath: o.payload.filePath }); }),
      }),
    },
  };
}

describe("MountSyncManager", () => {
  it("démarre un client par montage résolu", async () => {
    const { started, deps } = makeDeps([M("b"), M("c")]);
    const mgr = new MountSyncManager(deps);
    await mgr.start();
    expect(started.sort()).toEqual(["cloud:|b", "cloud:|c"]);
  });

  it("route un ENTITY_CHANGE vers le client de sa provenance, dé-préfixé", async () => {
    const { pushed, deps } = makeDeps([M("b")]);
    const mgr = new MountSyncManager(deps);
    await mgr.start();
    const { prefixMountPath } = await import("../room-id");
    mgr.onEntityChange({
      sourceVaultId: "cloud:|b",
      op: { opId: "1", clientId: "", kind: "upsert", entityId: "x", ts: 1,
            payload: { id: "x", typeId: "note", typeName: "note",
              filePath: prefixMountPath("cloud:|b", "Notes/a.md"),
              fields: {}, body: "", tags: [], createdAt: "", updatedAt: "" } },
    });
    expect(pushed).toEqual([{ mountId: "cloud:|b", filePath: "Notes/a.md" }]);
  });

  it("ignore un ENTITY_CHANGE natif (sourceVaultId null)", async () => {
    const { pushed, deps } = makeDeps([M("b")]);
    const mgr = new MountSyncManager(deps);
    await mgr.start();
    mgr.onEntityChange({
      sourceVaultId: null,
      op: { opId: "1", clientId: "", kind: "upsert", entityId: "x", ts: 1,
            payload: { id: "x", typeId: "note", typeName: "note", filePath: "Notes/a.md",
              fields: {}, body: "", tags: [], createdAt: "", updatedAt: "" } },
    });
    expect(pushed).toEqual([]);
  });

  it("démontage : stop le client retiré + purge sa provenance", async () => {
    const deps0 = makeDeps([M("b"), M("c")]);
    const mgr = new MountSyncManager(deps0.deps);
    await mgr.start();
    deps0.deps.getDirectMounts = async () => [M("c")];
    await mgr.refresh();
    expect(deps0.stopped).toContain("cloud:|b");
    expect(deps0.purged).toContain("cloud:|b");
  });
});
