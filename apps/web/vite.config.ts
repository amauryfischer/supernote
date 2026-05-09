/**
 * Vite config for the Supernote PWA.
 *
 * Replaces the previous Next.js setup. Highlights:
 *  - React 19 plugin for JSX + Fast Refresh
 *  - Tailwind v4 via the official Vite plugin (no PostCSS step)
 *  - tsconfig path aliases (`@/*`) resolved natively
 *  - Web Worker support is built-in: `new Worker(new URL(...), {type:"module"})`
 *  - sql.js WASM is served from `public/wasm/sql-wasm.wasm` — Vite copies the
 *    entire `public/` folder to the dist root verbatim, so paths stay stable.
 *  - `next/*` and `next-intl` are aliased to in-repo shims so the existing
 *    `app/**` page files compile unchanged.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHIMS = path.resolve(__dirname, "src/lib/next-shims");

export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      strategies: "injectManifest",
      srcDir: "public",
      filename: "sw.js",
      manifest: false,
      injectManifest: {
        // Precache every hashed bundle, font, image and wasm produced by the
        // build. The hand-written SW reads `self.__WB_MANIFEST` and adds the
        // listed URLs to its install-time cache, so the PWA boots fully
        // offline on first launch — no warm-up navigation required.
        globPatterns: ["**/*.{js,css,html,png,svg,ico,webp,woff2,wasm,json}"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      // ── Node built-ins → no-op browser shims ─────────────────────────────
      // The previous Next.js webpack config provided `false` fallbacks for
      // these because some `@supernote/*` packages (their pre-built dist/)
      // import `node:fs`, `node:path`, etc. through their barrel. Those
      // code paths only execute in Electron's main process — the renderer
      // never calls them. We map every `node:*` specifier to a tiny module
      // that exports `Proxy`-backed no-ops so Rollup doesn't choke at
      // bundle time.
      "node:path": path.resolve(SHIMS, "node-builtins.ts"),
      "node:fs": path.resolve(SHIMS, "node-builtins.ts"),
      "node:fs/promises": path.resolve(SHIMS, "node-builtins.ts"),
      "node:os": path.resolve(SHIMS, "node-builtins.ts"),
      "node:crypto": path.resolve(SHIMS, "node-builtins.ts"),
      "node:url": path.resolve(SHIMS, "node-builtins.ts"),
      "node:child_process": path.resolve(SHIMS, "node-builtins.ts"),
      "node:vm": path.resolve(SHIMS, "node-builtins.ts"),
      "node:stream": path.resolve(SHIMS, "node-builtins.ts"),
      "node:zlib": path.resolve(SHIMS, "node-builtins.ts"),
      "node:util": path.resolve(SHIMS, "node-builtins.ts"),
      "node:buffer": path.resolve(SHIMS, "node-builtins.ts"),
      "node:assert": path.resolve(SHIMS, "node-builtins.ts"),
      "node:events": path.resolve(SHIMS, "node-builtins.ts"),
      "node:net": path.resolve(SHIMS, "node-builtins.ts"),
      "node:tls": path.resolve(SHIMS, "node-builtins.ts"),
      "node:http": path.resolve(SHIMS, "node-builtins.ts"),
      "node:https": path.resolve(SHIMS, "node-builtins.ts"),
      "node:dns": path.resolve(SHIMS, "node-builtins.ts"),
      "@": path.resolve(__dirname, "src"),
      // ── Next.js shim layer ─────────────────────────────────────────────
      // The ~45 page files under `app/**` and the components under
      // `components/**` import from `next/navigation`, `next/link`,
      // `next/dynamic`, `next/image`, and `next-intl`. Aliasing each to a
      // local shim that maps the API onto react-router-dom (or a tiny
      // i18n context) lets us migrate without touching every file.
      "next/link": path.resolve(SHIMS, "link.tsx"),
      "next/navigation": path.resolve(SHIMS, "navigation.ts"),
      "next/dynamic": path.resolve(SHIMS, "dynamic.tsx"),
      "next/image": path.resolve(SHIMS, "image.tsx"),
      "next-intl": path.resolve(SHIMS, "intl.tsx"),
    },
  },
  server: {
    port: 3100,
    host: true,
    strictPort: false,
    fs: {
      // Workspaces — allow reading sibling packages.
      allow: [path.resolve(__dirname, "../../")],
    },
  },
  preview: {
    port: 3100,
  },
  build: {
    target: "esnext",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split heavy libs so the shell paint doesn't drag them in.
          react: ["react", "react-dom", "react-router-dom"],
          "react-query": ["@tanstack/react-query"],
          recharts: ["recharts"],
          xyflow: ["@xyflow/react"],
          phosphor: ["@phosphor-icons/react"],
        },
      },
    },
  },
  // The vault Web Worker must build as ESM (it uses dynamic imports +
  // top-level await for sql.js init). Vite's default is "iife" which would
  // break the `import` syntax inside it.
  worker: {
    format: "es",
  },
  optimizeDeps: {
    // Pre-bundle the heaviest deps so cold dev start stays snappy.
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react-router-dom",
      "@tanstack/react-query",
      "@trpc/client",
      "@trpc/react-query",
      // sql.js is UMD/CJS — must go through esbuild's interop so the worker's
      // `import initSqlJs from "sql.js"` resolves to a proper ES default export.
      // Without pre-bundling, Vite serves the raw UMD file and the worker
      // throws: "does not provide an export named 'default'".
      "sql.js",
    ],
  },
  define: {
    // Compatibility shim: some libs (and our own code) historically read
    // `process.env.NODE_ENV`. Vite exposes this via `import.meta.env.MODE`,
    // but we keep the legacy form working.
    "process.env.NODE_ENV": JSON.stringify(process.env["NODE_ENV"] ?? "development"),
  },
});
