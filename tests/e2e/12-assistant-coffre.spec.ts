import { test, expect, type Page } from "@playwright/test";
import { withInbox } from "./helpers";

/** Ollama simulé : 1ᵉʳ tour = appel de searchMail, tour suivant (résultat d'outil reçu) = réponse. */
async function mockOllama(page: Page, calls: string[]): Promise<void> {
  await page.route("http://127.0.0.1:11434/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    calls.push(path);
    if (path === "/api/tags") return route.fulfill({ json: { models: [{ name: "qwen3.5:4b" }] } });
    if (path === "/api/chat") {
      const body = (req.postDataJSON() ?? {}) as { messages?: Array<{ role: string }> };
      const hasToolResult = (body.messages ?? []).some((m) => m.role === "tool");
      return route.fulfill({
        json: hasToolResult
          ? { message: { role: "assistant", content: "Alice a envoyé le compte rendu ce matin." }, done: true }
          : {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [{ function: { name: "searchMail", arguments: { query: "compte rendu" } } }],
              },
              done: true,
            },
      });
    }
    return route.fulfill({ json: {} });
  });
}

test.describe("12 — assistant du coffre", () => {
  test("le bouton de /mail ouvre l'assistant, dont les sources mail sont cliquables", async ({ page }) => {
    const calls: string[] = [];
    await withInbox(page);
    await mockOllama(page, calls);
    await page.goto("/mail");
    await expect(page.getByText("Compte rendu réunion").first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Ouvrir l'assistant" }).click();
    await expect(page).toHaveURL(/\/ai$/);

    await page.getByRole("button", { name: "Où en est le dernier devis ?" }).click({ timeout: 20_000 });
    await expect(page.getByText("Alice a envoyé le compte rendu ce matin.")).toBeVisible({ timeout: 20_000 });
    const source = page.getByRole("button", { name: "Compte rendu réunion" });
    await expect(source).toBeVisible();
    await source.click();
    await expect(page).toHaveURL(/\/mail\?thread=t1/);
  });

  test("?q= envoie la question à l'ouverture", async ({ page }) => {
    const calls: string[] = [];
    await withInbox(page);
    await mockOllama(page, calls);
    await page.goto("/mail");
    await expect(page.getByText("Compte rendu réunion").first()).toBeVisible({ timeout: 20_000 });
    await page.goto("/ai?q=compte%20rendu");
    await expect(page.getByText("Alice a envoyé le compte rendu ce matin.")).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/ai$/);
  });

  test("une écriture de note après lecture d'un mail demande l'accord", async ({ page }) => {
    await withInbox(page);
    await page.route("http://127.0.0.1:11434/**", async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (path === "/api/tags") return route.fulfill({ json: { models: [{ name: "qwen3.5:4b" }] } });
      const body = (req.postDataJSON() ?? {}) as { messages?: Array<{ role: string }> };
      const toolTurns = (body.messages ?? []).filter((m) => m.role === "tool").length;
      const call = (name: string, args: Record<string, unknown>) => ({
        message: { role: "assistant", content: "", tool_calls: [{ function: { name, arguments: args } }] },
        done: true,
      });
      if (toolTurns === 0) return route.fulfill({ json: call("searchMail", { query: "compte rendu" }) });
      if (toolTurns === 1) return route.fulfill({ json: call("createNote", { title: "Piège", body: "injecté" }) });
      return route.fulfill({ json: { message: { role: "assistant", content: "Terminé." }, done: true } });
    });
    await page.goto("/mail");
    await expect(page.getByText("Compte rendu réunion").first()).toBeVisible({ timeout: 20_000 });
    await page.goto("/ai?q=compte%20rendu");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Créer une note ?", { timeout: 30_000 });
    await dialog.getByRole("button", { name: /Annuler/ }).click();
    await expect(page.getByText("Terminé.")).toBeVisible({ timeout: 20_000 });
  });

  test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("pas d'IA sur mobile : notice, aucun appel à Ollama", async ({ page }) => {
      const calls: string[] = [];
      await withInbox(page);
      await mockOllama(page, calls);
      await page.goto("/ai");
      await expect(page.getByText(/sur ordinateur|PC|ordinateur/i).first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(1_500);
      expect(calls).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
});
