import { test, expect } from "@playwright/test";
import { withInbox } from "./helpers";

test.describe("06 — mail", () => {
  test("composeur plein écran, erreur inline sans destinataire", async ({ page }) => {
    await withInbox(page);
    await page.goto("/mail");
    await expect(page.getByText("Compte rendu réunion").first()).toBeVisible({ timeout: 20_000 });

    await page.keyboard.press("c");
    const dialog = page.getByRole("dialog", { name: "Nouveau message" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box?.width).toBe(viewport?.width);
    expect(box?.height).toBe(viewport?.height);

    await page.getByLabel("Objet").fill("Point");
    await page.getByRole("button", { name: "Envoyer", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("destinataire");
    await expect(page.getByLabel("À", { exact: true })).toBeFocused();
    if (process.env["SHOTS"]) await page.screenshot({ path: `${process.env["SHOTS"]}/compose-alert.png` });
  });

  test("le message se copie depuis sa bulle", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await withInbox(page);
    await page.goto("/mail");
    await page.getByText("Compte rendu réunion").first().click();
    await page.getByRole("button", { name: "Copier le message" }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("Voici le compte rendu");
  });

  test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("le FAB ouvre le composeur, sans débordement horizontal", async ({ page }) => {
      await withInbox(page);
      await page.goto("/mail");
      await page.getByRole("button", { name: "Nouveau message" }).last().click();
      await expect(page.getByRole("dialog", { name: "Nouveau message" })).toBeVisible();
      await page.getByLabel("À", { exact: true }).fill("bob@exemple.fr");
      await page.keyboard.press("Enter");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      if (process.env["SHOTS"]) await page.screenshot({ path: `${process.env["SHOTS"]}/compose-mobile.png` });
    });

    test("le retour système ferme le fil au lieu de quitter /mail", async ({ page }) => {
      await withInbox(page);
      await page.goto("/notes");
      await page.goto("/mail");
      const copy = page.getByRole("button", { name: "Copier le message" });

      await page.getByText("Compte rendu réunion").first().click();
      await expect(copy).toBeVisible();
      await page.goBack();
      await expect(copy).toBeHidden();
      await expect(page).toHaveURL(/\/mail$/);

      await page.getByText("Compte rendu réunion").first().click();
      await expect(copy).toBeVisible();
      await page.getByRole("button", { name: "Retour" }).click();
      await expect(copy).toBeHidden();
      // La flèche du haut retire l'entrée : le retour suivant quitte bien /mail.
      await page.goBack();
      await expect(page).toHaveURL(/\/notes/);
    });
  });
});
