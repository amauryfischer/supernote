import type { NextConfig } from "next";

const isStaticExport = process.env["NEXT_BUILD_MODE"] === "export";

const nextConfig: NextConfig = {
  ...(isStaticExport && { output: "export" }),

  // @supernote/* packages are consumed via their pre-built dist/.
  transpilePackages: [],

  images: {
    unoptimized: isStaticExport,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  // The renderer is browser-only, but several @supernote/* packages contain
  // Node-only utilities (FS, paths, git, fetch) inside their barrel. We resolve
  // the `node:*` URI imports to empty modules — the modules that actually use
  // them only run in the Electron main process, never in the renderer.
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "node:path": false,
      "node:fs": false,
      "node:fs/promises": false,
      "node:os": false,
      "node:crypto": false,
      "node:url": false,
      "node:child_process": false,
      "node:vm": false,
      "node:stream": false,
      "node:zlib": false,
      "node:util": false,
    };
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
    };
    return config;
  },
};

export default nextConfig;
