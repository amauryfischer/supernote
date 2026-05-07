/** Typed error hierarchy for git operations */

export class GitError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "GitError";
    this.cause = cause;
  }
}

export class RepoNotInitializedError extends GitError {
  constructor(rootPath: string) {
    super(`Git repository not initialized at: ${rootPath}`);
    this.name = "RepoNotInitializedError";
  }
}

export class CommitError extends GitError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "CommitError";
  }
}

export class RemoteError extends GitError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "RemoteError";
  }
}

export class RestoreError extends GitError {
  constructor(path: string, sha: string, cause?: unknown) {
    super(`Failed to restore "${path}" from commit ${sha}`, cause);
    this.name = "RestoreError";
  }
}
