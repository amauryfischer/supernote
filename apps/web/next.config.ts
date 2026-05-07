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

  // All @supernote/* internal packages are consumed via their pre-built dist/
  // (run `pnpm -r --filter './packages/**' build` to refresh). They use ESM
  // NodeNext-style imports with explicit `.js` extensions in source, which
  // Next.js' transpilePackages can't resolve from src/.
  transpilePackages: [],

  images: {
    unoptimized: isStaticExport,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
