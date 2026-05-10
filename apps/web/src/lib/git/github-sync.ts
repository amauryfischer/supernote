/**
 * Sync engine that bridges a `FileSystemDirectoryHandle` (the vault on disk)
 * with a GitHub repository, using the REST API exclusively. No CORS proxy,
 * no smart-HTTP, no isomorphic-git in the runtime path.
 *
 * Public surface mirrors what `index.ts` previously exposed:
 *   - cloneIntoVault(handle, config)  → download the entire tree of HEAD
 *   - initInVault(handle, config)     → no-op clone (the next sync pushes
 *                                       the local files as the initial
 *                                       commit on an empty repo)
 *   - syncOnce(handle, config)        → pull remote changes + push local
 *                                       changes in one atomic commit
 *
 * Conflict policy: if a file diverged between local and remote (both
 * changed since the last sync), we DO NOT touch the local version. We
 * write the remote version to `<path>.remote-<sha7>.md` next to it and
 * surface the conflict to the caller. The user resolves manually in the
 * notes UI.
 *
 * Last-sync state: we persist the commit SHA that the local worktree
 * matches in IndexedDB (`lastSyncSha`). The next sync uses that as the
 * common ancestor — anything local that differs from `lastSyncSha`'s tree
 * is a local change, anything remote that's newer than `lastSyncSha` is a
 * remote change.
 */

import {
  createBlob,
  createCommit,
  createRef,
  createTree,
  getBlob,
  getCommit,
  getRef,
  getRepo,
  getTree,
  parseGithubUrl,
  type GitTreeEntry,
  type TreeChange,
  type GithubRepo,
} from "./github-rest";

export interface GitConfig {
  url: string;
  token?: string | null;
  ref?: string;
  author?: { name: string; email: string };
}

export interface SyncSummary {
  pulled: number;
  pushed: boolean;
  committed: boolean;
  conflicts: string[];
  /** SHA the local worktree is at after the sync. */
  headSha: string | null;
}

const DEFAULT_AUTHOR = { name: "Supernote", email: "supernote@local" };
const REMOTE_SUFFIX_RE = /\.remote-[0-9a-f]{7}\.[^/]+$/;

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

/** True if the vault folder already has a `.supernote-sync` marker. */
export async function isLinked(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    await handle.getFileHandle(".supernote-sync");
    return true;
  } catch {
    return false;
  }
}

/**
 * Clone the entire HEAD tree of the configured branch into an empty vault
 * folder. After the clone the vault is "linked" and `syncOnce` can be called
 * to keep it in sync.
 */
export async function cloneIntoVault(
  handle: FileSystemDirectoryHandle,
  config: GitConfig,
): Promise<{ headSha: string }> {
  console.info("[clone] start", { url: config.url, ref: config.ref });

  console.info("[clone] checking folder is empty…");
  if (!(await isEmpty(handle))) {
    throw new Error(
      "Le dossier doit être vide pour cloner. Choisissez un dossier vide ou utilisez « Initialiser ».",
    );
  }

  const repo = parseGithubUrl(config.url);
  const ref = config.ref ?? "main";
  const token = config.token ?? null;

  console.info("[clone] resolving remote ref", ref);
  const refData = await getRef(repo, ref, token);
  if (!refData) {
    console.info("[clone] remote ref absent, writing marker only");
    await writeLinkMarker(handle, repo, ref);
    return { headSha: "" };
  }

  console.info("[clone] remote HEAD =", refData.object.sha);
  const commit = await getCommit(repo, refData.object.sha, token);
  const tree = await getTree(repo, commit.tree.sha, token);
  if (tree.truncated) {
    throw new Error(
      "Le dépôt est trop grand pour être cloné via l'API REST (tree tronqué). Demandez à scinder ou contactez le support.",
    );
  }

  const blobs = tree.tree.filter((e) => e.type === "blob");
  console.info(`[clone] downloading ${blobs.length} blob(s)`);
  await runInChunks(blobs, 5, async (entry) => {
    try {
      const bytes = await getBlob(repo, entry.sha, token);
      await writeFile(handle, entry.path, bytes);
    } catch (err) {
      // Annotate the file that failed so the top-level error message points
      // at the offending path instead of a generic FSA "not found".
      throw new Error(`Échec écriture « ${entry.path} » : ${(err as Error).message}`);
    }
  });

  console.info("[clone] writing link marker");
  await writeLinkMarker(handle, repo, ref, refData.object.sha);
  console.info("[clone] done");
  return { headSha: refData.object.sha };
}

/**
 * Wire a vault folder (with existing content) to a GitHub repo without
 * downloading anything. The first `syncOnce` will treat every local file as
 * a fresh commit and push it.
 */
