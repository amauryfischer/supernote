/**
 * OnlineSyncClient — drives the realtime online-sync transport on the main
 * thread.
 *
 * Transport: Server-Sent Events downstream (`GET /api/sync/stream`) + plain
 * `POST /api/sync/push` upstream. This pair needs zero extra dependencies,
 * traverses the same proxies the static server already sits behind, and works
 * identically in a desktop browser and an Android-installed PWA.
 *
 * Responsibilities:
 *  - detect whether the server has sync enabled (a database is configured),
 *  - replay the op-log since the last applied seq, then stream live ops,
 *  - apply peers' ops to the local vault (own echoes are filtered out),
 *  - batch + push local ops produced by the worker,
 *  - seed the server with a one-time full snapshot of this device's vault.
 *
 * The class is transport-only: applying ops and producing a snapshot are
 * injected by {@link OnlineSyncClientOptions} so this file never imports the
 * tRPC client or React.
 */

import type { EntityOp, StoredOp, SyncInfo, PushResponse, SyncStreamEvent } from "@supernote/sync";
import { dedupeByOpId, rejectOwnOps, maxSeq } from "@supernote/sync";

export type OnlineSyncStatus =
  | "disabled" // not configured / turned off
  | "connecting" // opening the stream
  | "connected" // live
  | "offline" // network down / server unreachable
  | "error"; // server reachable but sync unavailable (no DB, bad token)

export interface OnlineSyncClientOptions {
  serverUrl: string;
  vaultKey: string;
  token: string;
  clientId: string;
  initialSeq: number;
  seeded: boolean;
  applyOps: (ops: EntityOp[]) => Promise<void>;
  getSnapshot: () => Promise<EntityOp[]>;
  onSeq: (seq: number) => void;
  onSeeded: () => void;
  onStatus: (status: OnlineSyncStatus, detail?: { error?: string }) => void;
}

const PUSH_DEBOUNCE_MS = 800;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

export class OnlineSyncClient {
  private readonly opts: OnlineSyncClientOptions;
  private es: EventSource | null = null;
  private seq: number;
  private seeded: boolean;
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pushBuffer: EntityOp[] = [];
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pushing: Promise<void> = Promise.resolve();

  constructor(opts: OnlineSyncClientOptions) {
    this.opts = opts;
    this.seq = opts.initialSeq;
    this.seeded = opts.seeded;
  }

  private base(): string {
    return this.opts.serverUrl.replace(/\/+$/, "");
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.opts.token) h["x-sync-token"] = this.opts.token;
    return h;
  }

  /** Probe the server, then open the stream. Resolves once the probe is done. */
  async start(): Promise<void> {
    this.stopped = false;
    this.opts.onStatus("connecting");
    let info: SyncInfo;
    try {
      const res = await fetch(`${this.base()}/api/sync/info`, { headers: this.headers() });
      if (!res.ok) throw new Error(`info ${res.status}`);
      info = (await res.json()) as SyncInfo;
    } catch (err) {
      this.opts.onStatus("offline", { error: (err as Error).message });
      this.scheduleReconnect();
      return;
    }
    if (!info.enabled) {
      this.opts.onStatus("error", {
        error:
          "Le serveur n'a pas de base de données configurée — la synchronisation en ligne est indisponible.",
      });
      return;
    }
    this.openStream();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.reconnectTimer = null;
    this.pushTimer = null;
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.opts.onStatus("disabled");
  }

  /** Queue local ops for the next push batch. Stamps the device clientId. */
  enqueue(ops: EntityOp[]): void {
    if (this.stopped || ops.length === 0) return;
    for (const op of ops) this.pushBuffer.push({ ...op, clientId: this.opts.clientId });
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.flush(), PUSH_DEBOUNCE_MS);
  }

  /** Force any buffered ops out immediately. */
  async flush(): Promise<void> {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    const batch = this.pushBuffer;
    if (batch.length === 0) return;
    this.pushBuffer = [];
    this.pushing = this.pushing.then(() => this.postOps(batch)).catch((err) => {
      // Re-buffer on failure so a transient outage doesn't drop writes.
      this.pushBuffer.unshift(...batch);
      console.warn("[online-sync] push failed, will retry", err);
    });
    return this.pushing;
  }

  private async postOps(ops: EntityOp[]): Promise<void> {
    const res = await fetch(`${this.base()}/api/sync/push`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ vault: this.opts.vaultKey, clientId: this.opts.clientId, ops }),
    });
    if (!res.ok) throw new Error(`push ${res.status}`);
    (await res.json()) as PushResponse;
  }

  private openStream(): void {
    if (this.stopped) return;
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    const params = new URLSearchParams({
      vault: this.opts.vaultKey,
      since: String(this.seq),
      clientId: this.opts.clientId,
    });
    if (this.opts.token) params.set("token", this.opts.token);
    const url = `${this.base()}/api/sync/stream?${params.toString()}`;
    const es = new EventSource(url);
    this.es = es;

    es.onopen = () => {
      this.reconnectAttempt = 0;
      this.opts.onStatus("connected");
      // One-time seed: push our whole vault so the server (and peers) get this
      // device's existing notes. Runs after connect so any server-side ops
      // have already begun streaming in.
      if (!this.seeded) void this.seed();
    };

    es.onmessage = (ev) => {
      void this.onStreamData(ev.data);
    };

    es.onerror = () => {
      // EventSource auto-retries, but we manage reconnection ourselves so the
      // `since` cursor advances. Close and back off.
      if (this.stopped) return;
      es.close();
      this.es = null;
      this.opts.onStatus("offline");
      this.scheduleReconnect();
    };
  }

  private async onStreamData(raw: string): Promise<void> {
    let evt: SyncStreamEvent;
    try {
      evt = JSON.parse(raw) as SyncStreamEvent;
    } catch {
      return;
    }
    if (evt.type === "ping" || evt.type === "hello") return;
    if (evt.type === "ops") {
      const incoming = evt.ops as StoredOp[];
      if (incoming.length === 0) return;
      // Advance the cursor past EVERYTHING (incl. our own echoes) so we never
      // re-pull, but only apply peers' ops.
      const highest = maxSeq(incoming, this.seq);
      const toApply = dedupeByOpId(rejectOwnOps(incoming, this.opts.clientId));
      if (toApply.length > 0) {
        try {
          await this.opts.applyOps(toApply);
        } catch (err) {
          console.warn("[online-sync] applyOps failed", err);
        }
      }
      if (highest > this.seq) {
        this.seq = highest;
        this.opts.onSeq(this.seq);
      }
    }
  }

  private async seed(): Promise<void> {
    try {
      const ops = await this.opts.getSnapshot();
      if (ops.length > 0) {
        await this.postOps(ops.map((op) => ({ ...op, clientId: this.opts.clientId })));
      }
      this.seeded = true;
      this.opts.onSeeded();
      console.info(`[online-sync] seeded ${ops.length} entit(y/ies) to the server`);
    } catch (err) {
      console.warn("[online-sync] seed failed (will retry on next connect)", err);
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.start();
    }, delay);
  }
}
