import pino from "pino";
import type { Logger } from "pino";
import { GitRepoImpl } from "./repo.js";
import type { OpenRepoOptions } from "./types.js";
import type { GitRepo } from "./interface.js";

export type { GitRepo } from "./interface.js";
export type {
  GitAuthor,
  GitStatus,
  GitFileStatus,
  GitCommit,
  GitDiff,
  GitDiffHunk,
  GitDiffLine,
  AutoCommitOptions,
  OpenRepoOptions,
  LogOptions,
  PushOptions,
} from "./types.js";
export { DEFAULT_AUTHOR } from "./types.js";
export {
  GitError,
  RepoNotInitializedError,
  CommitError,
  RemoteError,
  RestoreError,
} from "./errors.js";

/** Noop logger used by default — zero overhead */
const NOOP_LOGGER = pino({ level: "silent" });

/**
 * Open (or create) a GitRepo instance for the given root path.
 * Does NOT call `init()` automatically — call it explicitly if needed.
 */
export function openRepo(
  rootPath: string,
  opts?: OpenRepoOptions & { logger?: Logger },
): GitRepo {
  const logger = opts?.logger ?? NOOP_LOGGER;
  return new GitRepoImpl(rootPath, opts ?? {}, logger);
}
