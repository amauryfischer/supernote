import { test, expect, type Page } from "@playwright/test";
import { bootCloud, MESSAGE } from "./helpers";

const ME = "moi@exemple.fr";
const BODY = "Bonjour,\n\nJe vous envoie le devis signé vendredi 2 octobre.\n\nAlice";
const QUOTE = "Je vous envoie le devis signé vendredi 2 octobre.";

function inOneHour(): number {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d.getTime();
}

const EVENT = (start: number) => ({
  id: "ev-client",
  status: "confirmed",
  summary: "Point client Acme",
  etag: '"1"',
  start: { dateTime: new Date(start).toISOString() },
  end: { dateTime: new Date(start + 3_600_000).toISOString() },
  attendees: [
    { email: ME, self: true, responseStatus: "accepted", organizer: true },
    { email: "alice@exemple.fr", displayName: "Alice Dupont", responseStatus: "accepted" },
    { email: "salle-1@resource.calendar.google.com", displayName: "Salle 1", responseStatus: "accepted" },
  ],
});

async function setup(page: Page, start: number): Promise<void> {
  await bootCloud(page, { googleAccount: ME });
  await page.addInitScript(() => {
    localStorage.setItem("supernote.calendar.connected", "1");
    localStorage.setItem("supernote.ai.commitments", "1");
  });
  const msg = {
    ...MESSAGE,
    snippet: "Je vous envoie le devis signé vendredi",
    payload: {
      ...MESSAGE.payload,
      headers: MESSAGE.payload.headers.map((h) => (h.name === "Subject" ? { ...h, value: "Devis Acme" } : h)),
      body: { size: BODY.length, data: Buffer.from(BODY, "utf8").toString("base64url") },
    },
  };
  await page.route("https://gmail.googleapis.com/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/gmail/v1/users/me", "");
    if (path === "/threads") return route.fulfill({ json: { threads: [{ id: "t1", snippet: msg.snippet }] } });
    if (path.startsWith("/threads/")) return route.fulfill({ json: { id: "t1", historyId: "10", messages: [msg] } });
    if (path.startsWith("/messages/")) return route.fulfill({ json: msg });
    if (path === "/profile") return route.fulfill({ json: { emailAddress: ME, historyId: "10" } });
    if (path.startsWith("/labels/")) return route.fulfill({ json: { id: "INBOX", threadsTotal: 1, threadsUnread: 1 } });
    if (path === "/labels") return route.fulfill({ json: { labels: [] } });
    return route.fulfill({ json: {} });
  });
  await page.route("https://www.googleapis.com/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/users/me/calendarList")) {
      return route.fulfill({
        json: { items: [{ id: "primary", summary: ME, backgroundColor: "#4f7cff", foregroundColor: "#fff", selected: true, primary: true, accessRole: "owner" }] },
      });
    }
    if (path.includes("/events")) return route.fulfill({ json: { items: path.includes("/calendars/primary/") ? [EVENT(start)] : [] } });
    return route.fulfill({ json: { items: [] } });
  });
  await page.route("http://127.0.0.1:11434/**", (route) =>
    route.fulfill({
      json: {
        response: JSON.stringify({
          engagements: [{ message: 1, direction: "eux", text: "Envoyer le devis signé", due: null, quote: QUOTE }],
        }),
        done: true,
      },
    }),
  );
}

test.describe("11 — brief avant réunion", () => {
  test("le lien de la notification ouvre la fiche avec engagements et échanges du participant", async ({ page }) => {
    const start = inOneHour();
    await setup(page, start);
    await page.setViewportSize({ width: 1440, height: 900 });

    // Le fil d'Alice passe par le miroir et la détection d'engagements.
    await page.goto("/mail");
    await page.getByText("Devis Acme").first().click();
    await expect(page.getByRole("region", { name: "Engagements" })).toContainText("Envoyer le devis signé", { timeout: 20_000 });

    await page.goto(`/agenda?event=ev-client&at=${start}`);
    await page.getByRole("button", { name: /Reprendre|Connecter Google Agenda/ }).first().click({ timeout: 45_000 });
    const detail = page.getByRole("complementary", { name: "Détail de l'événement" });
    await expect(detail.getByText("Alice Dupont")).toBeVisible({ timeout: 30_000 });
    await expect(detail).toContainText("On me doit");
    await expect(detail).toContainText("Envoyer le devis signé");
    await expect(detail).toContainText("Derniers échanges");
    await expect(detail).toContainText("Devis Acme");
    await expect(detail).not.toContainText("Salle 1");
  });

  test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("la fiche s'ouvre depuis le lien, sans débordement", async ({ page }) => {
      const start = inOneHour();
      await setup(page, start);
      await page.goto(`/agenda?event=ev-client&at=${start}`);
      await page.getByRole("button", { name: /Reprendre|Connecter Google Agenda/ }).first().click({ timeout: 45_000 });
      await expect(page.getByText("Alice Dupont").first()).toBeVisible({ timeout: 30_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
});
