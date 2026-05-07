#!/usr/bin/env node
/**
 * patch-ui-dist.mjs
 *
 * Prepends "use client" to @supernote/* dist JS files that use client-side
 * React APIs (hooks, context, event handlers) but lack the directive.
 *
 * This is needed for Next.js standalone builds where the RSC compiler would
 * otherwise flag them as invalid server imports via the `client-only` guard.
 *
 * Run before `pnpm build:web` in production/standalone mode.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PACKAGES_ROOT = resolve(__dirname, "../packages");
const DIRECTIVE = '"use client";\n';

// Packages that expose renderer-side React code without "use client" in dist.
// These are pre-built ESM packages consumed by the Next.js web app.
const TARGET_PACKAGES = ["ui", "canvas", "editor", "notifications", "views"];

function alreadyHasDirective(content) {
  return content.trimStart().startsWith('"use client"') ||
    content.trimStart().startsWith("'use client'");
}

function patchFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  if (alreadyHasDirective(content)) return false;
  writeFileSync(filePath, DIRECTIVE + content, "utf8");
  return true;
}

function walk(dir) {
  const patched = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      patched.push(...walk(full));
    } else if (entry.endsWith(".js") && !entry.endsWith(".js.map")) {
      if (patchFile(full)) patched.push(full);
    }
  }
  return patched;
}

let total = 0;
for (const pkg of TARGET_PACKAGES) {
  const distDir = join(PACKAGES_ROOT, pkg, "dist");
  try {
    const patched = walk(distDir);
    if (patched.length > 0) {
      console.log(`[patch-ui-dist] ${pkg}: patched ${patched.length} files`);
    }
    total += patched.length;
  } catch (err) {
    console.warn(`[patch-ui-dist] Skipping ${pkg}: ${err.message}`);
  }
}
console.log(`[patch-ui-dist] Done — ${total} files total patched with "use client"`);
