import { test, expect, type Page } from "@playwright/test";
import { bootCloud, mockGoogleApis } from "./helpers";

const ME = "moi@exemple.fr";

function atHour(dayOffset: number, h: number, m = 0): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

function dayKey(dayOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EVENTS = () => [
  {
    id: "ev-point",
    status: "confirmed",
    summary: "Point équipe",
    etag: '"1"',
    htmlLink: "https://calendar.google.com/event?eid=x",
    start: { dateTime: atHour(0, 10) },
    end: { dateTime: atHour(0, 11) },
    hangoutLink: "https://meet.google.com/abc-defg-hij",
    attendees: [
      { email: ME, self: true, responseStatus: "needsAction" },
      { email: "alice@exemple.fr", displayName: "Alice Dupont", responseStatus: "accepted", organizer: true },
    ],
  },
  { id: "ev-revue", status: "confirmed", summary: "Revue design", etag: '"1"', start: { dateTime: atHour(0, 10, 30) }, end: { dateTime: atHour(0, 12) } },
  { id: "ev-salon", status: "confirmed", summary: "Salon VivaTech", etag: '"1"', start: { date: dayKey(1) }, end: { date: dayKey(4) } },
];

/** Un compte avec son agenda principal et un agenda de jours fériés en lecture seule. */
async function withGoogleCalendar(page: Page): Promise<string[]> {
  await bootCloud(page, { googleAccount: ME });
  await page.addInitScript((until) => {
    localStorage.setItem("supernote.calendar.connected", "1");
    // Un fil reporté à 15 h aujourd'hui : il doit apparaître dans la grille.
    localStorage.setItem("supernote.mail.snooze", JSON.stringify([{ threadId: "t-devis", until, subject: "Devis Acme" }]));
  }, new Date(atHour(0, 15)).getTime());
  return mockGoogleApis(page, (req, url) => {
    const path = url.pathname;
    if (path.endsWith("/users/me/calendarList")) {
      return {
        items: [
          { id: "primary", summary: ME, backgroundColor: "#4f7cff", foregroundColor: "#fff", selected: true, primary: true, accessRole: "owner" },
          { id: "fr.french#holiday", summary: "Jours fériés", backgroundColor: "#16a765", selected: true, accessRole: "reader" },
        ],
      };
    }
    if (req.method() === "GET" && path.includes("/events")) {
      return { items: path.includes("/calendars/primary/") ? EVENTS() : [] };
    }
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    if (req.method() === "POST") return { ...body, id: "g-nouveau", status: "confirmed", etag: '"2"' };
    if (req.method() === "PATCH") {
      const id = path.split("/events/")[1] ?? "";
      return { ...(EVENTS().find((e) => e.id === id) ?? {}), ...body, id, etag: '"3"' };
    }
    return undefined;
  });
}

const count = (calls: string[], method: string) => calls.filter((c) => c.startsWith(method)).length;

test.describe("04 — agenda", () => {
  test("connexion, semaine, réponse, création et déplacement", async ({ page }) => {
    const calls = await withGoogleCalendar(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/agenda");

    // Au chargement il n'y a pas de jeton en cache : la synchro attend le clic.
    await page.getByRole("button", { name: /Reprendre|Connecter Google Agenda/ }).first().click({ timeout: 45_000 });
    await expect(page.getByRole("button", { name: /Point équipe/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Revue design/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Report mail : Devis Acme" })).toBeVisible();

    // Filtre « Reports mail » : le report disparaît, puis revient.
    await page.getByRole("button", { name: "Reports mail" }).click();
    await expect(page.getByRole("button", { name: "Report mail : Devis Acme" })).toHaveCount(0);
    await page.getByRole("button", { name: "Reports mail" }).click();
    await expect(page.getByRole("button", { name: "Report mail : Devis Acme" })).toBeVisible();

    await page.getByRole("button", { name: /Point équipe/ }).click();
    const detail = page.getByRole("complementary", { name: "Détail de l'événement" });
    await expect(detail.getByRole("button", { name: "Rejoindre" })).toBeVisible();
    await expect(detail.getByText("Alice Dupont")).toBeVisible();
    await detail.getByRole("button", { name: "Oui" }).click();
    await expect.poll(() => count(calls, "PATCH"), { timeout: 15_000 }).toBe(1);

    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+k");
    await expect(page.getByPlaceholder(/Tapez une commande/)).toBeVisible();
    await page.keyboard.type("Nouvel événement");
    await page.getByText("Nouvel événement").first().click();
    await page.getByLabel("Titre").fill("Déjeuner client");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByRole("button", { name: /Déjeuner client/ })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => count(calls, "POST"), { timeout: 15_000 }).toBe(1);

    // Glisser un événement d'une heure vers le bas.
    const box = (await page.getByRole("button", { name: /Revue design/ }).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 30, { steps: 4 });
    await page.mouse.move(box.x + box.width / 2, box.y + 56, { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => count(calls, "PATCH"), { timeout: 15_000 }).toBe(2);

    await page.keyboard.press("m");
    await expect(page.getByRole("button", { name: /Salon VivaTech/ }).first()).toBeVisible();

    // Note de réunion : créée depuis l'événement, puis rouverte par le même bouton.
    await page.keyboard.press("s");
    await page.getByRole("button", { name: /^Point équipe, / }).click();
    await page.getByRole("complementary", { name: "Détail de l'événement" }).getByRole("button", { name: "Note de réunion" }).click();
    await expect(page).toHaveURL(/\/notes\/[^/?]+/, { timeout: 20_000 });
    const noteUrl = page.url().split("?")[0];
    await expect(page.getByText(/Point équipe —/).first()).toBeVisible({ timeout: 20_000 });
    await page.goBack();
    await page.getByRole("button", { name: /^Point équipe, / }).click({ timeout: 20_000 });
    await page.getByRole("complementary", { name: "Détail de l'événement" }).getByRole("button", { name: "Note de réunion" }).click();
    await expect.poll(() => page.url().split("?")[0], { timeout: 20_000 }).toBe(noteUrl);
  });

  test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("liste, détail en feuille, sans débordement horizontal", async ({ page }) => {
      await withGoogleCalendar(page);
      await page.goto("/agenda");
      await page.getByRole("button", { name: /Reprendre|Connecter Google Agenda/ }).first().click({ timeout: 45_000 });
      await expect(page.getByRole("button", { name: /Point équipe/ })).toBeVisible({ timeout: 30_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await page.getByRole("button", { name: /Point équipe/ }).click();
      await expect(page.getByRole("button", { name: "Rejoindre" })).toBeVisible();
    });
  });
});
