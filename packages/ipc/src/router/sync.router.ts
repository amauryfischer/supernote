import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  ApplyOpsInput,
  ApplyOpsOutput,
  SnapshotOutput,
  SyncHeadOutput,
  CollectLocalChangesOutput,
} from "../schemas/sync.js";

/**
 * Online realtime sync — worker-side procedures.
 *
 * The browser vault worker implements these (see
 * `apps/web/src/lib/vault-worker/worker-router.ts`). They are the bridge
 * between the remote op-log (server) and the local SQLite vault:
 *
 *  - `applyOps`  — materialise remote ops into the local vault (no echo).
 *  - `snapshot`  — export every entity as an `upsert` op to seed the server.
 *  - `head`      — lightweight local state summary (entity count).
 *  - `collectLocalChanges` — reconcile external `.md` edits + return push ops.
 */
export const syncRouter = router({
  /** Apply a batch of remote ops to the local vault. Idempotent, LWW. */
  applyOps: publicProcedure
    .input(ApplyOpsInput)
    .output(ApplyOpsOutput)
    .mutation(() => {
      throw notImplemented("sync.applyOps");
    }),

  /** Full snapshot of the local vault as upsert ops (initial server seed). */
  snapshot: publicProcedure
    .output(SnapshotOutput)
    .query(() => {
      throw notImplemented("sync.snapshot");
    }),

  /** Local state summary used by the sync UI. */
  head: publicProcedure
    .output(SyncHeadOutput)
    .query(() => {
      throw notImplemented("sync.head");
    }),

  /**
   * Detect `.md` files modified outside the app, reconcile them into the local
   * vault, and return the resulting upsert ops to push (dual folder+server
   * mode). Mutates the DB, hence a mutation.
   */
  collectLocalChanges: publicProcedure
    .output(CollectLocalChangesOutput)
    .mutation(() => {
      throw notImplemented("sync.collectLocalChanges");
    }),
});

export type SyncRouter = typeof syncRouter;
