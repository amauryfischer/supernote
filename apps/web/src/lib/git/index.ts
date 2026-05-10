/**
 * Git sync for Supernote — wraps `isomorphic-git` with sensible defaults
 * tailored to a vault folder picked via the File System Access API.
 *
 * Public surface (used by PwaVaultSetup and /parametres > sync):
 *   - cloneIntoVault(handle, { url, token, ref })   → clone an HTTPS remote
 *   - initInVault(handle, { url, token })           → init a fresh repo and
 *                                                     wire a remote
 *   - syncOnce(handle, { url, token })              → pull → commit local
 *                                                     changes → push
 *   - getStatus(handle)                             → list files vs. HEAD
 *
 * Auth: only HTTPS + Personal Access Token (PAT) is supported. The token
 * is sent as the username (GitHub/GitLab/Forgejo all accept this form).
 *
 * Storage of the token: NOT here. The caller persists it in IndexedDB so
 * a malicious .gitignore'd file can't accidentally read it.
 */

import * as git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { createFsaFs } from "./fsa-fs";

export interface GitConfig {
  /** HTTPS clone URL — e.g. `https://github.com/me/notes.git`. */
  url: string;
  /** Personal Access Token. Optional for public repos. */
  token?: string | null;
  /** Branch to track. Defaults to `main`. */
  ref?: string;
  /** Commit author identity. */
  author?: { name: string; email: string };
}

const DEFAULT_AUTHOR = { name: "Supernote", email: "supernote@local" };

/**
 * GitHub / GitLab / Forgejo etc. don't send CORS headers on their smart-HTTP
 * endpoints, so a direct browser→remote request fails with "Failed to fetch".
 * isomorphic-git hosts a public proxy that re-forwards the request with the
 * right headers. It's free, no signup, and used by Gitpod / StackBlitz /
 * similar projects.
 *
 * Caveats: the proxy SEES the PAT (it sits between the browser and GitHub).
 * For sensitive setups, self-host the proxy with a one-liner Docker image —
 * see https://github.com/isomorphic-git/cors-proxy — and override this URL
 * via a future setting. For now the public proxy unblocks the typical user.
 */
const CORS_PROXY = "https://cors.isomorphic-git.org";

/**
 * Pure-HTTPS auth callback. isomorphic-git invokes this whenever the remote
 * answers 401. We forward the configured PAT as the basic-auth username
 * (the empty password is intentional — GitHub & friends use the username
 * slot for the token).
 */
function makeAuthCallback(token: string | null | undefined) {
  if (!token) return undefined;
  return () => ({ username: token, password: "x-oauth-basic" });
}

/** True if the directory already contains a `.git` folder. */
export async function isRepo(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    await handle.getDirectoryHandle(".git");
    return true;
  } catch {
    return false;
  }
}

/**
 * Clone a remote repository into the vault folder. Fails if the folder is
 * non-empty (we don't want to mix existing vault content with someone
 * else's history).
 */
export async function cloneIntoVault(
  handle: FileSystemDirectoryHandle,
  config: GitConfig,
): Promise<void> {
  // Empty-folder guard — we error early so the user sees a clear message
  // instead of isomorphic-git's cryptic "could not write to non-empty
  // working tree" later.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const iter: AsyncIterable<string> = (handle as any).keys();
  for await (const _ of iter) {
    void _;
    throw new Error(
      "Le dossier doit être vide pour cloner un dépôt. Choisissez un dossier vide ou utilisez « Connecter un dépôt à un vault existant ».",
    );
  }

  const fs = createFsaFs(handle);
  await git.clone({
    fs,
    http,
    dir: "/",
    url: config.url,
    ref: config.ref ?? "main",
    singleBranch: true,
    depth: 1,
    onAuth: makeAuthCallback(config.token),
    corsProxy: CORS_PROXY,
  });
}

/**
 * Initialise a Git repo in an existing vault folder and link it to a
 * remote. Used when the user already has a populated vault and wants to
 * start syncing it without losing local files.
 *
 * Caller MUST follow this with an initial commit + push (handled by
 * `syncOnce`) so the remote receives the seed snapshot.
 */
export async function initInVault(
  handle: FileSystemDirectoryHandle,
  config: GitConfig,
): Promise<void> {
  const fs = createFsaFs(handle);
  await git.init({ fs, dir: "/", defaultBranch: config.ref ?? "main" });
  await git.addRemote({ fs, dir: "/", remote: "origin", url: config.url });
}

