import { describe, it, expect } from "vitest";
import {
  isOpNewer,
  reduceLatestPerEntity,
  dedupeByOpId,
  rejectOwnOps,
  maxSeq,
  newOpId,
} from "./oplog.js";
import type { EntityOp, StoredOp } from "./types.js";

function op(partial: Partial<EntityOp> & { opId: string; entityId: string }): EntityOp {
  return {
    clientId: "c1",
    kind: "upsert",
    ts: 0,
    ...partial,
  };
}

describe("isOpNewer", () => {
  it("orders by ts first", () => {
    const a = op({ opId: "a", entityId: "e", ts: 200 });
    const b = op({ opId: "z", entityId: "e", ts: 100 });
    expect(isOpNewer(a, b)).toBe(true);
    expect(isOpNewer(b, a)).toBe(false);
  });

  it("breaks ts ties deterministically by opId", () => {
    const a = op({ opId: "b", entityId: "e", ts: 100 });
    const b = op({ opId: "a", entityId: "e", ts: 100 });
    expect(isOpNewer(a, b)).toBe(true);
    expect(isOpNewer(b, a)).toBe(false);
  });

  it("is not newer than itself", () => {
    const a = op({ opId: "a", entityId: "e", ts: 100 });
    expect(isOpNewer(a, a)).toBe(false);
  });
});

describe("reduceLatestPerEntity", () => {
  it("keeps the newest op per entity regardless of input order", () => {
    const ops = [
      op({ opId: "1", entityId: "e1", ts: 10 }),
      op({ opId: "3", entityId: "e2", ts: 50 }),
      op({ opId: "2", entityId: "e1", ts: 30 }),
      op({ opId: "4", entityId: "e1", ts: 20 }),
    ];
    const latest = reduceLatestPerEntity(ops);
    expect(latest.size).toBe(2);
    expect(latest.get("e1")?.opId).toBe("2");
    expect(latest.get("e2")?.opId).toBe("3");
  });

  it("lets a delete win over an older upsert", () => {
    const ops = [
      op({ opId: "1", entityId: "e1", ts: 10, kind: "upsert" }),
      op({ opId: "2", entityId: "e1", ts: 20, kind: "delete" }),
    ];
    expect(reduceLatestPerEntity(ops).get("e1")?.kind).toBe("delete");
  });
});

describe("dedupeByOpId", () => {
  it("removes duplicate opIds, preserving first occurrence order", () => {
    const ops = [
      op({ opId: "1", entityId: "e1" }),
      op({ opId: "2", entityId: "e2" }),
      op({ opId: "1", entityId: "e1" }),
    ];
    const out = dedupeByOpId(ops);
    expect(out.map((o) => o.opId)).toEqual(["1", "2"]);
  });
});

describe("rejectOwnOps", () => {
  it("filters out ops produced by the given client", () => {
    const ops = [
      op({ opId: "1", entityId: "e1", clientId: "me" }),
      op({ opId: "2", entityId: "e2", clientId: "peer" }),
    ];
    const out = rejectOwnOps(ops, "me");
    expect(out.map((o) => o.opId)).toEqual(["2"]);
  });
});

describe("maxSeq", () => {
  it("returns the highest seq", () => {
    const ops: StoredOp[] = [
      { ...op({ opId: "1", entityId: "e1" }), seq: 5 },
      { ...op({ opId: "2", entityId: "e2" }), seq: 9 },
      { ...op({ opId: "3", entityId: "e3" }), seq: 7 },
    ];
    expect(maxSeq(ops)).toBe(9);
  });

  it("returns the fallback for an empty batch", () => {
    expect(maxSeq([], 42)).toBe(42);
  });
});

describe("newOpId", () => {
  it("produces unique-ish, non-empty ids", () => {
    const a = newOpId();
    const b = newOpId();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
