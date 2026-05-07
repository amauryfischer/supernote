import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
// webpack is bundled as a peer of next; its types aren't typed externally,
// so we require it dynamically to avoid type resolution errors at build time.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpack = require("next/dist/compiled/webpack/webpack.js").webpack ?? require("webpack");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path") as typeof import("path");

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isStaticExport = process.env["NEXT_BUILD_MODE"] === "export";
const isStandalone = process.env["NEXT_BUILD_MODE"] === "production";

const nextConfig: NextConfig = {
  ...(isStaticExport && { output: "export" }),
  ...(isStandalone && { output: "standalone" }),

  // Disable React Strict Mode to eliminate double-render in dev.
  // Double-renders are intentional in StrictMode to catch side-effects,
  // but they inflate perceived latency noticeably in dev.
  reactStrictMode: false,

  // @supernote/* packages are consumed via their pre-built dist/.
  transpilePackages: [],

  experimental: {
    // Tree-shake icon libraries and recharts so only used exports are bundled.
    optimizePackageImports: ["@phosphor-icons/react", "lucide-react", "recharts"],
  },

  images: {
    unoptimized: isStaticExport || isStandalone,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  // Many packages are workspace-linked with subpath exports that TS bundler
  // resolution doesn't always pick up at build-time. The runtime resolution
  // works fine. We skip type-checking during build (pnpm typecheck remains).
  typescript: {
    ignoreBuildErrors: true,
  },


  // The renderer is browser-only, but several @supernote/* packages contain
  // Node-only utilities (FS, paths, git, fetch) inside their barrel. We strip
  // the `node:` URI scheme and provide empty fallbacks — these modules only
  // execute in the Electron main process, never in the renderer.
  webpack: (config, { nextRuntime }) => {
    config.resolve = config.resolve ?? {};
    config.resolve.fallback = {
      ...(config.resolve.fallback ?? {}),
      path: false,
      fs: false,
      "fs/promises": false,
      os: false,
      crypto: false,
      url: false,
      child_process: false,
      vm: false,
      stream: false,
      zlib: false,
      util: false,
      buffer: false,
      assert: false,
      events: false,
      net: false,
      tls: false,
      http: false,
      https: false,
      dns: false,
    };

    config.plugins = config.plugins ?? [];
    // Rewrite `node:foo` → `foo` so the fallback above can resolve them to empty.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
        resource.request = resource.request.replace(/^node:/, "");
      }),
    );

    // Copy sql.js WASM to public/wasm/ so the worker can locate it at /wasm/sql-wasm.wasm.
    // CopyPlugin is bundled with webpack, available via next's internal webpack.
    // We use a simple approach: emit the WASM as a file asset.
    try {
      const sqlJsWasmPath = path.resolve(
        __dirname,
        "node_modules/sql.js/dist/sql-wasm.wasm",
      );
      const CopyPlugin = require("copy-webpack-plugin");
      config.plugins.push(
        new CopyPlugin({
          patterns: [
            {
              from: sqlJsWasmPath,
              to: path.resolve(__dirname, "public/wasm/sql-wasm.wasm"),
            },
          ],
        }),
      );
    } catch {
      // copy-webpack-plugin not available — WASM must be copied manually
    }

    // In the RSC / Node.js server layer, `client-only` resolves to its
    // `react-server` export condition which throws. Pre-built @supernote/*
    // and @heroui/* dist files import it without "use client" directives.
    // We redirect both the compiled-in Next.js copy and the bare specifier
    // to a no-op shim — only for the RSC compilation, not the client bundle.
    if (nextRuntime === "nodejs") {
      const shimPath = path.resolve(__dirname, "src/client-only-shim.js");
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /[\\/]client-only[\\/](error\.js|index\.js)$|^client-only$/,
          shimPath,
        ),
      );
    }

    return config;
  },
};

// Apply next-intl plugin for i18n routing support.
// In standalone (production installer) mode, skip the plugin to avoid RSC boundary
// conflicts: @supernote/* workspace packages lack "use client" directives in their
// pre-built dist, causing createContext errors during Next.js page data collection.
// i18n still works at runtime via the LocaleProvider client component.
export default isStandalone ? nextConfig : withNextIntl(nextConfig);
