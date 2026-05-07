import { BrowserWindow, app, screen } from "electron";
import path from "path";
import net from "net";
import http from "http";
import { spawn, ChildProcess } from "child_process";
import fs from "fs";

const WINDOW_WIDTH = 1400;
const WINDOW_HEIGHT = 900;

const IS_DEV = process.env["NODE_ENV"] === "development" || !app.isPackaged;
const WEB_DEV_URL = "http://localhost:3000";

function getTitleBarOptions(): Partial<Electron.BrowserWindowConstructorOptions> {
  if (process.platform === "darwin") {
    return { titleBarStyle: "hiddenInset" };
  }
  return {
    frame: false,
    titleBarStyle: "hidden",
  };
}

// ---------------------------------------------------------------------------
// Standalone Next.js server management
// ---------------------------------------------------------------------------

let standaloneServerProcess: ChildProcess | null = null;
let standalonePort: number | null = null;

/**
 * Returns the absolute path to the standalone server.js inside the packaged
 * resources. In a pnpm monorepo the standalone output mirrors the workspace
 * layout: apps/web/.next/standalone/apps/web/server.js.
 */
function getStandaloneServerPath(): string {
  return path.join(
    process.resourcesPath,
    "app",
    "web-server",
    "apps",
    "web",
    "server.js",
  );
}

/**
 * Finds a free TCP port by binding to port 0 and immediately releasing it.
 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Could not determine free port"));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

/**
 * Polls until the server at the given port returns an HTTP response, or until
 * the timeout elapses.
 */
function waitForServer(port: number, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function attempt(): void {
      if (Date.now() > deadline) {
        reject(new Error(`Server on port ${port} did not start within ${timeoutMs}ms`));
        return;
      }
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => setTimeout(attempt, 200));
      req.setTimeout(500, () => {
        req.destroy();
        setTimeout(attempt, 200);
      });
    }
    attempt();
  });
}

/**
 * Spawns the Next.js standalone server and returns the URL to load.
 */
async function startStandaloneServer(): Promise<string> {
  const serverPath = getStandaloneServerPath();
  const port = await findFreePort();
  standalonePort = port;

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
  };

  standaloneServerProcess = spawn(process.execPath, [serverPath], {
    env,
    cwd: path.dirname(serverPath),
    stdio: "pipe",
  });

  standaloneServerProcess.stdout?.on("data", (d: Buffer) => {
    process.stdout.write(`[next-server] ${d.toString()}`);
  });
  standaloneServerProcess.stderr?.on("data", (d: Buffer) => {
    process.stderr.write(`[next-server] ${d.toString()}`);
  });

  await waitForServer(port);
  return `http://127.0.0.1:${port}`;
}

/**
 * Returns true when the packaged standalone server.js exists on disk.
 * In dev mode, or when using static export, this will be false.
 */
function isStandaloneMode(): boolean {
  if (IS_DEV) return false;
  try {
    fs.accessSync(getStandaloneServerPath());
    return true;
  } catch {
    return false;
  }
}

/**
 * Kills the standalone Next.js server process if it is running.
 * Called on window-all-closed in index.ts.
 */
export function stopStandaloneServer(): void {
  if (standaloneServerProcess) {
    standaloneServerProcess.kill();
    standaloneServerProcess = null;
    standalonePort = null;
  }
}

// ---------------------------------------------------------------------------
// Window factories
// ---------------------------------------------------------------------------

export async function createWindow(): Promise<BrowserWindow> {
  const preloadPath = path.join(__dirname, "../preload/index.js");

  const win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: 800,
    minHeight: 600,
    ...getTitleBarOptions(),
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
  });

  if (IS_DEV) {
    void win.loadURL(WEB_DEV_URL);
    win.webContents.openDevTools();
  } else if (isStandaloneMode()) {
    const serverUrl = await startStandaloneServer();
    void win.loadURL(serverUrl);
  } else {
    // Fallback: static export (legacy / NEXT_BUILD_MODE=export builds)
    const staticPath = path.join(__dirname, "../../../web/out/index.html");
    void win.loadFile(staticPath);
  }

  return win;
}

const CAPTURE_WIDTH = 600;
const CAPTURE_HEIGHT = 180;

/**
 * Creates a frameless, transparent, always-on-top capture window positioned
 * at the top-center of the primary display.
 * The window loads the /capture route of the Next.js app.
 */
export async function createCaptureWindow(): Promise<BrowserWindow> {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
  const x = Math.round((screenWidth - CAPTURE_WIDTH) / 2);
  const y = 80; // top-center with some margin

  const preloadPath = path.join(__dirname, "../preload/index.js");

  const win = new BrowserWindow({
    width: CAPTURE_WIDTH,
    height: CAPTURE_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });

  // Close if it loses focus (user clicks elsewhere)
  win.on("blur", () => {
    win.close();
  });

  if (IS_DEV) {
    void win.loadURL(`${WEB_DEV_URL}/capture`);
  } else if (isStandaloneMode() && standalonePort !== null) {
    void win.loadURL(`http://127.0.0.1:${standalonePort}/capture`);
  } else {
    const staticPath = path.join(__dirname, "../../../web/out/index.html");
    void win.loadFile(staticPath, { hash: "/capture" });
  }

  return win;
}
