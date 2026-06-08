// @vitest-environment jsdom
// Journal durable des ops non-ackées — la garantie « fermer l'onglet ne perd
// pas la dernière édition » repose dessus.
import { describe, it, expect, beforeEach } from "vitest";
import type { EntityOp } from "@supernote/sync";
import { loadPendingOps, savePendingOps, clearPendingOps } from "./pendingStore";

function op(n: number, payloadSize = 0): EntityOp {
  return {
    opId: `op-${n}`,
    clientId: "dev-1",
    kind: "upsert",
    entityId: `ent-${n}`,
    ts: 1700000000000 + n,
    payload: {
      id: `ent-${n}`,
      typeId: "note",
      typeName: "note",
      filePath: `notes/${n}.md`,
      fields: { title: `Note ${n}` },
      body: "x".repeat(payloadSize),
      tags: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  };
}

describe("pendingStore", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips ops per vault", () => {
    expect(savePendingOps("v1", [op(1), op(2)])).toBe("ok");
    expect(loadPendingOps("v1").map((o) => o.opId)).toEqual(["op-1", "op-2"]);
    // Autre vault → journal indépendant.
    expect(loadPendingOps("v2")).toEqual([]);
  });

  it("an empty save clears the journal", () => {
    savePendingOps("v1", [op(1)]);
    savePendingOps("v1", []);
    expect(loadPendingOps("v1")).toEqual([]);
    expect(localStorage.getItem("supernote.onlineSync.pending.v1")).toBeNull();
  });

  it("returns 'overflow' and drops the journal past the op-count budget", () => {
    const many = Array.from({ length: 501 }, (_, i) => op(i));
    expect(savePendingOps("v1", many)).toBe("overflow");
    expect(loadPendingOps("v1")).toEqual([]);
  });

  it("returns 'overflow' past the byte budget", () => {
    // 3 ops × ~1 Mo de body > 2 Mo.
    const fat = [op(1, 1_000_000), op(2, 1_000_000), op(3, 1_000_000)];
    expect(savePendingOps("v1", fat)).toBe("overflow");
    expect(loadPendingOps("v1")).toEqual([]);
  });

  it("tolerates corrupt storage", () => {
    localStorage.setItem("supernote.onlineSync.pending.v1", "{not json");
    expect(loadPendingOps("v1")).toEqual([]);
    localStorage.setItem("supernote.onlineSync.pending.v1", JSON.stringify({ nope: 1 }));
    expect(loadPendingOps("v1")).toEqual([]);
    // Items invalides filtrés, valides conservés.
    localStorage.setItem(
      "supernote.onlineSync.pending.v1",
      JSON.stringify([op(1), { broken: true }, null]),
    );
    expect(loadPendingOps("v1").map((o) => o.opId)).toEqual(["op-1"]);
  });

  it("clearPendingOps removes the journal", () => {
    savePendingOps("v1", [op(1)]);
    clearPendingOps("v1");
    expect(loadPendingOps("v1")).toEqual([]);
  });
});
