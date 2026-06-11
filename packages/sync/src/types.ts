/**
 * @supernote/sync — wire protocol types for the online realtime sync backend.
 *
 * The online sync layer is the third persistence option (after a local folder
 * and Git). It is an OPTIONAL alternative that activates only when the server
 * has a database configured (`DATABASE_URL`). The unit of replication is an
 * **entity operation log**: every local create/update/delete becomes an
 * {@link EntityOp}, the server assigns a monotonic {@link StoredOp.seq}, and
 * peers replay ops since their last seen seq, then stream live ones over SSE.
 *
 * Conflict policy: last-write-wins per entity, keyed on the wall-clock `ts`
 * (with `opId` as a deterministic tiebreaker). This keeps a single user's
 * devices (web + Android PWA) consistent without a CRDT — the realistic
 * concurrency for personal notes is "I edited on my phone, then on my laptop".
 */

/** Kind of mutation an op carries. */
export type SyncOpKind = "upsert" | "delete";

/**
 * Full entity snapshot transported by an `upsert` op. Mirrors the worker's
 * `entities.get` output so applying an op is a faithful materialisation.
 */
export interface EntityOpPayload {
  id: string;
  typeId: string;
  typeName: string;
  /**
   * Column definitions of the entity's type (the `entity_type.fields` blob).
   * Carried alongside `typeName` so a receiver that has never seen this type
   * can recreate it WITH its custom columns instead of an empty `[]` schema —
   * otherwise every base synced to a fresh device loses all its columns.
   * Optional: absent on ops produced by older clients; the receiver then keeps
   * whatever it already has and falls back to `[]` for a brand-new type.
   */
  typeFields?: unknown[];
  filePath: string;
  fields: Record<string, unknown>;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** A single replicated operation, before the server assigns a sequence. */
export interface EntityOp {
  /** Client-generated unique id (idempotency key + LWW tiebreaker). */
  opId: string;
  /** Id of the device that produced the op — lets peers ignore their echoes. */
  clientId: string;
  kind: SyncOpKind;
  entityId: string;
  /** Producer wall-clock in epoch ms — primary last-write-wins key. */
  ts: number;
  /** Present for `upsert`, absent for `delete`. */
  payload?: EntityOpPayload;
}

/** An op after the server has durably stored it and stamped a sequence. */
export interface StoredOp extends EntityOp {
  /** Monotonic, gap-free per-vault sequence number assigned by the server. */
  seq: number;
}

// ── HTTP wire shapes ──────────────────────────────────────────────────────────

/** `GET /api/sync/info` — lets the client detect whether sync is available. */
export interface SyncInfo {
  enabled: boolean;
  /** Whether the server enforces a shared-secret token. */
  requiresToken: boolean;
  /**
   * Random id minted when the server's op-log database was created. A change
   * means the log was wiped (ephemeral-filesystem redeploy, manual reset):
   * clients must drop their seq cursor + seeded flag and re-seed, otherwise
   * they silently desync forever.
   */
  epoch?: string;
}

/** `POST /api/sync/push` body. */
export interface PushRequest {
  vault: string;
  clientId: string;
  ops: EntityOp[];
}

/** `POST /api/sync/push` response. */
export interface PushResponse {
  headSeq: number;
  acks: Array<{ opId: string; seq: number }>;
}

/** `GET /api/sync/pull?vault=&since=` response (polling fallback for SSE). */
export interface PullResponse {
  headSeq: number;
  ops: StoredOp[];
}

// ── SSE stream envelopes ──────────────────────────────────────────────────────

/** Events pushed over `GET /api/sync/stream` (Server-Sent Events). */
export type SyncStreamEvent =
  | { type: "hello"; headSeq: number; epoch?: string }
  | { type: "ops"; headSeq: number; ops: StoredOp[] }
  | { type: "ping" };
