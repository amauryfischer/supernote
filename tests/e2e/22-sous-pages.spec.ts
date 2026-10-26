import { test, expect } from "@playwright/test";
import { bootCloud, openNote, seedNote, workerCall } from "./helpers";

// Les routes de note se compilent à froid (Vite) et le coffre OPFS rouvre lentement à chaque rechargement.
test.describe.configure({ timeout: 180_000 });

test.describe("sous-pages (desktop)", () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test("[subpage] : repli « Page », round-trip exact, ligne mal formée gardée en texte", async ({ page }) => {
    await bootCloud(page);
    await page.goto("/notes");
    const body = 'Intro\n\n[subpage id="01FANTOME"]\n\nvoir [subpage id="x"] ici\n\n[subpage]\n\nFin';
    const id = await seedNote(page, { title: "Hôte", body, folder: "Wiki" });
    await openNote(page, id);

    const card = page.locator("[data-subpage-id='01FANTOME']");
    await expect(card).toBeVisible();
    await expect(card.locator("[data-subpage-fallback]")).toHaveText("Page");

    await page.locator(".bn-editor").getByText("Fin", { exact: true }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" !");

    const savedBody = async () => (await workerCall<{ body: string }>(page, "query", "entities.get", { id })).body;
    await expect.poll(savedBody, { timeout: 30_000 }).toContain("Fin !");
    const saved = await savedBody();
    expect(saved).toContain('[subpage id="01FANTOME"]');
    expect(saved).toContain('voir [subpage id="x"] ici');
    expect(saved).toContain("[subpage]");
  });
});
