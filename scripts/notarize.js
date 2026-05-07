/**
 * scripts/notarize.js
 *
 * Post-sign notarization script for macOS builds.
 * Called by electron-builder via `afterSign` in electron-builder.yml.
 *
 * Prerequisites:
 *   - @electron/notarize installed: pnpm add -D @electron/notarize
 *   - GitHub Secrets configured:
 *       APPLE_ID                  — your Apple ID email
 *       APPLE_APP_SPECIFIC_PASSWORD — app-specific password (appleid.apple.com)
 *       APPLE_TEAM_ID             — 10-char Team ID (developer.apple.com → Membership)
 *
 * Enable in electron-builder.yml (mac section):
 *   notarize: false   → change to true  (or remove; afterSign handles it)
 *   afterSign: scripts/notarize.js
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { notarize } = require("@electron/notarize");

/**
 * @param {import("electron-builder").AfterSignContext} context
 */
exports.default = async function notarizeApp(context) {
  const { electronPlatformName, appOutDir } = context;

  // Only notarize on macOS.
  if (electronPlatformName !== "darwin") {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appleId = process.env["APPLE_ID"];
  const appleIdPassword = process.env["APPLE_APP_SPECIFIC_PASSWORD"];
  const teamId = process.env["APPLE_TEAM_ID"];

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn(
      "[notarize] Skipping: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, or APPLE_TEAM_ID not set.",
    );
    return;
  }

  const appPath = `${appOutDir}/${appName}.app`;
  console.log(`[notarize] Notarizing ${appPath} …`);

  try {
    await notarize({
      appPath,
      appleId,
      appleIdPassword,
      teamId,
    });
    console.log(`[notarize] Done: ${appPath}`);
  } catch (err) {
    // Do not hard-fail the build — log and continue so unsigned builds still work.
    console.error("[notarize] Notarization failed (non-fatal):", err);
  }
};
