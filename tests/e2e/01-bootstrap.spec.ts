import { test, expect } from "@playwright/test";
import { bootDegraded } from "./helpers";

test.describe("01 — démarrage", () => {
  test.beforeEach(async ({ page }) => {
    await bootDegraded(page);
  });

  test("l'accueil monte la surface d'écriture", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".writing-surface-root")).toBeVisible();
  });

  test("l'éditeur BlockNote est monté et éditable", async ({ page }) => {
    await page.goto("/");
    const editor = page.locator(".writing-surface-editor .ProseMirror");
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute("contenteditable", "true");
  });

  test("la coquille applicative rend sa navigation", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('a[href="/notes"]').first()).toBeVisible();
  });
});
