import { test, expect } from "@playwright/test";
import { bootDegraded, openNewNote } from "./helpers";

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

  test("l'appui long sur une sélection laisse le menu natif Copier, sans ouvrir le menu IA", async ({ page }) => {
    await openNewNote(page, "Sélection au doigt");
    const editor = page.locator(".bn-editor");
    await editor.locator(".bn-block-outer").first().tap();
    await page.keyboard.type("texte à copier au doigt");

    await editor.evaluate((pm) => {
      const text = pm.querySelector("p")?.firstChild;
      if (!text) return;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 5);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    });
    // ProseMirror lit la sélection DOM au selectionchange suivant, pas de façon synchrone.
    await page.waitForTimeout(300);
    // Chromium émulé ne produit pas le contextmenu d'un appui long : on émet celui qu'Android envoie au relâcher.
    const result = await editor.evaluate((pm) => {
      const p = pm.querySelector("p");
      const box = getSelection()?.getRangeAt(0).getBoundingClientRect();
      if (!p || !box) return null;
      const ev = new PointerEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + 2, clientY: box.top + 2, pointerType: "touch" });
      p.dispatchEvent(ev);
      return { defaultPrevented: ev.defaultPrevented };
    });
    await page.waitForTimeout(300);

    expect(result).toEqual({ defaultPrevented: false });
    await expect(page.getByPlaceholder("Filtrer…")).toHaveCount(0);
    expect(await page.evaluate(() => getSelection()?.toString())).toBe("texte");
  });
});
