import { z } from "zod";

/** Contrats de la synchro dossier du coffre ↔ dossier Google Drive. Le réseau Drive reste sur le thread principal. */

export const DriveSyncLocalFileSchema = z.object({
  entityId: z.string(),
  filePath: z.string(),
  fileHash: z.string(),
  content: z.string(),
});
export type DriveSyncLocalFile = z.infer<typeof DriveSyncLocalFileSchema>;

export const DriveSyncStateRowSchema = z.object({
  linkId: z.string(),
  driveFileId: z.string(),
  entityId: z.string(),
  relPath: z.string(),
  driveMd5: z.string(),
  localHash: z.string(),
  syncedAt: z.number(),
});
export type DriveSyncStateRow = z.infer<typeof DriveSyncStateRowSchema>;

export const DriveSyncLocalFilesInput = z.object({ prefix: z.string() });
export const DriveSyncLocalFilesOutput = z.array(DriveSyncLocalFileSchema);

export const DriveSyncApplyRemoteInput = z.object({
  entityId: z.string().optional(),
  filePath: z.string(),
  content: z.string(),
});
export const DriveSyncApplyRemoteOutput = DriveSyncLocalFileSchema;

export const DriveSyncDeleteLocalInput = z.object({ entityId: z.string() });
export const DriveSyncLinkInput = z.object({ linkId: z.string() });
export const DriveSyncStateRemoveInput = z.object({ linkId: z.string(), driveFileId: z.string() });
export const DriveSyncStateListOutput = z.array(DriveSyncStateRowSchema);
export const DriveSyncOkOutput = z.object({ ok: z.literal(true) });
