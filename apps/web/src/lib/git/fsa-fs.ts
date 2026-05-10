/**
 * Adapter that exposes a `FileSystemDirectoryHandle` (File System Access API)
 * as the `fs` interface that `isomorphic-git` expects.
 *
 * isomorphic-git is filesystem-agnostic — it only needs a small subset of the
 * Node `fs/promises` surface (readFile, writeFile, mkdir, rmdir, unlink,
 * stat, lstat, readdir, readlink, symlink, chmod). We implement those here
 * by traversing nested handles. Operations are async and rooted at the
 * vault folder the user picked.
 *
 * Limitations:
 *   - No symlink support (FSA has no concept of them). `symlink`/`readlink`
 *     reject; isomorphic-git tolerates this for the operations we use.
 *   - `chmod` is a no-op (FSA has no permission bits).
 *   - File modes are reported as 100644 for files, 040755 for dirs.
 *   - Paths use forward slashes regardless of OS (Git's convention).
 *
 * This file does NOT depend on Node and is safe to import in the browser.
 */

import type { FsClient } from "isomorphic-git";

interface Stats {
  type: "file" | "dir" | "symlink";
  mode: number;
  size: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  uid: number;
  gid: number;
  dev: number;
  isFile: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
}

function statsFor(type: "file" | "dir", size = 0, mtimeMs = Date.now()): Stats {
  return {
    type,
    mode: type === "file" ? 0o100644 : 0o040755,
    size,
    ino: 0,
    mtimeMs,
    ctimeMs: mtimeMs,
    uid: 0,
    gid: 0,
    dev: 0,
    isFile: () => type === "file",
    isDirectory: () => type === "dir",
    isSymbolicLink: () => false,
  };
}

function splitPath(path: string): string[] {
  // Normalise: strip leading "/" / "./", drop empty segments
  return path
    .replace(/^\.?\/+/, "")
    .split("/")
    .filter((s) => s.length > 0 && s !== ".");
}

async function resolveDir(
  root: FileSystemDirectoryHandle,
  segments: string[],
  options: { create?: boolean } = {},
): Promise<FileSystemDirectoryHandle> {
  let cur = root;
  for (const seg of segments) {
    cur = await cur.getDirectoryHandle(seg, { create: options.create ?? false });
  }
  return cur;
}

async function resolveFile(
  root: FileSystemDirectoryHandle,
  path: string,
  options: { create?: boolean } = {},
): Promise<FileSystemFileHandle> {
  const segs = splitPath(path);
  if (segs.length === 0) throw enoent(path);
  const parent = await resolveDir(root, segs.slice(0, -1), { create: options.create });
  return parent.getFileHandle(segs[segs.length - 1]!, { create: options.create ?? false });
}

function enoent(path: string): NodeJS.ErrnoException {
  const e = new Error(`ENOENT: no such file or directory, '${path}'`) as NodeJS.ErrnoException;
  e.code = "ENOENT";
  e.errno = -2;
  return e;
}

function eexist(path: string): NodeJS.ErrnoException {
  const e = new Error(`EEXIST: file already exists, '${path}'`) as NodeJS.ErrnoException;
  e.code = "EEXIST";
  e.errno = -17;
  return e;
}

function eisdir(path: string): NodeJS.ErrnoException {
  const e = new Error(`EISDIR: illegal operation on a directory, '${path}'`) as NodeJS.ErrnoException;
  e.code = "EISDIR";
  e.errno = -21;
  return e;
}

/**
 * Build the `fs` adapter rooted at `root`. Pass it to isomorphic-git as
 * `{ fs: createFsaFs(handle) }`.
 */
