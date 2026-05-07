import { app, BrowserWindow, shell, globalShortcut } from "electron";
import path from "path";
import { createWindow, createCaptureWindow, stopStandaloneServer } from "./window";
import { acquireSingleInstanceLock } from "./single-instance";
import { VaultManager } from "./services/vault-manager";
import { FileWatcher } from "./services/file-watcher";
import { AutomationsRuntime } from "./services/automations-runtime";
import { NotificationsRuntime } from "./services/notifications-runtime";
import {
  setVaultManager,
  setFileWatcher,
  setAutomationsRuntime,
  setNotificationsRuntime,
} from "./services/service-registry";
import { registerTrpcBridge } from "./trpc-bridge";
import { logger } from "./logger";
import { setupAutoUpdater } from "./services/auto-updater";

let vaultManager: VaultManager;
let fileWatcher: FileWatcher;
let automationsRuntime: AutomationsRuntime;
let notificationsRuntime: NotificationsRuntime;

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
  automationsRuntime = new AutomationsRuntime();
  notificationsRuntime = new NotificationsRuntime();

  setVaultManager(vaultManager);
  setFileWatcher(fileWatcher);
  setAutomationsRuntime(automationsRuntime);
  setNotificationsRuntime(notificationsRuntime);

  // Register the tRPC IPC bridge before creating windows so the renderer
  // can call procedures immediately on load.
  registerTrpcBridge(vaultManager);

  app.whenReady().then(async () => {
    const win = await createWindow();
    logger.info("Supernote desktop ready", { version: app.getVersion() });

    // Wire auto-updater — only in production (packaged) builds.
    if (app.isPackaged) {
      setupAutoUpdater(win);
    }

    // Register global shortcut for quick capture — silent on failure (e.g., key already taken)
    try {
      const registered = globalShortcut.register("CommandOrControl+Shift+N", () => {
        void createCaptureWindow();
      });
      if (!registered) {
        logger.warn("Global shortcut CommandOrControl+Shift+N could not be registered");
      }
    } catch (err) {
      logger.warn("Failed to register global shortcut", { err });
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    globalShortcut.unregisterAll();
    fileWatcher.stop();
    stopStandaloneServer();
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
