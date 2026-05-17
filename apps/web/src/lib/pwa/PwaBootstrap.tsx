"use client";

/**
 * PwaBootstrap — client-side PWA initialization.
 *
 * Mounts once in layout.tsx. Responsibilities:
 *   1. Register the Service Worker
 *   2. Re-export PwaVaultSetup for vault picker
 *
 * Kept minimal — actual vault setup is in PwaVaultSetup.tsx.
 */

import { useEffect } from "react";
import { registerServiceWorker, listenForPeriodicTicks } from "./sw-register";

export function PwaBootstrap() {
  useEffect(() => {
    void registerServiceWorker();
    // Service Worker → vault worker bridge: forward periodic-sync nudges. The
    // vault worker module exposes `__supernoteWorker` on the window once
    // browser-link spawns it; we look it up lazily so the listener works
    // whether the SW pings before or after the vault boot.
    const unlisten = listenForPeriodicTicks(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const worker = (window as any).__supernoteWorker as Worker | undefined;
      if (!worker) return;
      worker.postMessage({ type: "AUTOMATION_TICK" });
    });
    return unlisten;
  }, []);

  return null;
}
