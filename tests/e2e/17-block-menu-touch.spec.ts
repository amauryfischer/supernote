import { test, expect } from "@playwright/test";
import { bootDegraded } from "./helpers";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.describe("17 — menu de bloc au toucher", () => {
  test("la poignée tactile ouvre le menu de bloc en bottom-sheet et Dupliquer ajoute un bloc", async ({ page }) => {
    await bootDegraded(page);
    await page.goto("/dev/writing-surface");
    const editor = page.locator(".writing-surface-editor .ProseMirror");
    await expect(editor).toBeVisible();

    await editor.locator(".bn-block-outer").first().tap();
    await page.keyboard.type("bloc à dupliquer");
    const blocks = editor.locator(".bn-block-outer");
    const before = await blocks.count();

    const handle = page.getByTestId("touch-block-handle");
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(32);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(32);
    await handle.tap();

    const menu = page.locator(".sn-block-menu--sheet");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "Dupliquer" }).tap();

    await expect(blocks).toHaveCount(before + 1);
    await expect(editor.getByText("bloc à dupliquer")).toHaveCount(2);
    await expect(menu).toHaveCount(0);
  });
});
