import { test, expect } from "@playwright/test";
import { bootCloud, withInbox } from "./helpers";

test.describe("08 — notifications & PWA", () => {
  test("C : /mail?compose=1 ouvre la composition", async ({ page }) => {
    await withInbox(page);
    await page.goto("/mail?compose=1");
    await expect(page.getByRole("dialog", { name: "Nouveau message" })).toBeVisible();
    await expect(page).toHaveURL(/\/mail$/);
  });

  test("C : /mail?new=note crée une note Inbox", async ({ page }) => {
    await bootCloud(page);
    await page.goto("/mail?new=note");
    await expect(page).toHaveURL(/\/notes\//, { timeout: 20_000 });
  });

  test("C : un partage crée une note Inbox", async ({ page }) => {
    await bootCloud(page);
    await page.goto("/mail");
    await page.evaluate(async () => {
      const cache = await caches.open("share-inbox");
      await cache.put(
        "/share-target/pending",
        new Response(
          JSON.stringify({ title: "Article partagé", text: "à lire", url: "https://example.com", files: [] }),
        ),
      );
    });
    await page.goto("/share?pending=1");
    await expect(page).toHaveURL(/\/notes\//, { timeout: 20_000 });
    await expect(page.getByLabel("Titre de la note")).toHaveValue("Article partagé");
  });
});
