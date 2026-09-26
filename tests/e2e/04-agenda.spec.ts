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
  {
    id: "ev-tache",
    status: "confirmed",
    summary: "Préparer la démo",
    etag: '"1"',
    start: { dateTime: atHour(1, 16) },
    end: { dateTime: atHour(1, 16, 30) },
    extendedProperties: { private: { supernoteRef: "todo:ancien" } },
  },
];

/** Un compte avec son agenda principal et un agenda de jours fériés en lecture seule. */
async function withGoogleCalendar(page: Page, posted: Record<string, unknown>[] = []): Promise<string[]> {
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
    if (req.method() === "POST") {
      posted.push(body);
      return { ...body, id: "g-nouveau", status: "confirmed", etag: '"2"' };
    }
    if (req.method() === "PATCH") {
      const id = path.split("/events/")[1] ?? "";
      return { ...(EVENTS().find((e) => e.id === id) ?? {}), ...body, id, etag: '"3"' };
    }
    return undefined;
  });
}

const count = (calls: string[], method: string) => calls.filter((c) => c.startsWith(method)).length;

async function createTodo(page: Page, text: string, mobile = false): Promise<void> {
  await page.goto("/todos");
  await page.getByRole("button", { name: mobile ? "Nouvelle tâche" : "Nouvelle", exact: true }).first().click({ timeout: 45_000 });
  await page.getByPlaceholder("Texte de la tâche").fill(text);
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });
}

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

  test("masquer un agenda et changer sa couleur, écrits dans Google", async ({ page }) => {
    const calls = await withGoogleCalendar(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/agenda");
    await page.getByRole("button", { name: /Reprendre|Connecter Google Agenda/ }).first().click({ timeout: 45_000 });
    const point = page.getByRole("button", { name: /Point équipe/ });
    await expect(point).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Agendas affichés et couleurs" }).click();
    await page.getByRole("checkbox", { name: ME }).click({ force: true });
    await expect(point).toHaveCount(0);
    await expect.poll(() => calls.filter((c) => c.startsWith("PATCH") && c.includes("/calendarList/")).length).toBe(1);

    await page.getByRole("button", { name: `Couleur de ${ME}` }).click();
    await page.getByRole("button", { name: "#16a765" }).click();
    await page.getByRole("checkbox", { name: ME }).click({ force: true });
    await expect(point).toBeVisible();
    await expect.poll(() => calls.filter((c) => c.startsWith("PATCH") && c.includes("/calendarList/")).length).toBe(3);
    await expect.poll(() => point.evaluate((el) => el.outerHTML)).toMatch(/22, 167, 101|#16a765/i);
    if (process.env["SHOTS"]) await page.screenshot({ path: `${process.env["SHOTS"]}/agenda-calendars.png` });
  });

  test("une synchro refusée par Google s'affiche au lieu d'une grille muette", async ({ page }) => {
    await bootCloud(page, { googleAccount: ME });
    await page.addInitScript(() => localStorage.setItem("supernote.calendar.connected", "1"));
    await page.route("https://www.googleapis.com/**", (route) =>
      route.fulfill({ status: 403, json: { error: { code: 403, message: "Google Calendar API has not been used in project 1 before or it is disabled." } } }),
    );
    await page.goto("/agenda");
    await page.getByRole("button", { name: /Reprendre/ }).click({ timeout: 45_000 });
    await expect(page.getByRole("alert").filter({ hasText: "Synchro Google Agenda impossible" })).toContainText("is disabled", { timeout: 20_000 });
  });

  test("un todo glissé du tiroir devient un bloc lié", async ({ page }) => {
    test.setTimeout(120_000);
    const posted: Record<string, unknown>[] = [];
    await withGoogleCalendar(page, posted);
    await page.setViewportSize({ width: 1440, height: 900 });
    await createTodo(page, "Rédiger le compte rendu");

    await page.goto("/agenda");
    await page.getByRole("button", { name: /Reprendre|Connecter Google Agenda/ }).first().click({ timeout: 45_000 });
    await page.keyboard.press("j");
    await page.getByRole("button", { name: "Période suivante" }).click();

    // Un événement Google porteur de supernoteRef s'affiche comme une tâche.
    const bloc = page.getByRole("button", { name: /^Tâche : Préparer la démo/ });
    await expect(bloc).toBeVisible({ timeout: 30_000 });

    const drawer = page.getByRole("complementary", { name: "À planifier" });
    const task = drawer.getByRole("button", { name: "Rédiger le compte rendu" });
    await task.dragTo(bloc);

    await expect.poll(() => posted.length, { timeout: 15_000 }).toBe(1);
    expect(posted[0]).toMatchObject({
      summary: "Rédiger le compte rendu",
      description: expect.stringContaining("/todos?edit="),
      extendedProperties: { private: { supernoteRef: expect.stringMatching(/^todo:\S+$/) } },
    });
    await expect(task).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Tâche : Rédiger le compte rendu/ })).toBeVisible();
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

  test.describe("téléphone 360 px", () => {
    test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });

    test("planifier une tâche depuis l'en-tête, premier créneau libre", async ({ page }) => {
      test.setTimeout(120_000);
      const posted: Record<string, unknown>[] = [];
      await withGoogleCalendar(page, posted);
      await createTodo(page, "Rédiger le compte rendu", true);

      await page.goto("/agenda");
      await page.getByRole("button", { name: /Reprendre|Connecter Google Agenda/ }).first().click({ timeout: 45_000 });
      await expect(page.getByRole("button", { name: /Point équipe/ })).toBeVisible({ timeout: 30_000 });

      await page.getByRole("button", { name: "Planifier une tâche" }).click();
      await page.getByRole("button", { name: "Rédiger le compte rendu" }).click();
      const slots = page.getByRole("group", { name: "Prochains créneaux libres" });
      await expect(slots.getByRole("button").first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      await slots.getByRole("button").first().click();
      await expect.poll(() => posted.length, { timeout: 15_000 }).toBe(1);
      expect(posted[0]).toMatchObject({
        summary: "Rédiger le compte rendu",
        extendedProperties: { private: { supernoteRef: expect.stringMatching(/^todo:\S+$/) } },
      });
    });
  });
});
