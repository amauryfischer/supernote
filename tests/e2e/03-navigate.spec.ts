import { test, expect } from "@playwright/test";
import { bootDegraded } from "./helpers";

// mail (compte Google requis) et routines (drapeau localStorage) sont écartées.
const ROUTES = [
  { path: "/notes", heading: "Sélectionnez une note ou créez-en une" },
  { path: "/todos", heading: "Todos" },
  { path: "/contacts", heading: "Contacts" },
  { path: "/finance", heading: "Finance" },
];

test.describe("03 — navigation", () => {
  test.beforeEach(async ({ page }) => {
    await bootDegraded(page);
  });

  for (const route of ROUTES) {
    test(`${route.path} rend son écran`, async ({ page }) => {
      await page.goto(route.path);
      await expect(
        page.getByRole("heading", { name: route.heading }).first(),
      ).toBeVisible();
    });
  }
});
