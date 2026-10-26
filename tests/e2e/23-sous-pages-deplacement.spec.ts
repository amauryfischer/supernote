import { test, expect, type Page } from "@playwright/test";
import { bootCloud, seedNote, workerCall } from "./helpers";

// Coffre OPFS + routes lazy : le premier chargement est long sur un Vite froid.
test.describe.configure({ timeout: 180_000 });

const filePathOf = async (page: Page, id: string) =>
  (await workerCall<{ filePath: string }>(page, "query", "entities.get", { id })).filePath;

test.describe("23 — sous-pages : déplacement avec la descendance (desktop)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("déplacer une page emmène sa descendance du même dossier, pas l'enfant rangé ailleurs", async ({ page }) => {
    await bootCloud(page);
    await page.goto("/notes");
    const p = await seedNote(page, { title: "Wiki racine", body: "", folder: "Wiki" });
    const c = await seedNote(page, { title: "Domaine", body: "", folder: "Wiki", fields: { parentId: p } });
    const g = await seedNote(page, { title: "Sous-domaine", body: "", folder: "Wiki", fields: { parentId: c } });
    const d = await seedNote(page, { title: "Rangée ailleurs", body: "", folder: "Ailleurs", fields: { parentId: p } });
    const loop = await seedNote(page, { title: "Boucle", body: "", folder: "Wiki", fields: { parentId: g } });
    // Cycle c → loop → g → c : c n'est plus enfant de p, et le parcours ne boucle pas.
    await workerCall(page, "mutation", "entities.update", { id: c, fields: { parentId: loop } });
    const { items } = await workerCall<{ items: { id: string }[] }>(page, "query", "entities.subpageDescendants", { id: p });
    expect(items.map((i) => i.id)).toEqual([]);
    await workerCall(page, "mutation", "entities.update", { id: c, fields: { parentId: p } });
    const after = await workerCall<{ items: { id: string }[] }>(page, "query", "entities.subpageDescendants", { id: p });
    expect(after.items.map((i) => i.id).sort()).toEqual([c, g, loop].sort());

    await seedNote(page, { title: "Témoin", body: "", folder: "Archives" });
    await page.goto("/notes?folder=Wiki");
    const row = page.locator("button.sn-pressable", { hasText: "Wiki racine" }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    const folder = page.locator('[data-folder-drop="Archives"] > div').first();
    await expect(folder).toBeVisible();
    await row.dragTo(folder);

    for (const id of [p, c, g, loop]) {
      await expect.poll(() => filePathOf(page, id), { timeout: 15_000 }).toMatch(/^Archives\//);
    }
    expect(await filePathOf(page, d)).toMatch(/^Ailleurs\//);
  });
});
