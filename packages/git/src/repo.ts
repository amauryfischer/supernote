import fs from "node:fs/promises";
import nodefs from "node:fs";
import path from "node:path";
import git from "isomorphic-git";
import type { Logger } from "pino";
import type {
  GitStatus,
  GitFileStatus,
  GitCommit,
  GitAuthor,
  GitDiff,
  AutoCommitOptions,
  OpenRepoOptions,
  LogOptions,
  PushOptions,
} from "./types.js";
import type { GitRepo } from "./interface.js";
import { DEFAULT_AUTHOR } from "./types.js";
import { buildUnifiedDiff, parseUnifiedDiff } from "./diff.js";
import { CommitError, RemoteError, RestoreError } from "./errors.js";

/** Map isomorphic-git status codes to structured file status */
function mapStatusCode(
  code: string,
): GitFileStatus["status"] | "ignored" | "unmodified" {
  switch (code) {
    case "modified":
    case "*modified":
      return "modified";
    case "added":
    case "*added":
    case "absent":
      return "added";
    case "deleted":
    case "*deleted":
      return "deleted";
    case "unmodified":
      return "unmodified";
    default:
      return "modified";
  }
}

/** Translate a statusMatrix row into staged/unstaged classification */
function classifyStatusRow(
  filepath: string,
  head: number,
  workdir: number,
  stage: number,
): { staged?: GitFileStatus; unstaged?: GitFileStatus; untracked?: string } {
  // HEAD=0 means not in HEAD commit
  // WORKDIR=0 means not on disk, 1 means present unchanged, 2 means modified
  // STAGE=0 means not staged, 1 means same as HEAD, 2 means staged new/modified, 3 means staged delete

  const isUntracked = head === 0 && workdir === 2 && stage === 0;
  if (isUntracked) return { untracked: filepath };

  let staged: GitFileStatus | undefined;
  let unstaged: GitFileStatus | undefined;

  // Staged changes: stage differs from head
  if (stage !== head && stage !== 1) {
    const status: GitFileStatus["status"] =
      head === 0 ? "added" : stage === 0 ? "deleted" : "modified";
    staged = { path: filepath, status };
  }

  // Unstaged changes: workdir differs from stage
  if (workdir !== stage && !(workdir === 1 && stage === 1)) {
    const status: GitFileStatus["status"] =
      stage === 0 && workdir === 2
        ? "added"
        : workdir === 0
          ? "deleted"
          : "modified";
    unstaged = { path: filepath, status };
  }

  return { staged, unstaged };
}

export class GitRepoImpl implements GitRepo {
  private readonly dir: string;
  private readonly gitdir: string;
  private autoCommitTimer: ReturnType<typeof setInterval> | null = null;
  private readonly logger: Logger;

  constructor(
    rootPath: string,
    opts: OpenRepoOptions,
    logger: Logger,
  ) {
    this.dir = rootPath;
    this.gitdir = opts.gitdir ?? path.join(rootPath, ".git");
    this.logger = logger;
  }

  async init(): Promise<void> {
    this.logger.info({ dir: this.dir }, "Initializing git repository");
    await git.init({ fs: nodefs, dir: this.dir, gitdir: this.gitdir });
  }

  async status(): Promise<GitStatus> {
    const matrix = await git.statusMatrix({
      fs: nodefs,
      dir: this.dir,
      gitdir: this.gitdir,
    });

    const staged: GitFileStatus[] = [];
    const unstaged: GitFileStatus[] = [];
    const untracked: string[] = [];

    for (const [filepath, head, workdir, stage] of matrix) {
      const result = classifyStatusRow(
        filepath as string,
        head as number,
        workdir as number,
        stage as number,
      );
      if (result.untracked) untracked.push(result.untracked);
      if (result.staged) staged.push(result.staged);
      if (result.unstaged) unstaged.push(result.unstaged);
    }

    return { staged, unstaged, untracked };
  }

  async commitAll(message: string, author?: GitAuthor): Promise<string> {
    const resolvedAuthor = author ?? DEFAULT_AUTHOR;
    this.logger.info({ message }, "Staging all files");

    const matrix = await git.statusMatrix({
      fs: nodefs,
      dir: this.dir,
      gitdir: this.gitdir,
    });

    for (const [filepath, , workdir, stage] of matrix) {
      if (workdir === 0) {
        // Deleted from disk — remove from index
        await git.remove({
          fs: nodefs,
          dir: this.dir,
          gitdir: this.gitdir,
          filepath: filepath as string,
        });
      } else if (workdir !== stage) {
        await git.add({
          fs: nodefs,
          dir: this.dir,
          gitdir: this.gitdir,
          filepath: filepath as string,
        });
      }
    }

    try {
      const sha = await git.commit({
        fs: nodefs,
        dir: this.dir,
        gitdir: this.gitdir,
        message,
        author: {
          name: resolvedAuthor.name,
          email: resolvedAuthor.email,
        },
      });
      this.logger.info({ sha, message }, "Commit created");
      return sha;
    } catch (e) {
      throw new CommitError(`Failed to commit: ${message}`, e);
    }
  }

  async commitChanged(
    message: string,
    author?: GitAuthor,
  ): Promise<string | null> {
    const hasChanges = await this.hasUncommittedChanges();
    if (!hasChanges) {
      this.logger.debug("No changes to commit");
      return null;
    }
    return this.commitAll(message, author);
  }

  async log(opts?: LogOptions): Promise<GitCommit[]> {
    const rawCommits = await git.log({
      fs: nodefs,
      dir: this.dir,
      gitdir: this.gitdir,
      ref: "HEAD",
      filepath: opts?.path,
      depth: opts?.limit,
    });

    return Promise.all(
      rawCommits.map(async (c) => this.enrichCommit(c)),
    );
  }

