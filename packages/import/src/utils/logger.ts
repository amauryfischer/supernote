import pino from "pino";

export const logger = pino({
  name: "@supernote/import",
  level: process.env["LOG_LEVEL"] ?? "info",
});
