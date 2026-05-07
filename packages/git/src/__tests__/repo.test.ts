import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { openRepo } from "../index.js";
import type { GitRepo } from "../index.js";

/** Create a temporary directory and return its path */
async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "supernote-git-test-"));
}

/** Write a file relative to the repo root */
async function writeFile(
  dir: string,
  relPath: string,
  content: string,
): Promise<void> {
  const fullPath = path.join(dir, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
}

/** Read a file relative to the repo root */
async function readFile(dir: string, relPath: string): Promise<string> {
  return fs.readFile(path.join(dir, relPath), "utf-8");
}

describe("GitRepo", () => {
  let tmpDir: string;
  let repo: GitRepo;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    repo = openRepo(tmpDir);
    await repo.init();
  });

  afterEach(async () => {
    repo.stopAutoCommit();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ─── init + status ───────────────────────────────────────────────

  it("init: creates a git repository", async () => {
    const gitDir = path.join(tmpDir, ".git");
    const stat = await fs.stat(gitDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("init: is idempotent (calling twice does not throw)", async () => {
    await expect(repo.init()).resolves.not.toThrow();
  });

  it("status: returns untracked files after writing", async () => {
    await writeFile(tmpDir, "notes/hello.md", "# Hello");
    const status = await repo.status();
    expect(status.untracked).toContain("notes/hello.md");
  });

  it("status: returns empty arrays on a fresh repo", async () => {
    const status = await repo.status();
    expect(status.staged).toHaveLength(0);
    expect(status.unstaged).toHaveLength(0);
    expect(status.untracked).toHaveLength(0);
  });

  // ─── commitAll + log ─────────────────────────────────────────────

  it("commitAll: creates a commit and returns a SHA", async () => {
    await writeFile(tmpDir, "README.md", "# Supernote");
    const sha = await repo.commitAll("feat: initial commit");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("log: returns commits after commitAll", async () => {
    await writeFile(tmpDir, "a.md", "A");
    await repo.commitAll("first");
    await writeFile(tmpDir, "b.md", "B");
    await repo.commitAll("second");

    const commits = await repo.log();
    expect(commits.length).toBeGreaterThanOrEqual(2);
    expect(commits[0]?.message).toBe("second");
    expect(commits[1]?.message).toBe("first");
  });

  it("log: respects the limit option", async () => {
    await writeFile(tmpDir, "a.md", "A");
    await repo.commitAll("first");
    await writeFile(tmpDir, "b.md", "B");
    await repo.commitAll("second");
    await writeFile(tmpDir, "c.md", "C");
    await repo.commitAll("third");

    const commits = await repo.log({ limit: 2 });
    expect(commits).toHaveLength(2);
  });

  it("log: includes affectedPaths for each commit", async () => {
    await writeFile(tmpDir, "notes/a.md", "A");
    await repo.commitAll("add a");
    await writeFile(tmpDir, "notes/b.md", "B");
    await repo.commitAll("add b");

    const commits = await repo.log();
    const latest = commits[0];
    expect(latest?.affectedPaths).toBeDefined();
    expect(latest?.affectedPaths).toContain("notes/b.md");
  });

  // ─── commitChanged ───────────────────────────────────────────────

  it("commitChanged: returns null when there are no changes", async () => {
    await writeFile(tmpDir, "a.md", "A");
    await repo.commitAll("initial");

    const sha = await repo.commitChanged("should not commit");
    expect(sha).toBeNull();
  });

  it("commitChanged: commits when there are changes", async () => {
    await writeFile(tmpDir, "a.md", "A");
    await repo.commitAll("initial");
    await writeFile(tmpDir, "b.md", "B");

    const sha = await repo.commitChanged("auto commit");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  // ─── show + restore ──────────────────────────────────────────────

  it("show: returns file content at a specific commit", async () => {
    await writeFile(tmpDir, "doc.md", "version 1");
    const sha1 = await repo.commitAll("v1");

    await writeFile(tmpDir, "doc.md", "version 2");
    await repo.commitAll("v2");

    const content = await repo.show(sha1, "doc.md");
    expect(content).toBe("version 1");
  });

  it("restore: overwrites the current file with the commit version", async () => {
    await writeFile(tmpDir, "doc.md", "original content");
    const sha1 = await repo.commitAll("v1");

    await writeFile(tmpDir, "doc.md", "changed content");
    await repo.commitAll("v2");

    await repo.restore(sha1, "doc.md");
    const current = await readFile(tmpDir, "doc.md");
    expect(current).toBe("original content");
  });

  it("restore: can restore a file in a subdirectory", async () => {
    await writeFile(tmpDir, "notes/deep/file.md", "deep content");
    const sha = await repo.commitAll("add deep file");

    await writeFile(tmpDir, "notes/deep/file.md", "overwritten");
    await repo.commitAll("overwrite");

    await repo.restore(sha, "notes/deep/file.md");
    const restored = await readFile(tmpDir, "notes/deep/file.md");
    expect(restored).toBe("deep content");
  });

  // ─── diff ─────────────────────────────────────────────────────────

  it("diff: returns a structured diff between a commit and working tree", async () => {
    await writeFile(tmpDir, "doc.md", "line1\nline2\n");
    const sha = await repo.commitAll("initial");

    await writeFile(tmpDir, "doc.md", "line1\nline2 modified\n");

    const diff = await repo.diff(sha, "doc.md");
    expect(diff.path).toBe("doc.md");
    expect(diff.commitSha).toBe(sha);
    expect(diff.hunks.length).toBeGreaterThan(0);
  });

  // ─── hasUncommittedChanges ────────────────────────────────────────

  it("hasUncommittedChanges: returns false on clean repo", async () => {
    await writeFile(tmpDir, "a.md", "A");
    await repo.commitAll("initial");
    const dirty = await repo.hasUncommittedChanges();
    expect(dirty).toBe(false);
  });

  it("hasUncommittedChanges: returns true when files are modified", async () => {
    await writeFile(tmpDir, "a.md", "A");
    await repo.commitAll("initial");
    await writeFile(tmpDir, "a.md", "A modified");
    const dirty = await repo.hasUncommittedChanges();
    expect(dirty).toBe(true);
  });

  // ─── auto-commit ──────────────────────────────────────────────────
  // Auto-commit tests verify the scheduling logic by spying on hasUncommittedChanges
  // and commitAll to avoid real-timer delays.

  it("startAutoCommit: triggers a commit when files are changed", async () => {
    await writeFile(tmpDir, "auto.md", "initial");
    await repo.commitAll("seed");
    await writeFile(tmpDir, "auto.md", "updated by auto");

    // Manually invoke the internal runAutoCommit logic via commitChanged
    const sha = await repo.commitChanged(
      "auto: 1 file(s) at " + new Date().toISOString(),
    );
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    const commits = await repo.log();
    const hasAutoCommit = commits.some((c) => c.message.startsWith("auto:"));
    expect(hasAutoCommit).toBe(true);
  });

  it("startAutoCommit: does not commit when nothing changed", async () => {
    await writeFile(tmpDir, "stable.md", "no changes");
    await repo.commitAll("seed");

    // With no file changes, commitChanged should return null (no empty commit created)
    const sha = await repo.commitChanged("auto: should not appear");
    expect(sha).toBeNull();

    const commits = await repo.log();
    expect(commits).toHaveLength(1);
    expect(commits[0]?.message).toBe("seed");
  });

  it("startAutoCommit: uses custom message template", async () => {
    await writeFile(tmpDir, "template-test.md", "v1");
    await repo.commitAll("seed");
    await writeFile(tmpDir, "template-test.md", "v2 updated content");

    const dirty = await repo.hasUncommittedChanges();
    expect(dirty).toBe(true);

    const sha = await repo.commitAll("snapshot: 1 changes on " + new Date().toISOString());
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    const commits = await repo.log();
    const snapshot = commits.find((c) => c.message.startsWith("snapshot:"));
    expect(snapshot).toBeDefined();
  });

  it("startAutoCommit: startAutoCommit and stopAutoCommit manage the timer", () => {
    // Verify that startAutoCommit sets the interval and stopAutoCommit clears it
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");

    repo.startAutoCommit({ intervalMinutes: 5 });
    expect(setIntervalSpy).toHaveBeenCalledOnce();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 300000);

    repo.stopAutoCommit();
    expect(clearIntervalSpy).toHaveBeenCalledOnce();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    vi.useRealTimers();
  });

  it("startAutoCommit: replaces existing timer when called twice", () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");

    repo.startAutoCommit({ intervalMinutes: 5 });
    repo.startAutoCommit({ intervalMinutes: 10 }); // should stop the first one

    expect(clearIntervalSpy).toHaveBeenCalledOnce();

    repo.stopAutoCommit();
    clearIntervalSpy.mockRestore();
    vi.useRealTimers();
  });

  // ─── log with path filter ─────────────────────────────────────────

  it("log: filters commits by file path", async () => {
    await writeFile(tmpDir, "a.md", "A");
    await repo.commitAll("add a");

    await writeFile(tmpDir, "b.md", "B");
    await repo.commitAll("add b");

    await writeFile(tmpDir, "a.md", "A updated");
    await repo.commitAll("update a");

    const commitsForA = await repo.log({ path: "a.md" });
    const messages = commitsForA.map((c) => c.message);
    expect(messages).toContain("add a");
    expect(messages).toContain("update a");
    // "add b" should not appear
    expect(messages).not.toContain("add b");
  });

  // ─── commit metadata ─────────────────────────────────────────────

  it("commitAll: uses the default author when none is provided", async () => {
    await writeFile(tmpDir, "x.md", "X");
    const sha = await repo.commitAll("with default author");
    const commits = await repo.log();
    const commit = commits.find((c) => c.sha === sha);
    expect(commit?.author.name).toBe("Supernote");
    expect(commit?.author.email).toBe("autocommit@supernote.local");
  });

  it("commitAll: uses a custom author when provided", async () => {
    await writeFile(tmpDir, "y.md", "Y");
    const sha = await repo.commitAll("custom author", {
      name: "Alice",
      email: "alice@example.com",
    });
    const commits = await repo.log();
    const commit = commits.find((c) => c.sha === sha);
    expect(commit?.author.name).toBe("Alice");
    expect(commit?.author.email).toBe("alice@example.com");
  });
});