export async function initInVault(
  handle: FileSystemDirectoryHandle,
  config: GitConfig,
): Promise<void> {
  const repo = parseGithubUrl(config.url);
  const ref = config.ref ?? "main";
  // Validate that the repo exists and the token has access. We hit the
  // /repos endpoint which is cheap and clearly errors on bad PAT / typo.
  await getRepo(repo, config.token ?? null).catch((err: Error) => {
    throw new Error(`Impossible d'accéder au dépôt: ${err.message}`);
  });
  await writeLinkMarker(handle, repo, ref);
}

/**
 * Run one full sync cycle. Steps:
 *
 *   1. Read the local worktree → map of `path → bytes`.
 *   2. Read the remote tree (HEAD of branch).
 *   3. Read the snapshot from the last successful sync (its tree, fetched
 *      from the persisted SHA).
 *   4. Three-way merge:
 *        - local changed, remote unchanged          → push
 *        - local unchanged, remote changed          → pull
 *        - both changed and contents differ         → write remote as
 *          `<path>.remote-<sha7>.md`, keep local
 *        - both deleted / identical                 → nothing
 *   5. Build a new tree based on the remote tree, applying the local
 *      changes; commit; fast-forward the ref.
 *   6. For pulled files: write them to disk.
 *   7. Persist the new HEAD SHA as the next baseline.
 */
