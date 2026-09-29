import { test, expect, type Page } from "@playwright/test";
import { bootCloud } from "./helpers";

async function workerCall<T>(page: Page, type: "query" | "mutation", path: string, input: unknown): Promise<T> {
  await page.waitForFunction(() => "__supernoteWorker" in window);
  return page.evaluate(
    async ({ type, path, input }) => {
      const worker = (window as unknown as { __supernoteWorker: Worker }).__supernoteWorker;
      const call = (id: string) =>
        new Promise<{ ok: boolean; result?: unknown }>((resolve) => {
          const onMessage = (e: MessageEvent) => {
            if ((e.data as { id?: string } | null)?.id !== id) return;
            worker.removeEventListener("message", onMessage);
            resolve(e.data as { ok: boolean; result?: unknown });
          };
          worker.addEventListener("message", onMessage);
          worker.postMessage({ id, type, path, input });
        });
      // Le coffre répond « Vault not initialized » tant qu'il n'est pas prêt.
      for (let attempt = 0; attempt < 60; attempt++) {
        const res = await call(`e2e-habit-${path}-${attempt}-${Math.random()}`);
        if (res.ok) return res.result;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("coffre jamais prêt");
    },
    { type, path, input },
  ) as Promise<T>;
}

async function habitIdByName(page: Page, name: string): Promise<string> {
  const { items } = await workerCall<{ items: Array<{ id: string; fields: Record<string, unknown> }> }>(
    page,
    "query",
    "entities.list",
    { typeId: "habit", limit: 100, offset: 0 },
  );
  const found = items.find((e) => e.fields["name"] === name);
  if (!found) throw new Error(`habitude ${name} introuvable`);
  return found.id;
}

async function checkinsOf(page: Page, id: string): Promise<Record<string, number>> {
  const { items } = await workerCall<{ items: Array<{ id: string; fields: Record<string, unknown> }> }>(
    page,
    "query",
    "entities.list",
    { typeId: "habit", limit: 100, offset: 0 },
  );
  const raw = items.find((e) => e.id === id)?.fields["checkins"];
  return typeof raw === "string" && raw ? (JSON.parse(raw) as Record<string, number>) : {};
}

async function createHabit(page: Page, name: string, period: "Jour" | "Semaine" | "Mois") {
  await page.getByRole("button", { name: "Nouvelle habitude" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nom de l'habitude").fill(name);
  await dialog.getByRole("tab", { name: period }).click();
  await dialog.getByRole("button", { name: "Créer" }).click();
  await expect(dialog).toBeHidden();
}

const total = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);

test.describe("14 — habitudes", () => {
  test("hebdo cochée depuis la vue aujourd'hui, « Fait » appliqué une seule fois", async ({ page }) => {
    await bootCloud(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/habits");

    await createHabit(page, "Sport", "Semaine");
    const today = page.getByRole("region", { name: "Aujourd'hui" });
    await expect(today.getByRole("heading", { name: "Cette semaine" })).toBeVisible();
    const sportRow = today.getByRole("button", { name: "Cocher Sport : Pas encore fait cette semaine" });
    await expect(sportRow).toBeVisible();
    await expect(page.getByText("1× / semaine")).toBeVisible();

    await sportRow.click();
    await expect(today.getByRole("button", { name: /Fait \(1\)/ })).toBeVisible();

    await createHabit(page, "Lire", "Jour");
    const lireId = await habitIdByName(page, "Lire");
    await page.goto(`/habits?habit=${lireId}&done=1`);
    await expect(today.getByRole("button", { name: /Fait \(2\)/ })).toBeVisible();
    await expect.poll(() => new URL(page.url()).search).toBe("");
    await expect.poll(async () => total(await checkinsOf(page, lireId))).toBe(1);

    await page.reload();
    await expect(today.getByRole("button", { name: /Fait \(2\)/ })).toBeVisible();
    expect(total(await checkinsOf(page, lireId))).toBe(1);

    // Semaine déjà tenue : « Fait » ne doit ni ajouter ni décocher.
    const sportId = await habitIdByName(page, "Sport");
    await page.goto(`/habits?habit=${sportId}&done=1`);
    await expect(today.getByRole("button", { name: /Fait \(2\)/ })).toBeVisible();
    await expect.poll(() => new URL(page.url()).search).toBe("");
    expect(total(await checkinsOf(page, sportId))).toBe(1);
  });
});
