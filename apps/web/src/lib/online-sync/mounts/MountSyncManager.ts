import type { EntityOp } from "@supernote/sync";
import { resolveMounts, type MountNode } from "./resolve-mounts";
import { stripMountPath } from "../room-id";

/** Sous-ensemble du contrat OnlineSyncClient utilisé par un montage. */
export interface MountClient {
  start: () => Promise<void>;
  stop: () => void;
  enqueue: (ops: EntityOp[]) => void;
}

export interface MountSyncDeps {
  parentVaultId: string;
  selfId: string | null;
  getDirectMounts: () => Promise<MountNode[]>;
  getMountsIn: (cloudId: string) => Promise<MountNode[]>;
  applyOps: (ops: EntityOp[], sourceVaultId: string) => Promise<void>;
  purgeMounted: (sourceVaultId: string) => Promise<void>;
  makeClient: (cloudId: string, node: MountNode) => MountClient;
}

export class MountSyncManager {
  private readonly deps: MountSyncDeps;
  private clients = new Map<string, MountClient>();

  constructor(deps: MountSyncDeps) {
    this.deps = deps;
  }

  async start(): Promise<void> {
    await this.refresh();
  }

  /** Re-résout les montages et réconcilie les clients (ajout/retrait). */
  async refresh(): Promise<void> {
    const direct = await this.deps.getDirectMounts();
    const resolved = await resolveMounts(direct, {
      fetch: this.deps.getMountsIn,
      selfId: this.deps.selfId,
    });
    const wanted = new Set(resolved.map((m) => m.cloudId));

    for (const [cloudId, client] of this.clients) {
      if (!wanted.has(cloudId)) {
        client.stop();
        this.clients.delete(cloudId);
        await this.deps.purgeMounted(cloudId);
      }
    }
    for (const m of resolved) {
      if (this.clients.has(m.cloudId)) continue;
      const client = this.deps.makeClient(m.cloudId, m);
      this.clients.set(m.cloudId, client);
      await client.start();
    }
  }

  /** Route une mutation locale vers le client de sa provenance. */
  onEntityChange(msg: { sourceVaultId: string | null; op: EntityOp }): void {
    const src = msg.sourceVaultId;
    if (!src) return;
    const client = this.clients.get(src);
    if (!client) return;
    const op = msg.op;
    if (op.payload) {
      const bare = stripMountPath(src, op.payload.filePath);
      if (bare === null) {
        // Un op monté dont le chemin a perdu son préfixe @mounts/<slug>/ ne doit
        // PAS être poussé tel quel dans le salon source (il y écrirait un chemin
        // natif erroné). On le laisse tomber — le routeur rejette déjà ces moves.
        console.warn(`[mounts] op ignorée : chemin sans préfixe attendu pour ${src}`, op.payload.filePath);
        return;
      }
      client.enqueue([{ ...op, payload: { ...op.payload, filePath: bare } }]);
      return;
    }
    // delete ops (no payload) route by entityId as before
    client.enqueue([op]);
  }

  stop(): void {
    for (const client of this.clients.values()) client.stop();
    this.clients.clear();
  }
}
