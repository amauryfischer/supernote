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
        const res = await call(`e2e-checklist-${path}-${attempt}-${Math.random()}`);
        if (res.ok) return res.result;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("coffre jamais prêt");
    },
    { type, path, input },
  ) as Promise<T>;
}

test.describe("16 — checklists des notes côté worker", () => {
  test("deux cases vues dans /todos ; cocher l'une réécrit la note et rafraîchit la liste", async ({ page }) => {
    test.setTimeout(180_000);
    await bootCloud(page);
    // Le boot dev (compilation Vite) dépasse le seuil de gel du watchdog : sa bannière « session figée »
    // recouvrirait la liste au rechargement.
    await page.addInitScript(() => {
      for (const k of ["crumb", "longtasks", "errors"]) localStorage.removeItem(`sn:freeze:${k}`);
      localStorage.setItem("supernote.todos.viewMode", "list");
    });
    await page.goto("/todos");
    const { id } = await workerCall<{ id: string }>(page, "mutation", "entities.create", {
      typeId: "note",
      fields: { title: "Courses e2e" },
      body: "# Courses\n\n- [ ] Acheter du pain\n- [ ] Appeler le plombier\n",
    });

    // La route worker renvoie les lignes déjà extraites, sans corps de note.
    const lines = await workerCall<Array<Record<string, unknown>>>(page, "query", "entities.noteChecklists", undefined);
    expect(lines.map((l) => l["text"])).toEqual(["Acheter du pain", "Appeler le plombier"]);
    expect(lines.every((l) => l["noteId"] === id && !("body" in l))).toBe(true);

    // Le coffre OPFS rouvre lentement sur un Vite froid.
    await page.reload();
    await expect(page.getByRole("button", { name: "Acheter du pain", exact: true })).toBeVisible({ timeout: 80_000 });
    await expect(page.getByRole("button", { name: "Appeler le plombier", exact: true })).toBeVisible();

    const row = page.getByRole("button", { name: "Acheter du pain", exact: true }).locator("xpath=ancestor::*[.//button[@aria-label='Marquer comme faite']][1]");
    await row.getByRole("button", { name: "Marquer comme faite" }).click();

    await expect
      .poll(async () => (await workerCall<{ body: string }>(page, "query", "entities.get", { id })).body)
      .toContain("- [x] Acheter du pain");
    const { body } = await workerCall<{ body: string }>(page, "query", "entities.get", { id });
    expect(body).toContain("- [ ] Appeler le plombier");

    // Sans rechargement : le compteur « Faites » passe à 1 puis la ligne y apparaît cochée.
    await expect(page.getByRole("button", { name: /^Faites\s*1$/ })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /^Faites/ }).click();
    await expect(page.getByRole("button", { name: "Acheter du pain", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Marquer comme non faite" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Appeler le plombier", exact: true })).toHaveCount(0);
  });
});
