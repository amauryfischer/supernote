import { defineConfig } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: "./tests/e2e",
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],

  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },

  projects: [
    {
      name: "electron",
      testMatch: "**/*.spec.ts",
    },
  ],

  // Global setup/teardown
  globalSetup: "./tests/e2e/setup.ts",

  outputDir: path.join(__dirname, "tests/e2e/results"),
});
