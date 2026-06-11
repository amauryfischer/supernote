import { describe, it, expect } from "vitest";
import { resolveMounts, type MountNode } from "./resolve-mounts";

function fetcherFrom(graph: Record<string, MountNode[]>) {
  return async (cloudId: string): Promise<MountNode[]> => graph[cloudId] ?? [];
}

const M = (serverUrl: string, vaultKey: string, label = vaultKey): MountNode => ({
  serverUrl, vaultKey, token: "", label,
});

describe("resolveMounts", () => {
  it("résout un montage direct", async () => {
    const r = await resolveMounts([M("", "b")], { fetch: fetcherFrom({}), selfId: "cloud:|a" });
    expect(r.map((m) => m.cloudId)).toEqual(["cloud:|b"]);
  });

  it("résout récursivement (A→B→C)", async () => {
    const r = await resolveMounts([M("", "b")], {
      fetch: fetcherFrom({ "cloud:|b": [M("", "c")] }), selfId: "cloud:|a",
    });
    expect(r.map((m) => m.cloudId).sort()).toEqual(["cloud:|b", "cloud:|c"]);
  });

  it("coupe les boucles A→B→A", async () => {
    const r = await resolveMounts([M("", "b")], {
      fetch: fetcherFrom({ "cloud:|b": [M("", "a")] }), selfId: "cloud:|a",
    });
    expect(r.map((m) => m.cloudId)).toEqual(["cloud:|b"]);
  });

  it("dédoublonne un diamant A→B→D + A→C→D", async () => {
    const r = await resolveMounts([M("", "b"), M("", "c")], {
      fetch: fetcherFrom({ "cloud:|b": [M("", "d")], "cloud:|c": [M("", "d")] }),
      selfId: "cloud:|a",
    });
    expect(r.map((m) => m.cloudId).sort()).toEqual(["cloud:|b", "cloud:|c", "cloud:|d"]);
  });

  it("skip le salon du père lui-même", async () => {
    const r = await resolveMounts([M("", "a")], { fetch: fetcherFrom({}), selfId: "cloud:|a" });
    expect(r).toEqual([]);
  });

  it("borne la profondeur à 4", async () => {
    const chain: Record<string, MountNode[]> = {
      "cloud:|1": [M("", "2")], "cloud:|2": [M("", "3")],
      "cloud:|3": [M("", "4")], "cloud:|4": [M("", "5")],
      "cloud:|5": [M("", "6")],
    };
    const r = await resolveMounts([M("", "1")], { fetch: fetcherFrom(chain), selfId: "cloud:|a" });
    expect(r.map((m) => m.cloudId)).not.toContain("cloud:|6");
  });

  it("borne le nombre de montages à 16", async () => {
    const many = Array.from({ length: 20 }, (_, i) => M("", `m${i}`));
    const r = await resolveMounts(many, { fetch: fetcherFrom({}), selfId: "cloud:|a" });
    expect(r.length).toBeLessThanOrEqual(16);
  });
});
