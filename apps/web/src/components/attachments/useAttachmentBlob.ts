/**
 * useAttachmentBlob — fetch the raw bytes of a vault attachment file via the
 * worker's `vault.readFile` RPC.
 *
 * Background: the FSA `FileSystemFileHandle` lives in the vault Web Worker
 * (we keep it there so it can't be invalidated by main-thread navigation).
 * Attachment viewers (image, pdf, csv, …) run on the main thread and need
 * access to file content. This hook bridges that gap — it asks the worker
 * to read the file, then returns the result to the React tree.
 *
 * What you get back:
 * - `bytes`: `ArrayBuffer` of the raw file (always present once loaded).
 * - `text`: UTF-8 decoded string (only meaningful for text formats — null
 *   when decoding the bytes as UTF-8 produced garbage or threw).
 * - `objectUrl`: a `Blob`-backed object URL, lazily created and revoked on
 *   unmount. Convenience for `<img src={objectUrl}>` / `<iframe src={…}>`.
 * - `mimeType`: best-effort guess from extension. Used to type the Blob.
 *
 * The hook re-runs whenever `path` changes. Errors surface via `error`.
 */

import { useEffect, useMemo, useState } from "react";
import { trpcVanillaClient } from "@/lib/trpc/client";

export interface AttachmentBlob {
  loading: boolean;
  error: string | null;
  bytes: ArrayBuffer | null;
  text: string | null;
  objectUrl: string | null;
  mimeType: string;
  size: number;
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".pdf": "application/pdf",
  ".html": "text/html",
  ".htm": "text/html",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ppt": "application/vnd.ms-powerpoint",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".gdoc": "application/json",
  ".gsheet": "application/json",
  ".gslides": "application/json",
};

export function mimeTypeForPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  const ext = path.slice(dot).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function useAttachmentBlob(path: string | null): AttachmentBlob {
  const [state, setState] = useState<Omit<AttachmentBlob, "objectUrl">>({
    loading: true,
    error: null,
    bytes: null,
    text: null,
    mimeType: "application/octet-stream",
    size: 0,
  });

  useEffect(() => {
    if (!path) {
      setState({
        loading: false,
        error: null,
        bytes: null,
        text: null,
        mimeType: "application/octet-stream",
        size: 0,
      });
      return;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    trpcVanillaClient.vault.readFile
      .query({ path })
      .then((result) => {
        if (cancelled) return;
        const r = result as {
          bytes: ArrayBuffer;
          text: string | null;
          size: number;
        };
        setState({
          loading: false,
          error: null,
          bytes: r.bytes,
          text: r.text,
          mimeType: mimeTypeForPath(path),
          size: r.size,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          bytes: null,
          text: null,
          mimeType: "application/octet-stream",
          size: 0,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  // Lazily build (and revoke) an object URL on top of the bytes — convenient
  // for `<img>`/`<iframe>` consumers. Revoked when bytes change or unmount
  // so we never leak a Blob in memory.
  const objectUrl = useMemo<string | null>(() => {
    if (!state.bytes) return null;
    const blob = new Blob([state.bytes], { type: state.mimeType });
    return URL.createObjectURL(blob);
  }, [state.bytes, state.mimeType]);

  useEffect(() => {
    if (!objectUrl) return;
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  return { ...state, objectUrl };
}
