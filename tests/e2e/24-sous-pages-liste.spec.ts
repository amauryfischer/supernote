import { test, expect, type Page } from "@playwright/test";
import { bootCloud, seedNote, workerCall } from "./helpers";

test.describe.configure({ timeout: 180_000 });

/** Ligne de la liste des notes (pas de l'arbre : ses lignes n'ont pas `sn-pressable`). */
const listRow = (page: Page, title: string) => page.locator("button.sn-pressable", { hasText: title }).first();

/**
 * Coffre cloud neuf, dossier « Wiki » : une page « Wiki » avec une sous-page « Domaine RH »,
 * un cycle A → B → A, et une sous-page dont la parente est archivée. Ouvre la liste de Wiki.
 */
async function seedWiki(page: Page): Promise<void> {
  await bootCloud(page);
  await page.addInitScript(() => {
    for (const k of ["crumb", "longtasks", "errors"]) localStorage.removeItem(`sn:freeze:${k}`);
  });
  await page.goto("/notes");
  const p = await seedNote(page, { title: "Wiki", body: "", folder: "Wiki" });
  await seedNote(page, { title: "Domaine RH", body: "", folder: "Wiki", fields: { parentId: p } });
  const a = await seedNote(page, { title: "Cycle A", body: "", folder: "Wiki" });
  const b = await seedNote(page, { title: "Cycle B", body: "", folder: "Wiki", fields: { parentId: a } });
  await workerCall(page, "mutation", "entities.update", { id: a, fields: { parentId: b } });
  const archivee = await seedNote(page, { title: "Parente archivee", body: "", folder: "Wiki", fields: { archivedAt: new Date().toISOString() } });
  await seedNote(page, { title: "Orpheline", body: "", folder: "Wiki", fields: { parentId: archivee } });
  await page.goto("/notes?folder=Wiki");
  await expect(listRow(page, "Domaine RH")).toBeVisible({ timeout: 60_000 });
}

async function expectMentions(page: Page): Promise<void> {
  await expect(listRow(page, "Domaine RH").getByText("dans Wiki")).toBeVisible();
  for (const title of ["Cycle A", "Cycle B", "Orpheline"]) {
    await expect(listRow(page, title)).toBeVisible();
    await expect(listRow(page, title).getByText(/^dans /)).toHaveCount(0);
  }
}

test.describe("24 — sous-pages : liste (desktop)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("la sous-page porte « dans <parent> » ; cycle et parente archivée n'en portent pas", async ({ page }) => {
    await seedWiki(page);
    await expectMentions(page);
  });
});

test.describe("24 — sous-pages : liste (mobile)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("la mention « dans <parent> » ne crée pas de débordement horizontal", async ({ page }) => {
    await seedWiki(page);
    await expectMentions(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
