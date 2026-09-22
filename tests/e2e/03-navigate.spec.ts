import { test, expect } from "@playwright/test";
import { bootDegraded } from "./helpers";

// mail (compte Google requis) et routines (drapeau localStorage) sont écartées.
const ROUTES = [
  { path: "/notes", heading: "Sélectionnez une note ou créez-en une" },
  { path: "/todos", heading: "Todos" },
  { path: "/contacts", heading: "Contacts" },
  { path: "/finance", heading: "Finance" },
  // Mode dégradé : pas de coffre, donc l'état vide de l'agenda.
  { path: "/agenda", heading: "Ouvre un coffre pour utiliser l'agenda" },
  { path: "/carte", heading: "Ouvre un coffre pour voir la carte" },
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
