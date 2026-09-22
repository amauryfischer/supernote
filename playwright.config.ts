import { defineConfig, devices } from "@playwright/test";
import { createHash } from "node:crypto";
import path from "node:path";

// Port dérivé du worktree pour éviter qu'un worktree parallèle réutilise le
// serveur d'un autre. Plage 3200-3599 : à l'écart de 3100 (service Windows
// invisible depuis WSL, vite y dérive silencieusement sur 3101).
const PORT = 3200 + (createHash("sha256").update(__dirname).digest().readUInt16BE(0) % 400);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: path.join(__dirname, "tests/e2e/global-setup.ts"),
  retries: process.env["CI"] ? 1 : 0,
  timeout: 60_000,
  reporter: [["list"]],

  use: {
    ...devices["Desktop Chrome"],
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },

  projects: [{ name: "chromium" }],

  webServer: {
    command: `pnpm --filter @supernote/web dev --port ${PORT} --strictPort`,
    url: BASE_URL,
    // false partout : avec un port dérivé, "reuse" ne profite jamais qu'à une
    // collision de hash — --strictPort la fait alors échouer fort plutôt que
    // de faire tourner les tests sur le serveur d'un autre worktree.
    reuseExistingServer: false,
    timeout: 180_000,
    env: { DATABASE_URL: "file:./e2e-share.db" },
  },

  outputDir: path.join(__dirname, "tests/e2e/results"),
});
