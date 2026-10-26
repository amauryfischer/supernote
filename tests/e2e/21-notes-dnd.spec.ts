import { test, expect, type Locator, type Page } from "@playwright/test";
import { bootCloud, seedNote, workerCall } from "./helpers";

// Coffre OPFS + routes lazy : le premier chargement est long sur un Vite froid.
test.describe.configure({ timeout: 180_000 });

interface Seeded {
  alpha: string;
  beta: string;
  zeta: string;
}

/**
 * Coffre cloud neuf : trois notes dans Inbox (Zeta est la plus ancienne, donc la dernière de la liste triée par
 * date) et un dossier « Cible » qui n'existe que par sa note « Graine ». Ouvre la liste d'Inbox.
 */
async function seedVault(page: Page): Promise<Seeded> {
  await bootCloud(page);
  await page.addInitScript(() => {
    for (const k of ["crumb", "longtasks", "errors"]) localStorage.removeItem(`sn:freeze:${k}`);
  });
  await page.goto("/notes");
  const zeta = await seedNote(page, { title: "Zeta dnd", body: "dernière" });
  const alpha = await seedNote(page, { title: "Alpha dnd", body: "à déplacer" });
  const beta = await seedNote(page, { title: "Beta dnd", body: "à dupliquer" });
  await seedNote(page, { title: "Graine", body: "crée le dossier", folder: "Cible" });
  await page.goto("/notes?folder=Inbox");
  await expect(listRow(page, "Alpha dnd")).toBeVisible({ timeout: 60_000 });
  return { alpha, beta, zeta };
}

/** Ligne de la liste des notes (pas de l'arbre : ses lignes n'ont pas `sn-pressable`). */
const listRow = (page: Page, title: string): Locator => page.locator("button.sn-pressable", { hasText: title }).first();

const filePathOf = async (page: Page, id: string) =>
  (await workerCall<{ filePath: string }>(page, "query", "entities.get", { id })).filePath;

/** Titres de la liste dans l'ordre d'affichage. */
async function listTitles(page: Page, titles: string[]): Promise<string[]> {
  const rows = await page.locator("button.sn-pressable").allTextContents();
  return rows.flatMap((text) => titles.filter((t) => text.includes(t)).slice(0, 1));
}

test.describe("21 — notes : glisser, dupliquer, épingler (desktop)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("glisser une note de la liste vers un dossier de l'arbre la déplace", async ({ page }) => {
    const { alpha, beta } = await seedVault(page);
    expect(await filePathOf(page, alpha)).toMatch(/^Inbox\//);

    const folder = page.locator('[data-folder-drop="Cible"] > div').first();
    await expect(folder).toBeVisible();
    await listRow(page, "Alpha dnd").dragTo(folder);

    await expect.poll(() => filePathOf(page, alpha), { timeout: 15_000 }).toMatch(/^Cible\//);
    // La note quitte la liste d'Inbox ; les autres restent.
    await expect(listRow(page, "Alpha dnd")).toHaveCount(0);
    await expect(listRow(page, "Beta dnd")).toBeVisible();
    expect(await filePathOf(page, beta)).toMatch(/^Inbox\//);
  });

  test("« Dupliquer » crée « … (copie) » dans le même dossier et l'ouvre", async ({ page }) => {
    const { beta } = await seedVault(page);
    await listRow(page, "Beta dnd").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Dupliquer" }).click();

    await expect(page).toHaveURL(/\/notes\/[^/?]+(\?.*)?$/);
    expect(page.url()).not.toContain(beta);
    await expect(page.getByLabel("Titre de la note")).toHaveValue("Beta dnd (copie)", { timeout: 30_000 });

    const list = await workerCall<{ items: { id: string; filePath: string; fields: Record<string, unknown> }[] }>(
      page,
      "query",
      "entities.list",
      { typeId: "note", limit: 50, offset: 0 },
    );
    const copy = list.items.find((n) => n.fields["title"] === "Beta dnd (copie)");
    expect(copy?.filePath).toMatch(/^Inbox\//);
    expect(list.items.find((n) => n.id === beta)?.fields["title"]).toBe("Beta dnd");
  });

  test("« Épingler » remonte la note en tête et survit au rechargement", async ({ page }) => {
    await seedVault(page);
    const titles = ["Zeta dnd", "Alpha dnd", "Beta dnd"];
    // Tri par date de modification : la plus ancienne (Zeta) est en bas.
    expect((await listTitles(page, titles))[0]).not.toBe("Zeta dnd");

    await listRow(page, "Zeta dnd").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Épingler" }).click();
    await expect.poll(async () => (await listTitles(page, titles))[0]).toBe("Zeta dnd");
    await expect(listRow(page, "Zeta dnd").getByRole("img", { name: "Épinglée" })).toBeVisible();

    await page.reload();
    await expect(listRow(page, "Zeta dnd")).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await listTitles(page, titles))[0]).toBe("Zeta dnd");
    await expect(listRow(page, "Zeta dnd").getByRole("img", { name: "Épinglée" })).toBeVisible();

    await listRow(page, "Zeta dnd").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Désépingler" }).click();
    await expect(listRow(page, "Zeta dnd").getByRole("img", { name: "Épinglée" })).toHaveCount(0);
  });
});

test.describe("21 — notes : déplacer au doigt (mobile)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  /** Appui long réel (touchstart maintenu 700 ms) : Chromium émulé ne produit pas le contextmenu d'Android. */
  async function longPress(page: Page, target: Locator): Promise<void> {
    const box = await target.boundingBox();
    if (!box) throw new Error("ligne introuvable");
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await page.waitForTimeout(700);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  test("appui long → « Déplacer… » → dossier : la note change de dossier", async ({ page }) => {
    const { alpha } = await seedVault(page);
    await longPress(page, listRow(page, "Alpha dnd"));

    const move = page.getByRole("menuitem", { name: "Déplacer…" });
    await expect(move).toBeVisible();
    await move.tap();

    const dialog = page.getByRole("dialog", { name: "Déplacer la note dans…" });
    await expect(dialog).toBeVisible();
    const target = dialog.getByRole("button", { name: /Cible/ });
    const box = await target.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
    await target.tap();

    await expect.poll(() => filePathOf(page, alpha), { timeout: 15_000 }).toMatch(/^Cible\//);
    await expect(dialog).toHaveCount(0);
    await expect(listRow(page, "Alpha dnd")).toHaveCount(0);
    // L'appui long ne doit pas avoir ouvert la note derrière le menu.
    await expect(page).toHaveURL(/\/notes\?folder=Inbox$/);
  });

  test("appui long → « Épingler » : la note remonte en tête, sans débordement horizontal", async ({ page }) => {
    await seedVault(page);
    await longPress(page, listRow(page, "Zeta dnd"));
    await page.getByRole("menuitem", { name: "Épingler" }).tap();
    await expect.poll(async () => (await listTitles(page, ["Zeta dnd", "Alpha dnd", "Beta dnd"]))[0]).toBe("Zeta dnd");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});
