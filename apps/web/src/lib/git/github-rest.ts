/**
 * Git-equivalent sync against GitHub via its REST API.
 *
 * Why this instead of `isomorphic-git`: GitHub does not send CORS headers on
 * its smart-HTTP Git protocol (the one isomorphic-git speaks), so a direct
 * browser → github.com request always fails with `Failed to fetch`. The
 * usual workaround is a CORS proxy, which means the PAT transits through a
 * third-party host that can read it. `api.github.com` on the other hand
 * sends `Access-Control-Allow-Origin: *` on every response, so the browser
 * can talk to it directly — the PAT only ever travels between the user's
 * device and GitHub. No middleman.
 *
 * The cost: we re-implement the parts of Git we need (read tree, upload
 * blobs, build tree, commit, fast-forward ref) using REST endpoints. For a
 * notes vault this is straightforward — see `syncOnce` below.
 *
 * Other Git hosts (GitLab, Gitea, Forgejo, Bitbucket) have similar REST
 * APIs but different shapes. We isolate GitHub-specific shape behind this
 * module so the rest of Supernote can stay provider-agnostic; adding other
 * providers later is a matter of writing sibling modules with the same
 * public surface.
 */

const GITHUB_API = "https://api.github.com";

export interface GithubRepo {
  owner: string;
  repo: string;
}

export class GithubApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "GithubApiError";
  }
}

/** Parse `https://github.com/owner/repo.git` (or `.../owner/repo`) → `{owner, repo}`. */
export function parseGithubUrl(url: string): GithubRepo {
  // Accept the common variants users paste: HTTPS clone URL, web URL,
  // `git@github.com:owner/repo.git` (we error out on SSH, it can't work
  // from a browser anyway).
  if (url.startsWith("git@") || url.startsWith("ssh://")) {
    throw new Error("Les URL SSH ne fonctionnent pas depuis le navigateur. Utilisez l'URL HTTPS (https://github.com/owner/repo.git).");
  }
  const m = url.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!m) {
    throw new Error("URL GitHub invalide. Format attendu : https://github.com/owner/repo.git");
  }
  return { owner: m[1]!, repo: m[2]! };
}

/**
 * Build the Authorization header for the GitHub API. Fine-grained tokens
 * use `Bearer`, classic tokens accept either `token` or `Bearer` — Bearer is
 * the documented form for both today.
 */
