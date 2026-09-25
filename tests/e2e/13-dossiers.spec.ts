import { test, expect, type Page } from "@playwright/test";
import { withInbox } from "./helpers";

/** Écrit dans le coffre de test par le protocole du worker (même chemin que le client tRPC). */
async function create(page: Page, typeId: string, fields: Record<string, unknown>): Promise<string> {
  return page.evaluate(
    ({ typeId, fields }) =>
      new Promise<string>((resolve, reject) => {
        const worker = (window as unknown as { __supernoteWorker: Worker }).__supernoteWorker;
        const id = `e2e-${Math.random().toString(36).slice(2)}`;
        const onMessage = (e: MessageEvent) => {
          const msg = e.data as { id?: string; ok?: boolean; result?: { id: string }; error?: string };
          if (msg?.id !== id) return;
          worker.removeEventListener("message", onMessage);
          if (msg.ok && msg.result) resolve(msg.result.id);
          else reject(new Error(msg.error ?? "création refusée"));
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage({ id, path: "entities.create", type: "mutation", input: { typeId, fields } });
      }),
    { typeId, fields },
  );
}

async function seed(page: Page): Promise<{ personId: string; orgId: string }> {
  await withInbox(page);
  await page.goto("/mail");
  await expect(page.getByText("Compte rendu réunion").first()).toBeVisible({ timeout: 20_000 });
  const orgId = await create(page, "organisation", { name: "Acme", website: "https://www.exemple.fr" });
  const personId = await create(page, "personne", { name: "Alice Dupont", email: "alice@exemple.fr", organisationId: orgId });
  return { personId, orgId };
}

test.describe("13 — dossiers vivants", () => {
  test("le dossier d'une personne puis de son organisation montre ses mails", async ({ page }) => {
    const { personId, orgId } = await seed(page);

    await page.goto(`/contacts/${personId}`);
    const mail = page.getByRole("button", { name: /Compte rendu réunion/ });
    await expect(mail).toBeVisible({ timeout: 20_000 });

    const filters = page.getByRole("group", { name: "Filtrer le dossier" });
    await filters.getByRole("button", { name: "Mails", exact: true }).click();
    await expect(mail).toBeVisible();
    await filters.getByRole("button", { name: "Notes", exact: true }).click();
    await expect(page.getByText(/Rien dans « Notes » pour Alice Dupont/)).toBeVisible();
    await filters.getByRole("button", { name: "Tout", exact: true }).click();

    await mail.click();
    await expect(page).toHaveURL(/\/mail/);
    await expect(page.getByRole("button", { name: "Copier le message" })).toBeVisible({ timeout: 20_000 });

    await page.goto(`/contacts/${orgId}`);
    await expect(page.getByRole("button", { name: /Compte rendu réunion/ })).toBeVisible({ timeout: 20_000 });
  });

  test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("le dossier tient sans débordement", async ({ page }) => {
      const { personId } = await seed(page);
      await page.goto(`/contacts/${personId}`);
      await expect(page.getByRole("button", { name: /Compte rendu réunion/ })).toBeVisible({ timeout: 20_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
});
