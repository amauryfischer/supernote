/**
 * Playwright global setup — prepares an isolated test vault in a tmpdir,
 * then sets SUPERNOTE_VAULT_PATH env var so Electron reads it at boot.
 *
 * The test vault fixtures are copied from tests/e2e/fixtures/test-vault/.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FIXTURE_VAULT = path.join(__dirname, "fixtures", "test-vault");

export default async function globalSetup(): Promise<void> {
  const tmpDir = path.join(os.tmpdir(), `supernote-e2e-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  // Copy fixture vault into tmpdir if fixtures exist
  if (fs.existsSync(FIXTURE_VAULT)) {
    copyDir(FIXTURE_VAULT, path.join(tmpDir, "vault"));
  } else {
    fs.mkdirSync(path.join(tmpDir, "vault"), { recursive: true });
  }

  // Expose the vault path for tests via process.env
  process.env["SUPERNOTE_TEST_VAULT"] = path.join(tmpDir, "vault");
  process.env["SUPERNOTE_TEST_TMPDIR"] = tmpDir;

  console.log(`[setup] Test vault at: ${process.env["SUPERNOTE_TEST_VAULT"]}`);
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
