import { test, expect, type Page } from "@playwright/test";
import { withInbox } from "./helpers";

type Reply = { ok: boolean; result?: unknown; error?: string };
type Note = { id: string; body: string; tags: string[] };

/** Appel brut au worker (même protocole que le client tRPC) : renvoie la réponse sans lever. */
async function rpc(page: Page, path: string, type: "query" | "mutation", input: unknown): Promise<Reply> {
  return page.evaluate(
    ({ path, type, input }) =>
      new Promise<Reply>((resolve) => {
        const worker = (window as unknown as { __supernoteWorker: Worker }).__supernoteWorker;
        const id = `e2e-${Math.random().toString(36).slice(2)}`;
        const onMessage = (e: MessageEvent) => {
          const msg = e.data as { id?: string; ok?: boolean; result?: unknown; error?: string };
          if (msg?.id !== id) return;
          worker.removeEventListener("message", onMessage);
          resolve({ ok: !!msg.ok, result: msg.result, error: msg.error });
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage({ id, path, type, input });
      }),
    { path, type, input },
  );
}

async function boot(page: Page): Promise<void> {
  await withInbox(page);
  await page.goto("/mail");
  await expect(page.getByText("Compte rendu réunion").first()).toBeVisible({ timeout: 20_000 });
}

// Un tag non-string (5) fait lever applyEntityTags après l'INSERT/UPDATE : l'état
// partiel devient observable sans attendre la passe de reindex (30 s) qui le répare.
test.describe("18 — écritures entité atomiques", () => {
  test("create qui lève ne laisse aucune entité derrière lui", async ({ page }) => {
    await boot(page);

    const created = await rpc(page, "entities.create", "mutation", {
      typeId: "note",
      id: "e2e-atom-1",
      fields: { title: "zqxatom" },
      tags: ["a", 5],
    });
    expect(created.ok).toBe(false);

    const got = await rpc(page, "entities.get", "query", { id: "e2e-atom-1" });
    expect(got.ok).toBe(false);
    expect(got.error).toMatch(/not found/i);
  });

  test("update qui lève garde les anciens tags et l'ancien corps", async ({ page }) => {
    await boot(page);

    const created = await rpc(page, "entities.create", "mutation", {
      typeId: "note",
      id: "e2e-atom-2",
      fields: { title: "zqxbase" },
      body: "ancien corps",
      tags: ["x"],
    });
    expect(created.ok).toBe(true);

    const updated = await rpc(page, "entities.update", "mutation", {
      id: "e2e-atom-2",
      body: "zqxbody",
      tags: ["a", 5],
    });
    expect(updated.ok).toBe(false);

    const got = await rpc(page, "entities.get", "query", { id: "e2e-atom-2" });
    expect(got.ok).toBe(true);
    const note = got.result as Note;
    expect(note.tags).toEqual(["x"]);
    expect(note.body).toBe("ancien corps");
  });
});
