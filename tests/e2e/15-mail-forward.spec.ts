import { test, expect } from "@playwright/test";
import { withInbox, MESSAGE } from "./helpers";

const HTML = `<html><body><p>Bonjour, voici la <b>lettre</b> du mois.</p></body></html>`;
const HTML_MESSAGE = {
  ...MESSAGE,
  payload: { ...MESSAGE.payload, mimeType: "text/html", body: { size: HTML.length, data: Buffer.from(HTML, "utf8").toString("base64url") } },
};

test.describe("15 — transfert au clavier", () => {
  test("f depuis la liste ouvre le composeur prérempli", async ({ page }) => {
    await withInbox(page);
    await page.goto("/mail");
    await expect(page.getByText("Compte rendu réunion").first()).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("j");
    await page.keyboard.press("f");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Transférer", { exact: true })).toBeVisible();
  });

  test("f dans un fil ouvert au clic ouvre le composeur prérempli", async ({ page }) => {
    await withInbox(page);
    await page.goto("/mail");
    await page.getByText("Compte rendu réunion").first().click();
    await expect(page.getByPlaceholder(/Répondre à/)).toBeVisible();
    await page.keyboard.press("f");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Transférer", { exact: true })).toBeVisible();
  });

  test("f après un clic dans le corps HTML du mail (iframe)", async ({ page }) => {
    await withInbox(page, [HTML_MESSAGE]);
    await page.goto("/mail");
    await page.getByText("Compte rendu réunion").first().click();
    await page.frameLocator("iframe").getByText("lettre").click();
    await page.keyboard.press("f");
    await expect(page.getByRole("dialog").getByText("Transférer", { exact: true })).toBeVisible();
  });
});
