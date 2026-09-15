import { test, expect } from "@playwright/test";
import { bootDegraded } from "./helpers";

// mail, journal et routines sont écartées : leur `gate` (lib/navigation/catalog.ts)
// dépend d'un drapeau localStorage ou d'un compte Google connecté.
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
