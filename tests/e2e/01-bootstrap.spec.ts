import { test, expect } from "@playwright/test";
import { bootDegraded } from "./helpers";

test.describe("01 — démarrage", () => {
  test.beforeEach(async ({ page }) => {
    await bootDegraded(page);
  });

  test("le banc éditeur monte la surface d'écriture", async ({ page }) => {
    await page.goto("/dev/writing-surface");
    await expect(page.locator(".writing-surface-root")).toBeVisible();
  });

  test("l'éditeur BlockNote est monté et éditable", async ({ page }) => {
    await page.goto("/dev/writing-surface");
    const editor = page.locator(".writing-surface-editor .ProseMirror");
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute("contenteditable", "true");
  });

  test("la coquille applicative rend sa navigation", async ({ page }) => {
    await page.goto("/dev/writing-surface");
    await expect(page.getByRole("navigation").getByRole("button", { name: "Notes" }).first()).toBeVisible();
  });
});
