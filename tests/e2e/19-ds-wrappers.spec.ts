import { test, expect, type Page } from "@playwright/test";
import { bootCloud } from "./helpers";

async function createPerson(page: Page, fields: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    (fields) =>
      new Promise<void>((resolve, reject) => {
        const worker = (window as unknown as { __supernoteWorker: Worker }).__supernoteWorker;
        const id = `e2e-${Math.random().toString(36).slice(2)}`;
        const onMessage = (e: MessageEvent) => {
          const msg = e.data as { id?: string; ok?: boolean; error?: string };
          if (msg?.id !== id) return;
          worker.removeEventListener("message", onMessage);
          if (msg.ok) resolve();
          else reject(new Error(msg.error ?? "création refusée"));
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage({ id, path: "entities.create", type: "mutation", input: { typeId: "personne", fields } });
      }),
    fields,
  );
}

test.describe("19 — wrappers @supernote/ui", () => {
  test.describe("desktop 1440", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("Input : la loupe sœur n'est pas recouverte par le champ", async ({ page }) => {
      await bootCloud(page);
      await page.goto("/notes");
      const input = page.getByPlaceholder("Filtrer le coffre…");
      await expect(input).toBeVisible({ timeout: 30_000 });

      // L'overlay « Ouverture du vault… » recouvre tout tant que le coffre n'est pas prêt : on sonde jusqu'à sa disparition.
      await expect
        .poll(
          () =>
            input.evaluate((el) => {
              let box: HTMLElement | null = el.parentElement;
              while (box && !box.querySelector("svg")) box = box.parentElement;
              const icon = box?.querySelector("svg");
              if (!icon) return "no-icon";
              const r = icon.getBoundingClientRect();
              const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return top && (top === icon || icon.contains(top)) ? "icon" : (top?.tagName ?? "none");
            }),
          { timeout: 60_000 },
        )
        .toBe("icon");
    });

    test("Select : la pastille renderValue ne passe pas sous le chevron", async ({ page }) => {
      await bootCloud(page);
      await page.goto("/notes");
      await expect(page.getByPlaceholder("Filtrer le coffre…")).toBeVisible({ timeout: 30_000 });
      await expect(() => createPerson(page, { name: "Alice Dupont", relationType: "connaissance" })).toPass({
        timeout: 30_000,
      });

      await page.goto("/contacts");
      await expect(page.getByText("Ouverture du vault...")).toBeHidden({ timeout: 60_000 });
      const trigger = page.getByRole("button", { name: /Type de relation/ }).first();
      await expect(trigger).toBeVisible({ timeout: 30_000 });

      const gap = await trigger.evaluate((el) => {
        const chip = [...el.querySelectorAll("span")].find((s) => s.textContent?.trim() === "Connaissance");
        const icons = el.querySelectorAll("svg");
        const indicator = icons[icons.length - 1];
        if (!chip || !indicator) return null;
        return indicator.getBoundingClientRect().left - chip.getBoundingClientRect().right;
      });
      expect(gap).not.toBeNull();
      expect(gap!).toBeGreaterThanOrEqual(0);

      await trigger.click();
      await page.locator('[role="option"]:visible', { hasText: /^Ami$/ }).click();
      const ring = await trigger.evaluate((el) => getComputedStyle(el).boxShadow);
      expect(ring === "none" || /rgba\(0, 0, 0, 0\)/.test(ring)).toBe(true);
    });
  });

  test.describe("mobile 390 tactile", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("recherche de base : champ d'au moins 32 px de haut", async ({ page }) => {
      await bootCloud(page);
      await page.goto("/bases/personne");
      const search = page.getByLabel("Rechercher dans la base");
      await expect(search).toBeVisible({ timeout: 30_000 });
      const box = await search.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(32);
    });
  });
});
