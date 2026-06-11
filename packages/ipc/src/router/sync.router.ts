import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  ApplyOpsInput,
  ApplyOpsOutput,
  PurgeMountedInput,
  PurgeMountedOutput,
  SnapshotOutput,
  SyncHeadOutput,
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
 */
export const syncRouter = router({
  /** Apply a batch of remote ops to the local vault. Idempotent, LWW. */
  applyOps: publicProcedure
    .input(ApplyOpsInput)
    .output(ApplyOpsOutput)
    .mutation(() => {
      throw notImplemented("sync.applyOps");
    }),

  /** Remove all entities that were synced from a mounted vault. */
  purgeMounted: publicProcedure
    .input(PurgeMountedInput)
    .output(PurgeMountedOutput)
    .mutation(() => {
      throw notImplemented("sync.purgeMounted");
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
});

export type SyncRouter = typeof syncRouter;
