import { app, BrowserWindow, shell } from "electron";
import path from "path";
import { createWindow } from "./window";
import { acquireSingleInstanceLock } from "./single-instance";
import { VaultManager } from "./services/vault-manager";
import { FileWatcher } from "./services/file-watcher";
import { setVaultManager, setFileWatcher } from "./services/service-registry";
import { registerTrpcBridge } from "./trpc-bridge";
import { logger } from "./logger";

let vaultManager: VaultManager;
let fileWatcher: FileWatcher;

function main(): void {
  const hasLock = acquireSingleInstanceLock(focusMainWindow);
  if (!hasLock) {
    app.quit();
    return;
  }

  // Instantiate services as soon as the app module loads (before ready, so
  // userData path is available — app.getPath("userData") works before ready).
  vaultManager = new VaultManager();
  fileWatcher = new FileWatcher();

  setVaultManager(vaultManager);
  setFileWatcher(fileWatcher);

  // Register the tRPC IPC bridge before creating windows so the renderer
  // can call procedures immediately on load.
  registerTrpcBridge(vaultManager);

  app.whenReady().then(() => {
    createWindow();
    logger.info("Supernote desktop ready", { version: app.getVersion() });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    fileWatcher.stop();
    void vaultManager.closeVault();
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  // Open external links in the OS default browser, not Electron
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: "deny" };
    });
  });
}

function focusMainWindow(): void {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
}

main();