export async function syncOnce(
  handle: FileSystemDirectoryHandle,
  config: GitConfig,
  lastSyncSha: string | null,
): Promise<SyncSummary> {
  const repo = parseGithubUrl(config.url);
  const ref = config.ref ?? "main";
  const token = config.token ?? null;
  if (!token) {
    throw new Error("Un Personal Access Token est requis pour la synchronisation.");
  }
  const author = config.author ?? DEFAULT_AUTHOR;

  // 1. Local worktree snapshot
  const local = await readWorktree(handle);

  // 2. Remote state
  const refData = await getRef(repo, ref, token);

  // ── First push: remote branch doesn't exist yet ──────────────────────
  if (!refData) {
    if (local.size === 0) {
      return { pulled: 0, pushed: false, committed: false, conflicts: [], headSha: null };
    }
    // Initial commit on an empty repo.
    const blobs = await uploadBlobs(repo, token, local);
    const treeEntries: TreeChange[] = [];
    for (const [path, sha] of blobs) {
      treeEntries.push({ path, mode: "100644", type: "blob", sha });
    }
    // GitHub allows creating a tree without a base_tree when starting fresh.
    const tree = await createTreeNoBase(repo, treeEntries, token);
    const commit = await createCommit(
      repo,
      `init: ${new Date().toISOString().slice(0, 19)}`,
      tree.sha,
      [],
      token,
      author,
    );
    await createRef(repo, ref, commit.sha, token);
    return {
      pulled: 0,
      pushed: true,
      committed: true,
      conflicts: [],
      headSha: commit.sha,
    };
  }

  // 3. Remote tree
  const remoteCommit = await getCommit(repo, refData.object.sha, token);
  const remoteTreeRaw = await getTree(repo, remoteCommit.tree.sha, token);
  if (remoteTreeRaw.truncated) {
    throw new Error("Arbre distant tronqué — vault trop volumineux pour l'API REST.");
  }
  const remoteFiles = new Map<string, GitTreeEntry>(
    remoteTreeRaw.tree.filter((e) => e.type === "blob").map((e) => [e.path, e]),
  );

  // 4. Baseline (last successful sync). If we have no record, we treat the
  //    remote as the baseline — that means a divergent file is interpreted
  //    as a remote change, which is the safer default (no accidental
  //    overwrite of remote work).
  let baselineFiles = new Map<string, string>();
  if (lastSyncSha) {
    try {
      const baseCommit = await getCommit(repo, lastSyncSha, token);
      const baseTree = await getTree(repo, baseCommit.tree.sha, token);
      baselineFiles = new Map<string, string>(
        baseTree.tree.filter((e) => e.type === "blob").map((e) => [e.path, e.sha]),
      );
    } catch {
      // Baseline missing on remote (force-push elsewhere?); fall back to
      // treating remote as baseline.
      for (const [p, e] of remoteFiles) baselineFiles.set(p, e.sha);
    }
  } else {
    for (const [p, e] of remoteFiles) baselineFiles.set(p, e.sha);
  }

  // 5. Diff
  const localBlobs = new Map<string, { sha: string; bytes: Uint8Array }>();
  const treeChanges: TreeChange[] = [];
  const pullPaths: Array<{ path: string; remoteSha: string }> = [];
  const conflicts: string[] = [];

  // Compute every local file's blob SHA upfront (Git-style sha1 over
  // `blob <size>\0<content>`). Avoids uploading files that haven't changed
  // server-side either.
  for (const [path, bytes] of local) {
    if (REMOTE_SUFFIX_RE.test(path)) continue; // skip our own conflict copies
    const sha = await computeBlobSha(bytes);
    localBlobs.set(path, { sha, bytes });
  }

  // Files known on local OR remote OR baseline — union of all paths.
  const allPaths = new Set<string>();
  for (const p of localBlobs.keys()) allPaths.add(p);
  for (const p of remoteFiles.keys()) allPaths.add(p);
  for (const p of baselineFiles.keys()) allPaths.add(p);

  for (const path of allPaths) {
    const local = localBlobs.get(path);
    const remote = remoteFiles.get(path);
    const base = baselineFiles.get(path);

    // Categorize: x = absent, sha = present at that revision.
    const lSha = local?.sha ?? null;
    const rSha = remote?.sha ?? null;
    const bSha = base ?? null;

    if (lSha === rSha) continue; // nothing to do
    const localChanged = lSha !== bSha;
    const remoteChanged = rSha !== bSha;

    if (localChanged && !remoteChanged) {
      // Pure local change: push
      if (lSha === null) {
        treeChanges.push({ path, mode: "100644", type: "blob", sha: null });
      } else {
        // Upload blob if not already on remote
        treeChanges.push({ path, mode: "100644", type: "blob", sha: lSha });
      }
    } else if (!localChanged && remoteChanged) {
      // Pure remote change: pull
      if (rSha === null) {
        // Remote deleted — drop locally too.
        await deleteFile(handle, path).catch(() => undefined);
      } else {
        pullPaths.push({ path, remoteSha: rSha });
      }
    } else if (localChanged && remoteChanged) {
      // Conflict: keep local, write remote alongside
      if (rSha) {
        const shortSha = rSha.slice(0, 7);
        const dot = path.lastIndexOf(".");
        const sidecar =
          dot >= 0
            ? `${path.slice(0, dot)}.remote-${shortSha}${path.slice(dot)}`
            : `${path}.remote-${shortSha}`;
        pullPaths.push({ path: sidecar, remoteSha: rSha });
      }
      conflicts.push(path);
    }
  }

  // 6. Push: upload any new blobs we referenced by SHA but that GitHub
  //    might not yet know (it WILL know if the SHA already exists; uploading
  //    redundantly is fine — same SHA, same bytes).
  let committed = false;
  let pushed = false;
  let newHead = refData.object.sha;
  if (treeChanges.length > 0) {
    // Upload blobs for all local files we're keeping (those without a
    // remote SHA equivalent we already trust).
    const toUpload: Array<{ path: string; bytes: Uint8Array }> = [];
    for (const change of treeChanges) {
      if (change.sha === null) continue;
      const local = localBlobs.get(change.path);
      if (!local) continue;
      // Only upload if the remote tree doesn't already have this SHA.
      const remote = remoteFiles.get(change.path);
      if (remote?.sha === local.sha) continue;
      toUpload.push({ path: change.path, bytes: local.bytes });
    }
    const uploaded = await uploadBlobs(repo, token, new Map(toUpload.map((u) => [u.path, u.bytes])));
    // Rewrite the changes with the freshly-uploaded SHAs (which match
    // localBlobs.sha because we compute SHAs the same way).
    for (const change of treeChanges) {
      if (change.sha === null) continue;
      const sha = uploaded.get(change.path) ?? localBlobs.get(change.path)?.sha ?? null;
      if (sha) change.sha = sha;
    }
    const newTree = await createTree(repo, remoteCommit.tree.sha, treeChanges, token);
    const summary = summariseChanges(treeChanges);
    const commit = await createCommit(
      repo,
      `auto: ${summary} (${new Date().toISOString().slice(0, 19)})`,
      newTree.sha,
      [refData.object.sha],
      token,
      author,
    );
    try {
      await fastForward(repo, ref, commit.sha, token);
      committed = true;
      pushed = true;
      newHead = commit.sha;
    } catch (err) {
      // The remote moved while we were syncing. We don't try to merge here
      // — surface the situation so the caller can retry the cycle.
      console.warn("[github-sync] fast-forward refused", err);
    }
  }

  // 7. Pull: write the remote files we decided to fetch
  for (const { path, remoteSha } of pullPaths) {
    const bytes = await getBlob(repo, remoteSha, token);
    await writeFile(handle, path, bytes);
  }

  return {
    pulled: pullPaths.length,
    pushed,
    committed,
    conflicts,
    headSha: newHead,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────────

const LINK_MARKER = ".supernote-sync";

async function writeLinkMarker(
  handle: FileSystemDirectoryHandle,
  repo: GithubRepo,
  ref: string,
  headSha = "",
): Promise<void> {
  const payload = JSON.stringify({
    provider: "github",
    owner: repo.owner,
    repo: repo.repo,
    ref,
    headSha,
    createdAt: new Date().toISOString(),
  });
  await writeFile(handle, LINK_MARKER, new TextEncoder().encode(payload));
}

async function isEmpty(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const iter: AsyncIterable<string> = (handle as any).keys();
    for await (const _ of iter) {
      void _;
      return false;
    }
    return true;
  } catch (err) {
    // OneDrive / Google Drive virtual folders, system folders with
    // protected files (desktop.ini on Windows), permission-revoked
    // handles — any of these can throw NotFoundError on enumeration.
    // Surface a clear actionable message rather than the cryptic FSA one.
    const msg = (err as Error).message ?? "";
    if ((err as Error).name === "NotFoundError" || /not be found/i.test(msg)) {
      throw new Error(
        "Impossible d'ouvrir le dossier choisi (dossier introuvable ou synchronisé en ligne uniquement). Choisissez un dossier réellement présent sur le disque, hors OneDrive/Google Drive virtuels.",
      );
    }
    throw err;
  }
}

/**
 * Walk the vault folder and return `path → bytes` for every file. Paths
 * are forward-slash separated (Git convention). The `.supernote-sync`
 * marker is skipped — we don't want to commit it.
 */
async function readWorktree(
  handle: FileSystemDirectoryHandle,
  prefix = "",
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const entry of (handle as any).values() as AsyncIterable<FileSystemHandle>) {
    const name = entry.name;
    if (name === LINK_MARKER) continue;
    if (name === ".git") continue; // ignore any leftover isomorphic-git folder
    if (name.startsWith(".") && name !== ".gitignore") continue; // skip dotfiles by default
    const childPath = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === "directory") {
      const sub = await readWorktree(entry as FileSystemDirectoryHandle, childPath);
      for (const [p, b] of sub) out.set(p, b);
    } else {
      const file = await (entry as FileSystemFileHandle).getFile();
      out.set(childPath, new Uint8Array(await file.arrayBuffer()));
    }
  }
  return out;
}

