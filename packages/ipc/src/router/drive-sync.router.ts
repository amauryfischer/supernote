import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  DriveSyncLocalFilesInput,
  DriveSyncLocalFilesOutput,
  DriveSyncApplyRemoteInput,
  DriveSyncApplyRemoteOutput,
  DriveSyncDeleteLocalInput,
  DriveSyncLinkInput,
  DriveSyncStateRowSchema,
  DriveSyncStateRemoveInput,
  DriveSyncStateListOutput,
  DriveSyncOkOutput,
  DriveSyncPointerSchema,
  DriveSyncPointersOutput,
  DriveSyncPutPointerInput,
} from "../schemas/drive-sync.js";

/** Implémenté par le worker du coffre (`apps/web/src/lib/vault-worker/drive-sync-routes.ts`). */
export const driveSyncRouter = router({
  localFiles: publicProcedure.input(DriveSyncLocalFilesInput).output(DriveSyncLocalFilesOutput).query(() => {
    throw notImplemented("driveSync.localFiles");
  }),
  applyRemote: publicProcedure.input(DriveSyncApplyRemoteInput).output(DriveSyncApplyRemoteOutput).mutation(() => {
    throw notImplemented("driveSync.applyRemote");
  }),
  localPointers: publicProcedure.input(DriveSyncLocalFilesInput).output(DriveSyncPointersOutput).query(() => {
    throw notImplemented("driveSync.localPointers");
  }),
  putPointer: publicProcedure.input(DriveSyncPutPointerInput).output(DriveSyncPointerSchema).mutation(() => {
    throw notImplemented("driveSync.putPointer");
  }),
  deleteLocal: publicProcedure.input(DriveSyncDeleteLocalInput).output(DriveSyncOkOutput).mutation(() => {
    throw notImplemented("driveSync.deleteLocal");
  }),
  stateList: publicProcedure.input(DriveSyncLinkInput).output(DriveSyncStateListOutput).query(() => {
    throw notImplemented("driveSync.stateList");
  }),
  stateUpsert: publicProcedure.input(DriveSyncStateRowSchema).output(DriveSyncOkOutput).mutation(() => {
    throw notImplemented("driveSync.stateUpsert");
  }),
  stateRemove: publicProcedure.input(DriveSyncStateRemoveInput).output(DriveSyncOkOutput).mutation(() => {
    throw notImplemented("driveSync.stateRemove");
  }),
  stateClearLink: publicProcedure.input(DriveSyncLinkInput).output(DriveSyncOkOutput).mutation(() => {
    throw notImplemented("driveSync.stateClearLink");
  }),
});

export type DriveSyncRouter = typeof driveSyncRouter;
