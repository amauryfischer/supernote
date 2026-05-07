import { BrowserWindow, app } from "electron";
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
