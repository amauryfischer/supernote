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
import { registerServiceWorker } from "./sw-register";

export function PwaBootstrap() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  return null;
}
