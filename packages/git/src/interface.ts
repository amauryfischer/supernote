import type {
  GitStatus,
  GitCommit,
  GitAuthor,
  GitDiff,
  AutoCommitOptions,
  LogOptions,
  PushOptions,
} from "./types.js";

/** Public contract for a git repository wrapper */
export interface GitRepo {
  /** Initialize the repository (idempotent) */
  init(): Promise<void>;

  /** Return a structured status, similar to `git status --porcelain` */
  status(): Promise<GitStatus>;

  /** Stage all changes and create a commit; returns the commit SHA */
  commitAll(message: string, author?: GitAuthor): Promise<string>;

  /**
   * Commit only when there are uncommitted changes.
   * Returns the SHA if a commit was made, or null if nothing changed.
   */
  commitChanged(message: string, author?: GitAuthor): Promise<string | null>;

  /** Return the commit history, optionally filtered to a file path */
  log(opts?: LogOptions): Promise<GitCommit[]>;

  /** Return the content of a file at a specific commit */
  show(commitSha: string, path: string): Promise<string>;

  /** Overwrite the current file with its content at a specific commit */
  restore(commitSha: string, path: string): Promise<void>;

  /** Return a structured diff of a file between a commit and the working tree */
  diff(commitSha: string, path: string): Promise<GitDiff>;

  /** Start the auto-commit scheduler */
  startAutoCommit(opts: AutoCommitOptions): void;

  /** Stop the auto-commit scheduler */
  stopAutoCommit(): void;

  /** Configure a remote */
  setRemote(name: string, url: string): Promise<void>;

  /** Push to a remote */
  push(remote?: string, opts?: PushOptions): Promise<void>;

  /** Pull from a remote */
  pull(remote?: string): Promise<void>;

  /** Return true when there are staged, unstaged, or untracked changes */
  hasUncommittedChanges(): Promise<boolean>;
}
