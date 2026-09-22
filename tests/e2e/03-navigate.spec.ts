import { test, expect } from "@playwright/test";
import { bootDegraded, NAV_ROUTES } from "./helpers";

// mail (compte Google requis) et routines (drapeau localStorage) sont écartées.
test.describe("03 — navigation", () => {
  test.beforeEach(async ({ page }) => {
    await bootDegraded(page);
  });

  for (const route of NAV_ROUTES) {
    test(`${route.path} rend son écran`, async ({ page }) => {
      await page.goto(route.path);
      await expect(
        page.getByRole("heading", { name: route.heading }).first(),
      ).toBeVisible();
    });
  }
});
