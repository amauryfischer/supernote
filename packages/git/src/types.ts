/** Git author information */
export interface GitAuthor {
  name: string;
  email: string;
}

/** Status of a single file in the working tree */
export interface GitFileStatus {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "unmerged";
}

/** Snapshot of repository working tree status */
export interface GitStatus {
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: string[];
}

/** A single line change in a diff hunk */
export interface GitDiffLine {
  type: "context" | "add" | "remove";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

/** A contiguous block of changes in a diff */
export interface GitDiffHunk {
  header: string;
  lines: GitDiffLine[];
}

/** Structured diff result for a single file */
export interface GitDiff {
  path: string;
  commitSha: string;
  hunks: GitDiffHunk[];
  additions: number;
  deletions: number;
}

/** Metadata for a single git commit */
export interface GitCommit {
  sha: string;
  message: string;
  author: GitAuthor;
  date: Date;
  parents: string[];
  affectedPaths?: string[];
}

/** Options for auto-commit scheduling */
export interface AutoCommitOptions {
  intervalMinutes: number;
  minChangedFiles?: number;
  messageTemplate?: string;
}

/** Options for opening a repository */
export interface OpenRepoOptions {
  gitdir?: string;
}

/** Options for git log */
export interface LogOptions {
  path?: string;
  limit?: number;
}

/** Options for push */
export interface PushOptions {
  force?: boolean;
}

/** Default author used when none is provided */
export const DEFAULT_AUTHOR: GitAuthor = {
  name: "Supernote",
  email: "autocommit@supernote.local",
};
