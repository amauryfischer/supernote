/**
 * Vite config for the Supernote PWA.
 *
 * Replaces the previous Next.js setup. Highlights:
 *  - React 19 plugin for JSX + Fast Refresh
 *  - Tailwind v4 via the official Vite plugin (no PostCSS step)
 *  - tsconfig path aliases (`@/*`) resolved natively
 *  - Web Worker support is built-in: `new Worker(new URL(...), {type:"module"})`
 *  - SQLite engine = `@sqlite.org/sqlite-wasm` (official build, FTS5 included,
 *    OPFS SAH pool VFS). The `.wasm` binary ships inside the npm package and
 *    is loaded by the worker through the ES module entry — no manual asset
 *    copy needed.
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
    // Prosemirror packages register classes at module load (Selection.jsonID,
    // Plugin keys, schema nodes). Loading two copies — one via BlockNote, one
    // via prosemirror-tables — triggers `RangeError: Duplicate use of
    // selection JSON ID cell`. Dedupe forces a single instance per package
    // even if multiple transitive resolvers would otherwise produce two
    // pre-bundled chunks.
    dedupe: [
      "prosemirror-state",
      "prosemirror-model",
      "prosemirror-view",
      "prosemirror-transform",
      "prosemirror-tables",
      "prosemirror-commands",
      "prosemirror-keymap",
      "prosemirror-history",
      "prosemirror-schema-list",
      "prosemirror-inputrules",
      "prosemirror-dropcursor",
      "prosemirror-gapcursor",
      "yjs",
      "y-prosemirror",
      "react",
      "react-dom",
    ],
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
      "node:events": path.resolve(SHIMS, "node-events.ts"),
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
    // Yahoo Finance's chart endpoint serves quote data without
    // `Access-Control-Allow-Origin`, which makes browser fetches from a
    // non-Yahoo origin fail. In dev we proxy `/_yahoo/*` through Vite so
    // the dev origin sees a same-origin response. The production PWA falls
    // back to `corsproxy.io` (see `lib/finance/price-fetch.ts`).
    proxy: {
      "/_yahoo": {
        target: "https://query1.finance.yahoo.com",
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/_yahoo/, ""),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        },
      },
      "/_stooq": {
        target: "https://stooq.com",
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/_stooq/, ""),
      },
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
  // top-level await for sqlite-wasm init). Vite's default is "iife" which
  // would break the `import` syntax inside it.
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
      // Pre-bundle Prosemirror as one optimizer entry so every consumer
      // (BlockNote, prosemirror-tables, custom blocks) resolves to the same
      // pre-bundled chunk. Without this, table support pulls a second copy
      // and re-registers "cell" → RangeError.
      "prosemirror-state",
      "prosemirror-model",
      "prosemirror-view",
      "prosemirror-transform",
      "prosemirror-tables",
    ],
    // sqlite-wasm ships a self-contained ES module with the .wasm binary as a
    // sibling asset. Pre-bundling rewrites the wasm URL and breaks runtime
    // loading — exclude it so Vite serves the package as-is.
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  define: {
    // Compatibility shim: some libs (and our own code) historically read
    // `process.env.NODE_ENV`. Vite exposes this via `import.meta.env.MODE`,
    // but we keep the legacy form working.
    "process.env.NODE_ENV": JSON.stringify(process.env["NODE_ENV"] ?? "development"),
  },
});
