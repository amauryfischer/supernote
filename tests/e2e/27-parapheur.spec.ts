import { test, expect, type Page } from "@playwright/test";
import { withInbox, workerCall, MESSAGE } from "./helpers";

// Trois vraies questions, une politesse (écartée), une signature (écartée).
const BODY = [
  "Bonjour,",
  "",
  "Pouvez-vous me confirmer votre présence jeudi ? Est-ce que le devis vous convient ?",
  "Merci de m'indiquer l'adresse de livraison.",
  "",
  "Comment allez-vous ?",
  "",
  "Cordialement,",
  "Alice",
].join("\n");

const QUESTIONS_MESSAGE = {
  ...MESSAGE,
  payload: {
    ...MESSAGE.payload,
    body: { size: BODY.length, data: Buffer.from(BODY, "utf8").toString("base64url") },
  },
};

async function openThread(page: Page): Promise<void> {
  await withInbox(page, [QUESTIONS_MESSAGE]);
  await page.goto("/mail");
  await page.getByText("Compte rendu réunion").first().click();
}

test.describe("27 — parapheur", () => {
  test("r ouvre les questions, une touche par réponse, la promesse suivie devient une tâche datée", async ({ page }) => {
    await openThread(page);
    await expect(page.getByRole("button", { name: /3\s*questions/ })).toBeVisible({ timeout: 20_000 });

    await page.keyboard.press("r");
    const grid = page.getByRole("region", { name: "Questions du message" });
    const rows = grid.getByRole("listitem");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toBeFocused();

    await page.keyboard.press("o");
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press("l");
    await expect(rows.nth(2)).toBeFocused();
    await page.keyboard.press("e");
    const reply = page.getByPlaceholder(/Répondre à/);
    await expect(reply).toBeFocused();
    await page.keyboard.type("12 rue des Lilas, Nantes.");
    await expect(grid.getByLabel("3 sur 3 tranchées")).toBeVisible();

    const text = await reply.inputValue();
    expect(text).toContain("« Pouvez-vous me confirmer votre présence jeudi ? »\nOui.");
    expect(text).toMatch(/« Est-ce que le devis vous convient \? »\nJe reviens vers vous là-dessus d'ici [a-z]+\./);
    expect(text).toContain("« Merci de m'indiquer l'adresse de livraison. »\n12 rue des Lilas, Nantes.");
    expect(text).not.toContain("Comment allez-vous");

    // « Je reviens vers vous … d'ici <jour> » est une promesse datée : on la suit.
    await page.getByRole("button", { name: /^Suivre la promesse : Je reviens vers vous/ }).click();
    await expect(page.getByRole("button", { name: /^Ne plus suivre : Je reviens vers vous/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    if (process.env["SHOTS"]) await page.screenshot({ path: `${process.env["SHOTS"]}/parapheur-desktop.png` });

    await reply.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.press("Control+Enter");
    await expect(page.getByText("Réponse envoyée · 1 promesse suivie")).toBeVisible();

    await expect
      .poll(async () => {
        const { items } = await workerCall<{ items: Array<{ fields: Record<string, unknown> }> }>(
          page,
          "query",
          "entities.list",
          { typeId: "todo", limit: 100, offset: 0 },
        );
        const todo = items.find((e) => String(e.fields["text"] ?? "").startsWith("Je reviens vers vous là-dessus"));
        return todo ? { due: /^\d{4}-\d{2}-\d{2}$/.test(String(todo.fields["dueDate"])), thread: todo.fields["mailThreadId"] } : null;
      })
      .toEqual({ due: true, thread: "t1" });
  });

  test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("au pouce : une réponse par toucher, envoi retenu tant qu'une question reste ouverte", async ({ page }) => {
      await openThread(page);
      await page.getByRole("button", { name: /Répondre aux\s*3\s*questions/ }).click({ timeout: 20_000 });

      const grid = page.getByRole("region", { name: "Questions du message" });
      await expect(grid).toBeVisible();
      await grid.getByRole("button", { name: "Oui", exact: true }).click();
      await grid.getByRole("button", { name: "Non", exact: true }).click();
      await expect(grid.getByLabel("2 sur 3 tranchées")).toBeVisible();

      const text = await page.getByPlaceholder(/Répondre à/).inputValue();
      expect(text).toContain("« Pouvez-vous me confirmer votre présence jeudi ? »\nOui.");
      expect(text).toContain("« Est-ce que le devis vous convient ? »\nNon.");

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      if (process.env["SHOTS"]) await page.screenshot({ path: `${process.env["SHOTS"]}/parapheur-mobile.png` });

      await page.getByRole("button", { name: "Envoyer", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("1 question sans réponse");
    });
  });
});
