export type {
  SyncOpKind,
  EntityOpPayload,
  EntityOp,
  StoredOp,
  SyncInfo,
  PushRequest,
  PushResponse,
  PullResponse,
  SyncStreamEvent,
} from "./types.js";

export {
  isOpNewer,
  reduceLatestPerEntity,
  dedupeByOpId,
  rejectOwnOps,
  maxSeq,
  newOpId,
} from "./oplog.js";
