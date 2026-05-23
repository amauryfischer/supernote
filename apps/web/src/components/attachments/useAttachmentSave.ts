/**
 * useAttachmentSave — debounced single-flight saver for attachment editors.
 *
 * Editors (CSV, XLSX) call `enqueue(bytes)` whenever the user mutates the
 * document. This hook:
 *   1. Debounces 1s (avoid flushing on every keystroke).
 *   2. Single-flights: if a save is in flight, stash the latest payload and
 *      drain it ONCE after the current save resolves. Mirrors the canvas
 *      save pipeline (commit 6faa8e1) — without this, rapid typing piled up
 *      parallel mutations and left the indicator pinned on "Enregistrement…".
 *   3. Exposes a status enum (`idle | saving | saved | error`) so the
 *      editor can render a save indicator identical to NoteCanvasView.
 *
 * Persistence path: `trpc.vault.writeFile.mutate({ path, bytes })` — the
 * worker already serialises per-path through its own mutex, so the
 * end-to-end pipeline is safe even if multiple editors target the same file
 * (rare but possible — e.g. two tabs of the same vault).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { trpcVanillaClient } from "@/lib/trpc/client";

export type AttachmentSaveStatus = "idle" | "saving" | "saved" | "error";

export interface AttachmentSave {
  readonly status: AttachmentSaveStatus;
  readonly error: string | null;
  /**
   * Queue a save with the given bytes. Debounce + single-flight semantics
   * apply (see hook docstring). Safe to call on every keystroke.
   */
  enqueue: (bytes: ArrayBuffer | Uint8Array) => void;
  /** Force-flush the pending payload immediately (no debounce wait). */
  flush: () => Promise<void>;
}

const DEBOUNCE_MS = 1000;

export function useAttachmentSave(path: string | null): AttachmentSave {
  const [status, setStatus] = useState<AttachmentSaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef<ArrayBuffer | Uint8Array | null>(null);
  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  const runSave = useCallback(async (payload: ArrayBuffer | Uint8Array) => {
    const currentPath = pathRef.current;
    if (!currentPath) return;
    inFlightRef.current = true;
    setStatus("saving");
    try {
      await trpcVanillaClient.vault.writeFile.mutate({
        path: currentPath,
        bytes: payload,
      });
      setStatus("saved");
      setError(null);
      console.info(
        `[useAttachmentSave] save complete path=${currentPath} bytes=${(payload as ArrayBuffer).byteLength ?? (payload as Uint8Array).byteLength}`,
      );
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      console.error("[useAttachmentSave] save failed", err);
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
      setTimeout(() => setStatus("idle"), 3000);
    } finally {
      inFlightRef.current = false;
      const queued = pendingRef.current;
      pendingRef.current = null;
      if (queued) {
        await runSave(queued);
      }
    }
  }, []);

  const enqueue = useCallback(
    (bytes: ArrayBuffer | Uint8Array) => {
      if (!pathRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setStatus("saving"); // optimistic indicator while debounce settles
      debounceRef.current = setTimeout(() => {
        if (inFlightRef.current) {
          pendingRef.current = bytes;
          return;
        }
        void runSave(bytes);
      }, DEBOUNCE_MS);
    },
    [runSave],
  );

  const flush = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const queued = pendingRef.current;
    pendingRef.current = null;
    if (queued && !inFlightRef.current) {
      await runSave(queued);
    }
  }, [runSave]);

  // Clear timer on unmount / path change so a pending save for an old path
  // never fires after the editor has moved on.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [path]);

  return { status, error, enqueue, flush };
}
