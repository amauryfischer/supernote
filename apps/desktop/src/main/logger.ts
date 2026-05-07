/**
 * Structured logger for the Electron main process.
 * Writes line-delimited JSON to userData/logs/main.log.
 *
 * Intentionally avoids pino as a separate dependency — uses Node.js
 * fs.WriteStream directly to keep the main process bundle minimal.
 */

import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogRecord {
  time: string;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

function getLogsDir(): string {
  return path.join(app.getPath("userData"), "logs");
}

function createStream(): fs.WriteStream {
  const dir = getLogsDir();
  fs.mkdirSync(dir, { recursive: true });
  return fs.createWriteStream(path.join(dir, "main.log"), { flags: "a" });
}

let stream: fs.WriteStream | null = null;

function getStream(): fs.WriteStream {
  if (!stream) stream = createStream();
  return stream;
}

const MIN_LEVEL: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel: number =
  process.env["NODE_ENV"] === "development" ? MIN_LEVEL.debug : MIN_LEVEL.info;

function write(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  if (MIN_LEVEL[level] < currentLevel) return;
  const record: LogRecord = {
    time: new Date().toISOString(),
    level,
    msg,
    ...extra,
  };
  try {
    getStream().write(JSON.stringify(record) + "\n");
  } catch {
    console.error("[logger]", JSON.stringify(record));
  }
}

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) => write("debug", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => write("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => write("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => write("error", msg, extra),
  child: (context: Record<string, unknown>) => ({
    debug: (msg: string, extra?: Record<string, unknown>) =>
      write("debug", msg, { ...context, ...extra }),
    info: (msg: string, extra?: Record<string, unknown>) =>
      write("info", msg, { ...context, ...extra }),
    warn: (msg: string, extra?: Record<string, unknown>) =>
      write("warn", msg, { ...context, ...extra }),
    error: (msg: string, extra?: Record<string, unknown>) =>
      write("error", msg, { ...context, ...extra }),
  }),
};

export type Logger = typeof logger;