/**
 * Run one full sync cycle: fetch → fast-forward pull when possible → commit
 * local changes → push. Conflicts are NOT auto-resolved here; on a non-FF
 * pull we abort and surface the diverged state to the caller, which is
 * expected to render a conflict UI.
 *
 * Returns a summary so the caller can decide what to flash to the user.
 */
export interface SyncSummary {
  pulled: number; // commits pulled
  committed: boolean;
  pushed: boolean;
  conflicts: string[]; // file paths that diverged
}

export async function syncOnce(
  handle: FileSystemDirectoryHandle,
  config: GitConfig,
): Promise<SyncSummary> {
  const fs = createFsaFs(handle);
  const ref = config.ref ?? "main";
  const author = config.author ?? DEFAULT_AUTHOR;
  const onAuth = makeAuthCallback(config.token);

  // 1. Fetch remote so we have its tip locally.
  await git.fetch({
    fs,
    http,
    dir: "/",
    url: config.url,
    ref,
    singleBranch: true,
    onAuth,
    corsProxy: CORS_PROXY,
  });

  // 2. Try a fast-forward pull. isomorphic-git's `pull` is fast-forward by
  //    default; if a real merge would be required we fall back to listing
  //    the conflicts and bailing out.
  let pulledCount = 0;
  try {
    const before = await git.resolveRef({ fs, dir: "/", ref });
    await git.pull({
      fs,
      http,
      dir: "/",
      ref,
      singleBranch: true,
      author,
      onAuth,
      fastForward: true,
      corsProxy: CORS_PROXY,
    });
    const after = await git.resolveRef({ fs, dir: "/", ref });
    if (before !== after) {
      const log = await git.log({ fs, dir: "/", ref });
      pulledCount = log.findIndex((c) => c.oid === before);
      if (pulledCount < 0) pulledCount = 1;
    }
  } catch (err) {
    // Non-FF pull → diverged history. Collect the file list so the caller
    // can surface a conflict pane. Returning early keeps the local
    // worktree intact.
    const conflicts = await collectDiverged(fs, ref).catch(() => []);
    return { pulled: 0, committed: false, pushed: false, conflicts };
  }

  // 3. Stage every change in the worktree (new + modified + deleted).
  const status = await git.statusMatrix({ fs, dir: "/" });
  let needCommit = false;
  for (const [filepath, head, workdir, stage] of status) {
    if (workdir !== stage || workdir !== head) {
      if (workdir === 0) {
        await git.remove({ fs, dir: "/", filepath });
      } else {
        await git.add({ fs, dir: "/", filepath });
      }
      needCommit = true;
    }
  }

  let committed = false;
  if (needCommit) {
    await git.commit({
      fs,
      dir: "/",
      author,
      message: `auto: ${new Date().toISOString().slice(0, 19)}`,
    });
    committed = true;
  }

  // 4. Push.
  let pushed = false;
  try {
    await git.push({
      fs,
      http,
      dir: "/",
      remote: "origin",
      ref,
      url: config.url,
      onAuth,
      corsProxy: CORS_PROXY,
    });
    pushed = true;
  } catch (err) {
    // Non-fatal — keep the commit locally; next cycle will try again.
    console.warn("[git.syncOnce] push failed", err);
  }

  return { pulled: pulledCount, committed, pushed, conflicts: [] };
}

/**
 * Collect the file paths that differ between HEAD and the fetched remote
 * ref, used as a placeholder for the conflict pane until we have real
 * three-way merge support.
 */
async function collectDiverged(fs: ReturnType<typeof createFsaFs>, ref: string): Promise<string[]> {
  try {
    const local = await git.resolveRef({ fs, dir: "/", ref });
    const remote = await git.resolveRef({ fs, dir: "/", ref: `refs/remotes/origin/${ref}` });
    if (local === remote) return [];
    // List files touched by either side since the merge base.
    const base = await git.findMergeBase({ fs, dir: "/", oids: [local, remote] });
    if (!base[0]) return [];
    const [touched] = await Promise.all([
      git.walk({
        fs,
        dir: "/",
        trees: [git.TREE({ ref: base[0] }), git.TREE({ ref: local }), git.TREE({ ref: remote })],
        map: async (filepath, [b, l, r]) => {
          if (filepath === ".") return null;
          const lo = l ? await l.oid() : null;
          const ro = r ? await r.oid() : null;
          const bo = b ? await b.oid() : null;
          if (lo !== bo && ro !== bo && lo !== ro) return filepath;
          return null;
        },
      }),
    ]);
    return (touched as (string | null)[]).filter(Boolean) as string[];
  } catch {
    return [];
  }
}
