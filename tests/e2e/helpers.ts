/**
 * Shared test helpers for Playwright Electron E2E tests.
 *
 * Strategy for WSL2/headless environments:
 * - isElectronAvailable() → static check (binary + dist exist)
 * - probeElectronLaunch() → attempts launch, returns false if environment
 *   cannot run Electron (libnss3 missing, no DISPLAY, etc.)
 * - tryLaunchApp()  → returns AppHandle or null; NEVER throws on env issues
 */

import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";

export const DESKTOP_MAIN = path.join(
  __dirname,
  "../../apps/desktop/dist/main/index.js"
);
export const ELECTRON_BIN = path.join(
  __dirname,
  "../../apps/desktop/node_modules/.bin/electron"
);

/** Reasons why Electron cannot launch in this environment. */
const SKIP_ERROR_PATTERNS = [
  "libnss3",
  "cannot open shared object",
  "DISPLAY",
  "no usable sandbox",
  "Process failed to launch",
  "exitCode=127",
  "exitCode=1",
  "shared libraries",
];

export interface AppHandle {
  electronApp: ElectronApplication;
  page: Page;
}

/** Returns true when both the Electron binary and built main bundle exist on disk. */
export function isElectronAvailable(): boolean {
  return fs.existsSync(DESKTOP_MAIN) && fs.existsSync(ELECTRON_BIN);
}

/**
 * Probe whether Electron can actually launch in this environment.
 * Uses a quick child-process exit-code check to avoid Playwright's
 * internal error capture mechanism for the actual test.
 *
 * Returns true if Electron started successfully, false otherwise.
 */
export function canElectronRun(): boolean {
  if (!isElectronAvailable()) return false;

  try {
    // Read the actual electron binary path from electron's path.txt
    const electronDir = path.dirname(
      fs.realpathSync(ELECTRON_BIN)
    );
    // electron package writes the real binary to dist/electron
    const pathTxt = path.join(
      __dirname,
      "../../apps/desktop/node_modules/electron/path.txt"
    );
    const electronExe = fs.existsSync(pathTxt)
      ? path.join(
          __dirname,
          "../../apps/desktop/node_modules/electron/dist",
          fs.readFileSync(pathTxt, "utf-8").trim()
        )
      : null;

    if (!electronExe || !fs.existsSync(electronExe)) {
      return false;
    }

    // Quick probe: run electron --version; if it errors with lib load failures → false
    execSync(`"${electronExe}" --version`, {
      timeout: 5000,
      stdio: "pipe",
    });
    return true;
  } catch (err: unknown) {
    const msg = String(err);
    const isEnvIssue = SKIP_ERROR_PATTERNS.some((p) => msg.includes(p));
    if (isEnvIssue) {
      console.log(
        `[helpers] Electron cannot run: ${msg.split("\n")[0].slice(0, 120)}`
      );
    }
    return false;
  }
}

/**
 * Try to launch the Electron app. Returns AppHandle on success, null when
 * the environment cannot run Electron (WSL2/headless, missing libs, etc.).
 *
 * This function wraps the launch in a child-process probe first to avoid
 * Playwright capturing the error before our try-catch.
 */
export async function tryLaunchApp(): Promise<AppHandle | null> {
  if (!canElectronRun()) {
    console.log(
      "[helpers] SKIP: Electron cannot run in this environment (WSL2/headless)"
    );
    return null;
  }

  const testVault =
    process.env["SUPERNOTE_TEST_VAULT"] ??
    path.join(os.homedir(), "Documents", "Supernote-test");

  const electronApp = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [DESKTOP_MAIN],
    env: {
      ...process.env,
      NODE_ENV: "test",
      ELECTRON_ENABLE_LOGGING: "1",
      SUPERNOTE_TEST_VAULT: testVault,
    },
    timeout: 25_000,
  });

  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");

  return { electronApp, page };
}

/** Close app and wait for exit. */
export async function closeApp(handle: AppHandle): Promise<void> {
  await handle.electronApp.close();
}
