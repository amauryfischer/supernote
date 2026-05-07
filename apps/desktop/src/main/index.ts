import { app, BrowserWindow, shell } from "electron";
import path from "path";
import { createWindow } from "./window";
import { acquireSingleInstanceLock } from "./single-instance";

function main(): void {
  const hasLock = acquireSingleInstanceLock(focusMainWindow);
  if (!hasLock) {
    app.quit();
    return;
  }

  app.whenReady().then(() => {
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
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