export function createFsaFs(root: FileSystemDirectoryHandle): FsClient {
  // Cache stat() results briefly during a single pull/push so isomorphic-git
  // doesn't re-traverse the same directory hundreds of times.
  const statCache = new Map<string, Stats>();
  const flushCache = () => statCache.clear();

  const promises = {
    async readFile(
      path: string,
      options?: BufferEncoding | { encoding?: BufferEncoding } | null,
    ): Promise<Uint8Array | string> {
      try {
        const fh = await resolveFile(root, path);
        const file = await fh.getFile();
        const buf = new Uint8Array(await file.arrayBuffer());
        const enc = typeof options === "string" ? options : options?.encoding;
        if (enc) {
          return new TextDecoder(enc).decode(buf);
        }
        return buf;
      } catch (err) {
        if ((err as DOMException).name === "NotFoundError") throw enoent(path);
        throw err;
      }
    },

    async writeFile(
      path: string,
      data: string | Uint8Array,
      _options?: unknown,
    ): Promise<void> {
      void _options;
      flushCache();
      const fh = await resolveFile(root, path, { create: true });
      const writable = await fh.createWritable();
      try {
        // TS sees `Uint8Array<ArrayBufferLike>` because the byte source
        // may be backed by SharedArrayBuffer; FSA's `write` only accepts
        // a BufferSource backed by a concrete ArrayBuffer. We copy into a
        // fresh ArrayBuffer-backed Uint8Array to satisfy the variance
        // check (and to match what every FSA browser actually expects).
        const bytes =
          typeof data === "string"
            ? new TextEncoder().encode(data)
            : new Uint8Array(data);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await writable.write(bytes as any);
      } finally {
        await writable.close();
      }
    },

    async unlink(path: string): Promise<void> {
      flushCache();
      const segs = splitPath(path);
      if (segs.length === 0) throw enoent(path);
      const parent = await resolveDir(root, segs.slice(0, -1));
      try {
        await parent.removeEntry(segs[segs.length - 1]!);
      } catch (err) {
        if ((err as DOMException).name === "NotFoundError") throw enoent(path);
        throw err;
      }
    },

    async readdir(path: string): Promise<string[]> {
      try {
        const dir = await resolveDir(root, splitPath(path));
        const names: string[] = [];
        // FSA returns an async iterator on values()/keys()/entries().
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const name of (dir as any).keys()) {
          names.push(name as string);
        }
        return names;
      } catch (err) {
        if ((err as DOMException).name === "NotFoundError") throw enoent(path);
        throw err;
      }
    },

    async mkdir(path: string, _options?: unknown): Promise<void> {
      void _options;
      flushCache();
      const segs = splitPath(path);
      // Walk and create each segment
      let cur = root;
      for (const seg of segs) {
        cur = await cur.getDirectoryHandle(seg, { create: true });
      }
    },

    async rmdir(path: string): Promise<void> {
      flushCache();
      const segs = splitPath(path);
      if (segs.length === 0) return;
      const parent = await resolveDir(root, segs.slice(0, -1));
      try {
        // FSA: removeEntry({recursive:true}) drops a non-empty dir
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (parent as any).removeEntry(segs[segs.length - 1]!, { recursive: true });
      } catch (err) {
        if ((err as DOMException).name === "NotFoundError") throw enoent(path);
        throw err;
      }
    },

    async stat(path: string): Promise<Stats> {
      const cached = statCache.get(path);
      if (cached) return cached;
      const segs = splitPath(path);
      if (segs.length === 0) {
        const s = statsFor("dir");
        statCache.set(path, s);
        return s;
      }
      const parent = await resolveDir(root, segs.slice(0, -1)).catch(() => null);
      if (!parent) throw enoent(path);
      const leaf = segs[segs.length - 1]!;
      // Try file first, fall back to dir
      try {
        const fh = await parent.getFileHandle(leaf);
        const file = await fh.getFile();
        const s = statsFor("file", file.size, file.lastModified);
        statCache.set(path, s);
        return s;
      } catch {
        try {
          await parent.getDirectoryHandle(leaf);
          const s = statsFor("dir");
          statCache.set(path, s);
          return s;
        } catch {
          throw enoent(path);
        }
      }
    },

    async lstat(path: string): Promise<Stats> {
      // No symlink concept — same as stat.
      return promises.stat(path);
    },

    async readlink(path: string): Promise<string> {
      // No symlinks in FSA.
      throw enoent(path);
    },

    async symlink(_target: string, path: string): Promise<void> {
      void _target;
      // FSA cannot create symlinks. isomorphic-git checks for support
      // before calling, so this should rarely fire — throw to be safe.
      throw eisdir(path);
    },

    async chmod(_path: string, _mode: number): Promise<void> {
      // No-op (FSA has no permission bits).
      void _path;
      void _mode;
    },
  };

  return { promises };
}

export { eexist, eisdir, enoent };
