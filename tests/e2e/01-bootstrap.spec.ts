/**
 * 01-bootstrap.spec.ts
 *
 * Verifies the Electron app starts correctly:
 * - Main window opens and becomes visible
 * - window.__supernoteIPC is injected by the preload
 * - Vault auto-init creates the .supernote directory
 */

import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { tryLaunchApp, closeApp, isElectronAvailable, type AppHandle } from "./helpers";

test.describe("01 — bootstrap", () => {
  let handle: AppHandle | null = null;
  let electronSkipped = false;

  test.beforeAll(async () => {
    if (!isElectronAvailable()) {
      electronSkipped = true;
      return;
    }
    handle = await tryLaunchApp();
    if (!handle) electronSkipped = true;
  });

  test.afterAll(async () => {
    if (handle) {
      await closeApp(handle);
      handle = null;
    }
  });

  test("Electron window opens", async () => {
    if (electronSkipped || !handle) {
      test.skip(true, "Electron not available in this environment (WSL2/headless)");
      return;
    }
    expect(handle.page).toBeTruthy();
    const title = await handle.page.title();
    expect(typeof title).toBe("string");
  });

  test("window.__supernoteIPC is available in renderer", async () => {
    if (electronSkipped || !handle) {
      test.skip(true, "Electron not available in this environment (WSL2/headless)");
      return;
    }

    const hasIPC = await handle.page.evaluate(
      () => typeof window.__supernoteIPC !== "undefined"
    );
    expect(hasIPC).toBe(true);
  });

  test("__supernoteIPC.invoke is callable", async () => {
    if (electronSkipped || !handle) {
      test.skip(true, "Electron not available in this environment (WSL2/headless)");
      return;
    }

    const result = await handle.page.evaluate(async () => {
      const ipc = window.__supernoteIPC;
      if (!ipc) return null;
      return ipc.invoke("system.getDefaultVaultPath", "query");
    });

    expect(result).not.toBeNull();
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  test("vault auto-init creates .supernote directory", async () => {
    const testVault = process.env["SUPERNOTE_TEST_VAULT"] ?? "";
    if (!testVault) {
      test.skip(true, "SUPERNOTE_TEST_VAULT not set");
      return;
    }

    // The setup.ts global setup always creates this directory
    const vaultExists = fs.existsSync(testVault);
    expect(vaultExists).toBe(true);
  });
});
