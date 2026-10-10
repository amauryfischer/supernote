import { test, expect, type Page } from "@playwright/test";
import { bootCloud } from "./helpers";

test.use({ viewport: { width: 1440, height: 900 } });

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
  test("Input : la loupe sœur n'est pas recouverte par le champ", async ({ page }) => {
    await bootCloud(page);
    await page.goto("/notes");
    const input = page.getByPlaceholder("Filtrer le coffre…");
    await expect(input).toBeVisible({ timeout: 30_000 });

    const hit = await input.evaluate((el) => {
      const icon = el.parentElement?.querySelector("svg");
      if (!icon) return "no-icon";
      const r = icon.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top && (top === icon || icon.contains(top)) ? "icon" : (top?.tagName ?? "none");
    });
    expect(hit).toBe("icon");
  });

  test("Select : la pastille renderValue ne passe pas sous le chevron", async ({ page }) => {
    await bootCloud(page);
    await page.goto("/notes");
    await expect(page.getByPlaceholder("Filtrer le coffre…")).toBeVisible({ timeout: 30_000 });
    await createPerson(page, { name: "Alice Dupont", relationType: "connaissance" });

    await page.goto("/contacts");
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
  });
});
