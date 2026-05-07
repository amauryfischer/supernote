import { app } from "electron";
import path from "path";

/**
 * Path to the SQLite database file stored in Electron's userData directory.
 * This location persists across app updates and is OS-appropriate.
 */
export function getDbPath(): string {
  return path.join(app.getPath("userData"), "index.db");
}

/**
 * Path to the logs directory inside userData.
 */
export function getLogsDir(): string {
  return path.join(app.getPath("userData"), "logs");
}
