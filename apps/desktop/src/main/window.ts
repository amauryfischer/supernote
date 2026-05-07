import { BrowserWindow, app, screen } from "electron";
import path from "path";

const WINDOW_WIDTH = 1400;
const WINDOW_HEIGHT = 900;

const IS_DEV = process.env["NODE_ENV"] === "development" || !app.isPackaged;
const WEB_DEV_URL = "http://localhost:3000";
const WEB_PROD_PATH = path.join(__dirname, "../../apps/web/out/index.html");

function getTitleBarOptions(): Partial<Electron.BrowserWindowConstructorOptions> {
  if (process.platform === "darwin") {
    return { titleBarStyle: "hiddenInset" };
  }
  return {
    frame: false,
    titleBarStyle: "hidden",
  };
}

export function createWindow(): BrowserWindow {
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
  } else {
    void win.loadFile(WEB_PROD_PATH);
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
export function createCaptureWindow(): BrowserWindow {
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
  } else {
    void win.loadFile(WEB_PROD_PATH, { hash: "/capture" });
  }

  return win;
}

