import { test, expect, type Page } from "@playwright/test";
import { bootCloud, seedNote } from "./helpers";

const focusedText = (page: Page) => page.evaluate(() => document.activeElement?.textContent ?? null);
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

test.describe("25 — navigation clavier", () => {
  test.beforeEach(async ({ page }) => {
    await bootCloud(page);
    await page.addInitScript(() => {
      for (const k of ["crumb", "longtasks", "errors"]) localStorage.removeItem(`sn:freeze:${k}`);
    });
    await page.goto("/notes");
    await seedNote(page, { title: "Alpha kb", body: "# Alpha\n\ntexte" });
    await seedNote(page, { title: "Beta kb", body: "# Beta\n\ntexte" });
    await page.goto("/notes?folder=Inbox");
    await expect(page.locator("[data-kb-item]").first()).toBeVisible({ timeout: 60_000 });
    await blur(page);
  });

  test("j/k parcourent la liste, Entrée ouvre la note", async ({ page }) => {
    await page.keyboard.press("j");
    const t1 = await focusedText(page);
    expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-kb-item"))).toBe(true);
    await page.keyboard.press("j");
    expect(await focusedText(page)).not.toBe(t1);
    await page.keyboard.press("k");
    expect(await focusedText(page)).toBe(t1);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/notes\/[^?]+/);
  });

  test("g puis lettre change de section, avec repère", async ({ page }) => {
    await page.keyboard.press("g");
    await expect(page.getByText("g …")).toBeVisible();
    await page.keyboard.press("d");
    await expect(page).toHaveURL(/\/todos/);
    await blur(page);
    await page.keyboard.press("g");
    await page.keyboard.press("a");
    await expect(page).toHaveURL(/\/agenda/);
  });

  test("Ctrl+/ liste les raccourcis enregistrés", async ({ page }) => {
    await page.keyboard.press("Control+/");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Aller à : Mail").first()).toBeVisible();
    await expect(dialog.getByText("Ligne suivante")).toBeVisible();
    // La garde de saisie : j tapé dans la recherche de l'aide reste du texte.
    await page.keyboard.type("ligne");
    await expect(dialog.getByText("Aller à : Mail")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("; pose des lettres et la lettre active le bouton", async ({ page }) => {
    await page.keyboard.press(";");
    const hints = page.getByRole("dialog", { name: "Lettres d'accès clavier" });
    await expect(hints.locator("kbd").first()).toBeVisible();
    const label = await page.evaluate(() => {
      const row = [...document.querySelectorAll<HTMLElement>("[data-kb-item]")].find((el) => el.textContent?.includes("Alpha kb"));
      const r = row?.getBoundingClientRect();
      const kbd = [...document.querySelectorAll<HTMLElement>("[aria-label=\"Lettres d'accès clavier\"] kbd")].find(
        (k) => r && Math.abs(k.getBoundingClientRect().top - Math.max(0, r.top)) < 2 && Math.abs(k.getBoundingClientRect().left - Math.max(0, r.left)) < 2,
      );
      return kbd?.textContent?.toLowerCase() ?? null;
    });
    expect(label).toBeTruthy();
    await page.keyboard.type(label ?? "");
    await expect(hints).toHaveCount(0);
    await expect(page).toHaveURL(/\/notes\/[^?]+/);

    await page.keyboard.press(";");
    await expect(hints).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(hints).toHaveCount(0);
  });
});
