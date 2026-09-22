import { test, expect, type Page } from "@playwright/test";
import { bootCloud } from "./helpers";

const list = (page: Page) => page.locator("aside nav.flex-1");

test.describe("05 — modèles", () => {
  // Deux rechargements, donc deux démarrages complets du worker.
  test.setTimeout(120_000);

  test("persistés dans le coffre, sans doublon ni résurrection", async ({ page }) => {
    await bootCloud(page);
    await page.goto("/templates");
    await expect(list(page).getByRole("button", { name: /Compte-rendu de réunion/ })).toBeVisible({ timeout: 45_000 });

    await page.getByRole("button", { name: "Nouveau template" }).first().click();
    const name = page.getByLabel("Nom du template");
    await expect(name).toHaveValue("Nouveau modèle", { timeout: 20_000 });
    await name.fill("Mon modèle test");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Modèle enregistré")).toBeVisible({ timeout: 20_000 });

    // Quitter un modèle modifié demande confirmation.
    await page.getByLabel("Corps du template").fill("# Changé");
    await list(page).getByRole("button", { name: /Recette/ }).click();
    await expect(page.getByText("Modifications non enregistrées")).toBeVisible();
    await page.getByRole("button", { name: "Abandonner" }).click();
    await expect(name).toHaveValue("Recette");

    const recette = list(page).locator("div.group").filter({ has: page.getByRole("button", { name: /Recette/ }) });
    await recette.hover();
    await recette.getByRole("button", { name: "Supprimer le template" }).click({ force: true });
    await page.getByRole("button", { name: "Supprimer", exact: true }).click();
    await expect(list(page).getByRole("button", { name: /Recette/ })).toHaveCount(0, { timeout: 20_000 });

    for (let i = 0; i < 2; i++) {
      await page.reload();
      await expect(list(page).getByRole("button", { name: /Mon modèle test/ })).toBeVisible({ timeout: 45_000 });
      await expect(list(page).getByRole("button", { name: /Compte-rendu de réunion/ })).toHaveCount(1);
      await expect(list(page).getByRole("button", { name: /Recette/ })).toHaveCount(0);
    }
  });

  test("la barre du haut ouvre le choix du modèle", async ({ page }) => {
    await bootCloud(page);
    await page.goto("/notes");
    await page.getByRole("button", { name: "Nouvelle note depuis un modèle" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: /Compte-rendu de réunion/ })).toBeVisible({ timeout: 45_000 });
  });
});
