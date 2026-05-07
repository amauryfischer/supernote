#!/usr/bin/env node
/**
 * resolve-standalone.mjs
 *
 * Copies apps/web/.next/standalone → apps/web/.next/standalone-resolved
 * dereferencing pnpm symlinks in the process.
 *
 * pnpm creates symlinks inside node_modules/.pnpm that electron-builder's
 * "**\/*" glob pattern does not follow. We use fs.cpSync (Node 22) with
 * { dereference: true } to create a fully resolved copy that electron-builder
 * can package directly.
 *
 * This is the Node.js equivalent of: rsync -aL standalone/ standalone-resolved/
 */

import { cpSync, rmSync, existsSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SRC = resolve(__dirname, "../apps/web/.next/standalone");
const DST = resolve(__dirname, "../apps/web/.next/standalone-resolved");

if (!existsSync(SRC)) {
  console.error(`[resolve-standalone] ERROR: source not found: ${SRC}`);
  console.error("  Run NEXT_BUILD_MODE=production pnpm build:web first.");
  process.exit(1);
}

console.log("[resolve-standalone] Removing old standalone-resolved...");
if (existsSync(DST)) {
  rmSync(DST, { recursive: true, force: true });
}

console.log("[resolve-standalone] Copying standalone with dereferenced symlinks...");
cpSync(SRC, DST, {
  recursive: true,
  dereference: true,    // follow symlinks — resolves pnpm virtual store links
  verbatimSymlinks: false,
});

console.log(`[resolve-standalone] Done: ${DST}`);
