import { defineConfig, externalizeDepsPlugin } from "electron-vite";

/**
 * electron-vite configuration for @supernote/desktop.
 *
 * Bundler choice: electron-vite (wraps Vite, gives separate build pipelines
 * for main process, preload script, and optionally renderer). We intentionally
 * omit the renderer config because Next.js manages its own build/dev server.
 *
 * Dev mode  → loads http://localhost:3000 (Next.js dev server in apps/web)
 * Prod mode → loads apps/web/out/index.html (Next.js static export)
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: {
          index: "src/main/index.ts",
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        input: {
          index: "src/preload/index.ts",
        },
      },
    },
  },
});
