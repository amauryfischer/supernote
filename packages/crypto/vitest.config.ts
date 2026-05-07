import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Keep libsodium and age-encryption as externals — vitest uses Node's
    // native module resolver in test environment which picks up the CJS build
    // from package.json "main" field instead of "exports.import".
    server: {
      deps: {
        external: ["libsodium-wrappers-sumo", "age-encryption"],
      },
    },
  },
});