function authHeader(token: string | null | undefined): Record<string, string> {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function api<T>(
  token: string | null | undefined,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...authHeader(token),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { message?: string };
      detail = j.message ?? "";
    } catch {
      /* not JSON, ignore */
    }
    throw new GithubApiError(
      res.status,
      `GitHub ${method} ${path} → ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  // 204 No Content (e.g. updateRef sometimes returns 200 with body, sometimes 204)
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── Refs ─────────────────────────────────────────────────────────────────────

export interface GitRef {
  ref: string;
  object: { sha: string; type: "commit" };
}

export async function getRef(
  repo: GithubRepo,
  ref: string,
  token: string | null,
): Promise<GitRef | null> {
  try {
    return await api<GitRef>(token, "GET", `/repos/${repo.owner}/${repo.repo}/git/ref/heads/${encodeURIComponent(ref)}`);
  } catch (err) {
    if (err instanceof GithubApiError && err.status === 404) return null;
    throw err;
  }
}

export async function updateRef(
  repo: GithubRepo,
  ref: string,
  sha: string,
  token: string,
  force = false,
): Promise<void> {
  await api(
    token,
    "PATCH",
    `/repos/${repo.owner}/${repo.repo}/git/refs/heads/${encodeURIComponent(ref)}`,
    { sha, force },
  );
}

export async function createRef(
  repo: GithubRepo,
  ref: string,
  sha: string,
  token: string,
): Promise<void> {
  await api(token, "POST", `/repos/${repo.owner}/${repo.repo}/git/refs`, {
    ref: `refs/heads/${ref}`,
    sha,
  });
}

// ── Commits & trees ──────────────────────────────────────────────────────────

export interface GitCommit {
  sha: string;
  tree: { sha: string };
  parents: { sha: string }[];
  message: string;
  author: { name: string; email: string; date: string };
}

export async function getCommit(repo: GithubRepo, sha: string, token: string | null): Promise<GitCommit> {
  return api<GitCommit>(token, "GET", `/repos/${repo.owner}/${repo.repo}/git/commits/${sha}`);
}

export interface GitTreeEntry {
  path: string;
  mode: "100644" | "100755" | "040000" | "120000" | "160000";
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

export interface GitTree {
  sha: string;
  tree: GitTreeEntry[];
  truncated: boolean;
}

export async function getTree(repo: GithubRepo, sha: string, token: string | null): Promise<GitTree> {
  return api<GitTree>(
    token,
    "GET",
    `/repos/${repo.owner}/${repo.repo}/git/trees/${sha}?recursive=1`,
  );
}

/**
 * Create a new tree based on `baseTreeSha`, applying the given changes.
 * `changes` describe NEW/MODIFIED files (provide content as base64) or
 * DELETIONS (sha: null) — GitHub merges them into the base tree.
 */
export interface TreeChange {
  path: string;
  mode: "100644" | "100755" | "040000" | "120000";
  type: "blob" | "tree";
  /** sha of an existing blob OR `null` to delete the path. */
  sha?: string | null;
  /** Inline content, alternative to sha. Always UTF-8 string. */
  content?: string;
}

export async function createTree(
  repo: GithubRepo,
  baseTreeSha: string,
  changes: TreeChange[],
  token: string,
): Promise<{ sha: string }> {
  return api<{ sha: string }>(token, "POST", `/repos/${repo.owner}/${repo.repo}/git/trees`, {
    base_tree: baseTreeSha,
    tree: changes,
  });
}

export async function createCommit(
  repo: GithubRepo,
  message: string,
  treeSha: string,
  parents: string[],
  token: string,
  author?: { name: string; email: string },
): Promise<{ sha: string }> {
  return api<{ sha: string }>(token, "POST", `/repos/${repo.owner}/${repo.repo}/git/commits`, {
    message,
    tree: treeSha,
    parents,
    ...(author ? { author: { ...author, date: new Date().toISOString() } } : {}),
  });
}

// ── Blobs ────────────────────────────────────────────────────────────────────

export interface BlobResponse {
  sha: string;
  size: number;
  encoding: "base64" | "utf-8";
  content: string;
}

/** Fetch a blob's content. The API returns base64 or utf-8 depending on size. */
export async function getBlob(repo: GithubRepo, sha: string, token: string | null): Promise<Uint8Array> {
  const b = await api<BlobResponse>(token, "GET", `/repos/${repo.owner}/${repo.repo}/git/blobs/${sha}`);
  if (b.encoding === "base64") {
    return base64ToBytes(b.content);
  }
  return new TextEncoder().encode(b.content);
}

export async function createBlob(
  repo: GithubRepo,
  bytes: Uint8Array,
  token: string,
): Promise<{ sha: string }> {
  // GitHub accepts base64-encoded blob content for safe binary upload.
  return api<{ sha: string }>(token, "POST", `/repos/${repo.owner}/${repo.repo}/git/blobs`, {
    content: bytesToBase64(bytes),
    encoding: "base64",
  });
}

// ── Repo metadata ────────────────────────────────────────────────────────────

export interface RepoInfo {
  default_branch: string;
  size: number;
  private: boolean;
}

export async function getRepo(repo: GithubRepo, token: string | null): Promise<RepoInfo> {
  return api<RepoInfo>(token, "GET", `/repos/${repo.owner}/${repo.repo}`);
}

// ── Base64 helpers (UTF-8 safe) ──────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  // btoa() only handles latin1, so we chunk to avoid stack overflow on large
  // files and pass each chunk through fromCharCode.
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  // GitHub wraps base64 at 60 cols; atob handles wrapping fine in Chrome but
  // we strip whitespace defensively for older runtimes.
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
