/**
 * Conflict detection for dual folder+server sync.
 *
 * Pure decision logic, split out from `worker-router` so it can be unit-tested
 * without the sql.js / FSA machinery.
 */

/**
 * Decide whether applying an inbound op would silently discard an external
 * on-disk edit — in which case the caller preserves the current file in a
 * conflict sidecar before overwriting (the inbound op still wins, LWW).
 *
 *  - `existingFileHash`: hash of the bytes WE last wrote (the sync baseline,
 *    stored as `entity.fileHash`). Null when the entity was never written.
 *  - `diskHash`: hash of the bytes currently on disk.
 *  - `incomingHash`: hash of the bytes the inbound op wants to write.
 *
 * Loss is possible only when the disk diverged from our baseline (an external
 * edit happened) AND the incoming content differs from BOTH the baseline and
 * the disk — i.e. it is neither a re-apply of our last write nor identical to
 * the external edit. Every other case is a safe overwrite or a no-op.
 */
export function shouldPreserveConflict(args: {
  existingFileHash: string | null;
  diskHash: string;
  incomingHash: string;
}): boolean {
  const { existingFileHash, diskHash, incomingHash } = args;
  if (!existingFileHash) return false; // no baseline → nothing known to lose
  if (incomingHash === existingFileHash) return false; // op re-applies our baseline
  if (diskHash === existingFileHash) return false; // disk untouched since our write
  if (diskHash === incomingHash) return false; // disk already equals incoming
  return true;
}
