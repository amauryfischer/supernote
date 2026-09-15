import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// 3277 et pas 3100 : le port de dev par défaut est tenu par un service Windows
// invisible depuis WSL, et vite dérive alors silencieusement sur 3101.
const PORT = 3277;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
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
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
  },

  outputDir: path.join(__dirname, "tests/e2e/results"),
});
