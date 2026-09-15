import { test, expect } from "@playwright/test";
import { bootDegraded } from "./helpers";

test.describe("02 — écrire une note", () => {
  test.beforeEach(async ({ page }) => {
    await bootDegraded(page);
    await page.goto("/");
    await expect(page.locator(".writing-surface-root")).toBeVisible();
  });

  test("la frappe apparaît dans l'éditeur", async ({ page }) => {
    const editor = page.locator(".writing-surface-editor .ProseMirror");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type("bonjour depuis le test e2e");
    await expect(editor).toContainText("bonjour depuis le test e2e");
  });

  test("Entrée crée un second bloc", async ({ page }) => {
    const editor = page.locator(".writing-surface-editor .ProseMirror");
    await editor.click();
    await page.keyboard.type("premier bloc");
    await page.keyboard.press("Enter");
    await page.keyboard.type("second bloc");
    await expect(editor).toContainText("premier bloc");
    await expect(editor).toContainText("second bloc");
    expect(await editor.locator("[data-id]").count()).toBeGreaterThan(1);
  });
});