async function writeFile(
  root: FileSystemDirectoryHandle,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) throw new Error(`invalid path ${path}`);
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = await cur.getDirectoryHandle(parts[i]!, { create: true });
  }
  const fh = await cur.getFileHandle(parts[parts.length - 1]!, { create: true });
  const writable = await fh.createWritable();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await writable.write(new Uint8Array(bytes) as any);
  } finally {
    await writable.close();
  }
}

async function deleteFile(root: FileSystemDirectoryHandle, path: string): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = await cur.getDirectoryHandle(parts[i]!);
  }
  await cur.removeEntry(parts[parts.length - 1]!);
}

/**
 * SHA-1 of a blob in the Git format: `blob <size>\0<content>`. Matches what
 * `git hash-object` produces, so we can compare to the SHAs returned by the
 * GitHub API for files that haven't changed.
 */
async function computeBlobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const buf = new Uint8Array(header.length + bytes.length);
  buf.set(header, 0);
  buf.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function uploadBlobs(
  repo: GithubRepo,
  token: string,
  files: Map<string, Uint8Array>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await runInChunks([...files.entries()], 5, async ([path, bytes]) => {
    const { sha } = await createBlob(repo, bytes, token);
    out.set(path, sha);
  });
  return out;
}

async function createTreeNoBase(
  repo: GithubRepo,
  changes: TreeChange[],
  token: string,
): Promise<{ sha: string }> {
  // When the branch doesn't exist yet we have no base_tree to extend.
  // Call the API directly without one.
  const res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.repo}/git/trees`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tree: changes }),
  });
  if (!res.ok) {
    throw new Error(`GitHub createTree (no base) → ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as { sha: string };
}

async function fastForward(
  repo: GithubRepo,
  ref: string,
  sha: string,
  token: string,
): Promise<void> {
  // PATCH refs requires the new SHA to be a descendant of the current one,
  // which is exactly the "fast-forward" semantic we want here.
  const res = await fetch(
    `https://api.github.com/repos/${repo.owner}/${repo.repo}/git/refs/heads/${encodeURIComponent(ref)}`,
    {
      method: "PATCH",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sha, force: false }),
    },
  );
  if (!res.ok) {
    throw new Error(`updateRef → ${res.status}: ${await res.text()}`);
  }
}

function summariseChanges(changes: TreeChange[]): string {
  const adds = changes.filter((c) => c.sha !== null).length;
  const dels = changes.filter((c) => c.sha === null).length;
  const parts: string[] = [];
  if (adds) parts.push(`${adds} fichier${adds > 1 ? "s" : ""} modifié${adds > 1 ? "s" : ""}`);
  if (dels) parts.push(`${dels} supprimé${dels > 1 ? "s" : ""}`);
  return parts.join(", ") || "sync";
}

/** Run `fn` over `items` with at most `concurrency` in flight at a time. */
async function runInChunks<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        for (;;) {
          const next = queue.shift();
          if (!next) return;
          await fn(next);
        }
      })(),
    );
  }
  await Promise.all(workers);
}