  private async enrichCommit(
    c: Awaited<ReturnType<typeof git.log>>[number],
  ): Promise<GitCommit> {
    const affectedPaths = await this.getAffectedPaths(c.oid, c.commit.parent);
    return {
      sha: c.oid,
      message: c.commit.message.trim(),
      author: {
        name: c.commit.author.name,
        email: c.commit.author.email,
      },
      date: new Date(c.commit.author.timestamp * 1000),
      parents: c.commit.parent,
      affectedPaths,
    };
  }

  private async getAffectedPaths(
    oid: string,
    parents: string[],
  ): Promise<string[]> {
    if (parents.length === 0) return [];
    const parentOid = parents[0];
    if (!parentOid) return [];
    try {
      const affected: string[] = [];
      await git.walk({
        fs: nodefs,
        dir: this.dir,
        gitdir: this.gitdir,
        trees: [git.TREE({ ref: parentOid }), git.TREE({ ref: oid })],
        map: async (filepath, [parentEntry, commitEntry]) => {
          if (filepath === ".") return;
          const parentOidVal = await parentEntry?.oid();
          const commitOidVal = await commitEntry?.oid();
          if (parentOidVal !== commitOidVal) affected.push(filepath);
        },
      });
      return affected;
    } catch {
      return [];
    }
  }

  async show(commitSha: string, filePath: string): Promise<string> {
    const { blob } = await git.readBlob({
      fs: nodefs,
      dir: this.dir,
      gitdir: this.gitdir,
      oid: commitSha,
      filepath: filePath,
    });
    return new TextDecoder().decode(blob);
  }

  async restore(commitSha: string, filePath: string): Promise<void> {
    this.logger.info({ commitSha, filePath }, "Restoring file");
    try {
      const content = await this.show(commitSha, filePath);
      const fullPath = path.join(this.dir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
    } catch (e) {
      throw new RestoreError(filePath, commitSha, e);
    }
  }

  async diff(commitSha: string, filePath: string): Promise<GitDiff> {
    const commitContent = await this.show(commitSha, filePath);
    let workingContent: string;
    try {
      workingContent = await fs.readFile(
        path.join(this.dir, filePath),
        "utf-8",
      );
    } catch {
      workingContent = "";
    }
    const unified = buildUnifiedDiff(commitContent, workingContent, filePath);
    return parseUnifiedDiff(unified, filePath, commitSha);
  }

  startAutoCommit(opts: AutoCommitOptions): void {
    if (this.autoCommitTimer !== null) {
      this.stopAutoCommit();
    }
    const intervalMs = opts.intervalMinutes * 60 * 1000;
    const minChangedFiles = opts.minChangedFiles ?? 1;
    const template =
      opts.messageTemplate ??
      "auto: ${count} file(s) at ${date}";

    this.logger.info(
      { intervalMinutes: opts.intervalMinutes },
      "Starting auto-commit",
    );

    this.autoCommitTimer = setInterval(async () => {
      try {
        await this.runAutoCommit(minChangedFiles, template);
      } catch (e) {
        this.logger.error(e, "Auto-commit error");
      }
    }, intervalMs);
  }

  private async runAutoCommit(
    minChangedFiles: number,
    template: string,
  ): Promise<void> {
    const { staged, unstaged, untracked } = await this.status();
    const count = staged.length + unstaged.length + untracked.length;
    if (count < minChangedFiles) return;

    const date = new Date().toISOString();
    const message = template
      .replace("${count}", String(count))
      .replace("${date}", date);

    await this.commitAll(message);
  }

  stopAutoCommit(): void {
    if (this.autoCommitTimer !== null) {
      clearInterval(this.autoCommitTimer);
      this.autoCommitTimer = null;
      this.logger.info("Auto-commit stopped");
    }
  }

  async setRemote(name: string, url: string): Promise<void> {
    this.logger.info({ name, url }, "Setting remote");
    await git.addRemote({
      fs: nodefs,
      dir: this.dir,
      gitdir: this.gitdir,
      remote: name,
      url,
      force: true,
    });
  }

  async push(remote = "origin", opts?: PushOptions): Promise<void> {
    this.logger.info({ remote, force: opts?.force }, "Pushing");
    const http = await import("isomorphic-git/http/node");
    try {
      await git.push({
        fs: nodefs,
        http: http.default,
        dir: this.dir,
        gitdir: this.gitdir,
        remote,
        force: opts?.force ?? false,
      });
    } catch (e) {
      throw new RemoteError(`Push to ${remote} failed`, e);
    }
  }

  async pull(remote = "origin"): Promise<void> {
    this.logger.info({ remote }, "Pulling");
    const http = await import("isomorphic-git/http/node");
    try {
      await git.pull({
        fs: nodefs,
        http: http.default,
        dir: this.dir,
        gitdir: this.gitdir,
        remote,
        author: DEFAULT_AUTHOR,
      });
    } catch (e) {
      throw new RemoteError(`Pull from ${remote} failed`, e);
    }
  }

  async hasUncommittedChanges(): Promise<boolean> {
    const matrix = await git.statusMatrix({
      fs: nodefs,
      dir: this.dir,
      gitdir: this.gitdir,
    });
    // Any row where HEAD, workdir, stage differ from "clean" state [1,1,1]
    return matrix.some(
      ([, head, workdir, stage]) =>
        !(head === 1 && workdir === 1 && stage === 1),
    );
  }
}
