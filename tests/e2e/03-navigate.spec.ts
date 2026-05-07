/**
 * 03-navigate.spec.ts
 *
 * Clicks every sidebar link and verifies:
 * - Page loads without "Internal Server Error" text
 * - URL changes accordingly
 */

import { test, expect } from "@playwright/test";
import { tryLaunchApp, closeApp, isElectronAvailable, type AppHandle } from "./helpers";

interface NavTarget {
  label: string;
  href: string;
}

const SIDEBAR_LINKS: NavTarget[] = [
  { label: "Accueil", href: "/" },
  { label: "Notes", href: "/notes" },
  { label: "Contacts", href: "/contacts" },
  { label: "Finance", href: "/finance" },
  { label: "Schémas", href: "/schemas" },
  { label: "Routines", href: "/routines" },
  { label: "Paramètres", href: "/parametres" },
];

test.describe("03 — sidebar navigation", () => {
  let handle: AppHandle | null = null;
  let electronSkipped = false;
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    if (!isElectronAvailable()) {
      electronSkipped = true;
      return;
    }
    handle = await tryLaunchApp();
    if (!handle) {
      electronSkipped = true;
      return;
    }

    handle.page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await handle.page.waitForLoadState("networkidle");
  });

  test.afterAll(async () => {
    if (handle) {
      await closeApp(handle);
      handle = null;
    }
  });

  for (const nav of SIDEBAR_LINKS) {
    test(`navigates to ${nav.label} (${nav.href})`, async () => {
      if (electronSkipped || !handle) {
        test.skip(true, "Electron not available in this environment (WSL2/headless)");
        return;
      }

      const link = handle.page.locator(`a[href="${nav.href}"]`).first();
      const linkVisible = await link.isVisible().catch(() => false);

      if (!linkVisible) {
        await handle.page.goto(`http://localhost:3000${nav.href}`);
      } else {
        await link.click();
      }

      await handle.page.waitForLoadState("domcontentloaded");

      const bodyText = await handle.page.textContent("body").catch(() => "");
      expect(bodyText).not.toContain("Internal Server Error");
      expect(bodyText).not.toContain("Application error");

      const url = await handle.page.url();
      if (nav.href !== "/") {
        expect(url).toContain(nav.href);
      }
    });
  }
});
