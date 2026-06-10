// @vitest-environment jsdom
// Dual folder+server mode hinges on ORDERING: external `.md` edits must be
// reconciled into the local vault BEFORE the server stream replays, otherwise a
// stale server op could clobber a newer external edit (LWW would compare against
// un-reconciled local state). These tests lock that invariant on the client.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { OnlineSyncClient, type OnlineSyncClientOptions } from "./client";
import type { EntityOp } from "@supernote/sync";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close(): void {}
}

function makeOp(id: string): EntityOp {
  return { opId: `op-${id}`, clientId: "", kind: "upsert", entityId: id, ts: 1 };
}

function baseOpts(over: Partial<OnlineSyncClientOptions>): OnlineSyncClientOptions {
  return {
    serverUrl: "",
    vaultKey: "k",
    token: "",
    clientId: "dev1",
    initialSeq: 0,
    seeded: true, // skip the full-snapshot seed so we isolate the reconcile push
    epoch: "e1",
    applyOps: async () => {},
    getSnapshot: async () => [],
    collectLocalChanges: async () => [],
    onSeq: () => {},
    onSeeded: () => {},
    onEpochChange: () => {},
    onStatus: () => {},
    pending: { load: () => [], save: () => "ok" },
    ...over,
  };
}

describe("OnlineSyncClient — reconcile before stream", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/api/sync/info")) {
        return { ok: true, status: 200, json: async () => ({ enabled: true, epoch: "e1" }) };
      }
      // /api/sync/push and anything else
      return { ok: true, status: 200, json: async () => ({ ok: true, headSeq: 0 }) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("runs collectLocalChanges once, BEFORE the stream opens", async () => {
    const collectLocalChanges = vi.fn(async () => {
      // The stream must not have been opened yet at reconcile time.
      expect(FakeEventSource.instances).toHaveLength(0);
      return [];
    });
    const client = new OnlineSyncClient(baseOpts({ collectLocalChanges }));

    await client.start();

    expect(collectLocalChanges).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("pushes reconciled external edits to the server on connect", async () => {
    const client = new OnlineSyncClient(
      baseOpts({ collectLocalChanges: async () => [makeOp("a")] }),
    );

    await client.start();
    // Simulate the SSE connection opening — this flushes the queued op.
    FakeEventSource.instances[0]!.onopen?.();

    await vi.waitFor(() => {
      const pushed = fetchMock.mock.calls.some((c) =>
        String(c[0]).includes("/api/sync/push"),
      );
      expect(pushed).toBe(true);
    });

    const pushCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/sync/push"),
    )!;
    const body = JSON.parse((pushCall[1] as RequestInit).body as string);
    expect(body.ops.map((o: EntityOp) => o.entityId)).toEqual(["a"]);
    // The device stamps its clientId so its own echo is filtered on replay.
    expect(body.ops[0].clientId).toBe("dev1");
  });

  it("does not re-run collectLocalChanges on reconnect", async () => {
    const collectLocalChanges = vi.fn(async () => []);
    const client = new OnlineSyncClient(baseOpts({ collectLocalChanges }));

    await client.start();
    // A second start() models a reconnect after a transient drop.
    await client.start();

    expect(collectLocalChanges).toHaveBeenCalledTimes(1);
  });
});
