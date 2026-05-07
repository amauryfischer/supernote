import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
// webpack is bundled as a peer of next; its types aren't typed externally,
// so we require it dynamically to avoid type resolution errors at build time.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpack = require("next/dist/compiled/webpack/webpack.js").webpack ?? require("webpack");

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

  // @supernote/ui is transpiled so Next.js can enforce RSC boundaries correctly
  // when used with next-intl's withNextIntl wrapper.
  transpilePackages: ["@supernote/ui"],

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
  webpack: (config) => {
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

    return config;
  },
};

export default withNextIntl(nextConfig);
