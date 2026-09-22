import { test, expect, type Page } from "@playwright/test";
import { bootCloud } from "./helpers";

const BODY =
  "Bonjour,\n\nVoici le compte rendu de la réunion de ce matin.\n- budget validé\n- planning décalé\n\nAlice";

const MESSAGE = {
  id: "m1",
  threadId: "t1",
  labelIds: ["INBOX", "UNREAD"],
  snippet: "Voici le compte rendu",
  internalDate: String(Date.now() - 3_600_000),
  historyId: "10",
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: "Alice Dupont <alice@exemple.fr>" },
      { name: "To", value: "moi@exemple.fr" },
      { name: "Subject", value: "Compte rendu réunion" },
      { name: "Date", value: new Date().toUTCString() },
      { name: "Message-ID", value: "<m1@exemple.fr>" },
    ],
    body: { size: BODY.length, data: Buffer.from(BODY, "utf8").toString("base64url") },
  },
};

/** Boîte Gmail d'un seul fil ; Agenda et Drive vides. */
async function withInbox(page: Page): Promise<void> {
  await bootCloud(page, { googleAccount: "moi@exemple.fr" });
  await page.route("https://gmail.googleapis.com/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/gmail/v1/users/me", "");
    if (path === "/threads") return route.fulfill({ json: { threads: [{ id: "t1", snippet: MESSAGE.snippet }] } });
    if (path.startsWith("/threads/")) return route.fulfill({ json: { id: "t1", historyId: "10", messages: [MESSAGE] } });
    if (path.startsWith("/messages/")) return route.fulfill({ json: MESSAGE });
    if (path === "/profile") return route.fulfill({ json: { emailAddress: "moi@exemple.fr", historyId: "10" } });
    if (path.startsWith("/labels/")) return route.fulfill({ json: { id: "INBOX", threadsTotal: 1, threadsUnread: 1 } });
    if (path === "/labels") return route.fulfill({ json: { labels: [] } });
    return route.fulfill({ json: {} });
  });
  await page.route("https://www.googleapis.com/**", (route) => route.fulfill({ json: { items: [] } }));
}

test.describe("06 — mail", () => {
  test("composeur plein écran, erreur inline sans destinataire", async ({ page }) => {
    await withInbox(page);
    await page.goto("/mail");
    await expect(page.getByText("Compte rendu réunion").first()).toBeVisible({ timeout: 20_000 });

    await page.keyboard.press("c");
    const dialog = page.getByRole("dialog", { name: "Nouveau message" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box?.width).toBe(viewport?.width);
    expect(box?.height).toBe(viewport?.height);

    await page.getByLabel("Objet").fill("Point");
    await page.getByRole("button", { name: "Envoyer", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("destinataire");
    await expect(page.getByLabel("À", { exact: true })).toBeFocused();
    if (process.env["SHOTS"]) await page.screenshot({ path: `${process.env["SHOTS"]}/compose-alert.png` });
  });

  test("le message se copie depuis sa bulle", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await withInbox(page);
    await page.goto("/mail");
    await page.getByText("Compte rendu réunion").first().click();
    await page.getByRole("button", { name: "Copier le message" }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("Voici le compte rendu");
  });

  test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("le FAB ouvre le composeur, sans débordement horizontal", async ({ page }) => {
      await withInbox(page);
      await page.goto("/mail");
      await page.getByRole("button", { name: "Nouveau message" }).last().click();
      await expect(page.getByRole("dialog", { name: "Nouveau message" })).toBeVisible();
      await page.getByLabel("À", { exact: true }).fill("bob@exemple.fr");
      await page.keyboard.press("Enter");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      if (process.env["SHOTS"]) await page.screenshot({ path: `${process.env["SHOTS"]}/compose-mobile.png` });
    });
  });
});
