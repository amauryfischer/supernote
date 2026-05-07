import type { NextConfig } from "next";
import webpack from "webpack";

const isStaticExport = process.env["NEXT_BUILD_MODE"] === "export";

const nextConfig: NextConfig = {
  ...(isStaticExport && { output: "export" }),

  // Disable React Strict Mode to eliminate double-render in dev.
  // Double-renders are intentional in StrictMode to catch side-effects,
  // but they inflate perceived latency noticeably in dev.
  reactStrictMode: false,

  // @supernote/* packages are consumed via their pre-built dist/.
  transpilePackages: [],

  images: {
    unoptimized: isStaticExport,
  },

  eslint: {
    ignoreDuringBuilds: true,
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
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, "");
      }),
    );

    return config;
  },
};

export default nextConfig;
