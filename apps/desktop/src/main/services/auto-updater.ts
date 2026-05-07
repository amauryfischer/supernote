import { autoUpdater } from "electron-updater";
import { ipcMain, type BrowserWindow } from "electron";
import { logger } from "../logger";

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Wire electron-updater to the given BrowserWindow.
 * - Does NOT auto-download: user must confirm first.
 * - Checks for updates at boot, then every 4 hours.
 * - Pushes IPC events to the renderer: "update-available" / "update-downloaded".
 */
export function setupAutoUpdater(window: BrowserWindow): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    window.webContents.send("update-available", info);
  });

  autoUpdater.on("update-downloaded", (info) => {
    window.webContents.send("update-downloaded", info);
  });

  autoUpdater.on("error", (err) => {
    logger.error("[auto-updater]", { err });
  });

  // IPC handlers so the renderer can trigger download / install.
  ipcMain.handle("updater:download", () => downloadUpdate());
  ipcMain.on("updater:quit-and-install", () => quitAndInstall());

  void checkForUpdates();
  setInterval(() => void checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);
}

async function checkForUpdates(): Promise<void> {
  try {
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    logger.error("[auto-updater] checkForUpdates failed", { err });
  }
}

/** Trigger an immediate download of the already-available update. */
export async function downloadUpdate(): Promise<void> {
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    logger.error("[auto-updater] downloadUpdate failed", { err });
    throw err;
  }
}

/** Quit the app and install the downloaded update immediately. */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}
