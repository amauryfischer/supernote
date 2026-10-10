import { defineConfig, devices } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { release } from "node:os";
import path from "node:path";

// ⚠️ WSL2 en réseau miroir : toutes les ~26 s, l'hôte retire puis remet l'IP d'eth0.
// Chromium (AddressTrackerLinux) y voit un changement d'IP et vide ses pools de
// sockets en ERR_NETWORK_CHANGED, localhost compris. Modules Vite et worker du
// coffre se perdent alors au hasard (SQ-63). Aucun switch Chromium ne coupe ce flush,
// donc tout le run (runner, Vite, Chromium) est relancé dans un namespace réseau réduit à lo.
// ponytail: relance depuis la config ; passer par un script test:e2e dédié si ça grossit.
if (!process.env["SUPERNOTE_E2E_NETNS"] && release().includes("microsoft")) {
  const run = spawnSync(
    "unshare",
    ["-rn", "sh", "-c", 'ip link set lo up && exec "$0" "$@"', process.execPath, ...process.argv.slice(1)],
    { stdio: "inherit", env: { ...process.env, SUPERNOTE_E2E_NETNS: "1" } },
  );
  if (!run.error) process.exit(run.status ?? 1);
}

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
