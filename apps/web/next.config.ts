import type { NextConfig } from "next";

/**
 * Electron integration strategy:
 *
 * DEV: Next.js runs as a local dev server on port 3000. Electron loads
 *      `http://localhost:3000` via `loadURL`. This gives us HMR + DevTools.
 *
 * PROD: We use `output: "export"` to generate a fully static site in `out/`.
 *       Electron loads `out/index.html` via `loadFile`. No server needed.
 *       RSC is disabled (client components only) — compatible with static export.
 *
 * The conditional below reads NEXT_BUILD_MODE from the environment so CI
 * and electron-builder can set it to "export" while `pnpm dev` skips it.
 */
const isStaticExport = process.env["NEXT_BUILD_MODE"] === "export";

const nextConfig: NextConfig = {
  ...(isStaticExport && { output: "export" }),

  // Internal monorepo packages need transpilation so Next.js can process
  // their TypeScript/ESM source instead of expecting pre-built CJS.
  transpilePackages: [
    "@supernote/ui",
    "@supernote/core",
    "@supernote/ipc",
    "@supernote/editor",
    "@supernote/canvas",
    "@supernote/search",
    "@supernote/formulas",
    "@supernote/automations",
    "@supernote/git",
    "@supernote/plugin-sdk",
  ],

  // Images must be unoptimized for static export (no server-side image optimizer).
  images: {
    unoptimized: isStaticExport,
  },

  // eslint-config-next@16 has a circular-JSON serialization bug with flat config.
  // Lint is run separately via `pnpm lint`; skip it during `next build`.
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
