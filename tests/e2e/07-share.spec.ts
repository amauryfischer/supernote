import { expect, test, type Browser, type Page } from "@playwright/test";
import { openNewNote, withInbox } from "./helpers";

async function createLink(owner: Page, opts: { write?: boolean; password?: string } = {}): Promise<string> {
  await owner.getByRole("button", { name: "Partager", exact: true }).first().click();
  if (opts.write) await owner.getByRole("button", { name: "Écriture" }).click();
  if (opts.password) {
    // Le natif `<input role="switch">` de HeroUI est visuellement couvert par
    // son rendu `switch-control` : le label associé reçoit le clic pour de vrai.
    await owner.getByText("Protéger par mot de passe", { exact: true }).click();
    await owner.getByLabel("Mot de passe du lien").fill(opts.password);
  }
  await owner.getByRole("button", { name: "Créer le lien" }).click();
  const url = (await owner.getByTestId("share-link-url").last().textContent())!.trim();
  // Bouton de fermeture explicite plutôt qu'Escape : plus fiable entre deux
  // contextes de page (propriétaire + invité) dans le même test.
  await owner.getByRole("button", { name: "Close" }).click();
  return url;
}

async function guestPage(browser: Browser, url: string, viewport?: { width: number; height: number }): Promise<Page> {
  const ctx = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    ...(viewport ? { viewport, isMobile: true, hasTouch: true } : {}),
  });
  const page = await ctx.newPage();
  await page.goto(url);
  return page;
}

test.describe("07 — partage", () => {
  test("lien écriture : l'invité tape, le propriétaire voit texte et curseur", async ({ page: owner, browser }) => {
    await openNewNote(owner, "Note partagée e2e");
    const url = await createLink(owner, { write: true });
    const guest = await guestPage(browser, url);
    await guest.getByLabel("Ton nom").fill("Paul");
    await guest.getByRole("button", { name: "Rejoindre" }).click();
    await guest.locator(".bn-editor").first().click();
    await guest.keyboard.type("Bonjour depuis l'invité");
    await expect(owner.locator(".bn-editor").first()).toContainText("Bonjour depuis l'invité");
    await expect(owner.getByLabel("Personnes connectées")).toContainText("Paul");
  });

  test("lien lecture : l'invité voit le texte sans pouvoir éditer", async ({ page: owner, browser }) => {
    await openNewNote(owner, "Note lecture e2e");
    await owner.locator(".bn-editor").first().click();
    await owner.keyboard.type("Texte du propriétaire");
    const url = await createLink(owner);
    const guest = await guestPage(browser, url);
    await expect(guest.locator(".bn-editor").first()).toContainText("Texte du propriétaire");
    await expect(guest.locator('.bn-editor[contenteditable="true"]')).toHaveCount(0);
  });

  test("mot de passe : refus puis accès", async ({ page: owner, browser }) => {
    await openNewNote(owner, "Note protégée e2e");
    const url = await createLink(owner, { password: "secret-e2e" });
    const guest = await guestPage(browser, url);
    await guest.getByLabel("Mot de passe").fill("faux-mot");
    await guest.getByRole("button", { name: "Ouvrir" }).click();
    await expect(guest.getByRole("alert")).toContainText("Mot de passe incorrect");
    await guest.getByLabel("Mot de passe").fill("secret-e2e");
    await guest.getByRole("button", { name: "Ouvrir" }).click();
    await expect(guest.locator(".bn-editor").first()).toBeVisible();
  });

  test("lien expiré et lien révoqué", async ({ page, request }) => {
    const res = (await (
      await request.post("/api/share/resources", {
        data: { kind: "email", title: "Fil", snapshot: { subject: "S", messages: [{ from: "a", to: "b", date: "", bodyText: "x" }] } },
      })
    ).json()) as { id: string; ownerKey: string };
    const headers = { "x-share-owner": res.ownerKey };
    const mk = async (data: object) =>
      ((await (await request.post(`/api/share/resources/${res.id}/links`, { headers, data })).json()) as { link: { slug: string } }).link.slug;
    const expiring = await mk({ mode: "read", expiresAt: Date.now() + 1500 });
    const revoked = await mk({ mode: "read" });
    await request.delete(`/api/share/links/${revoked}`, { headers });
    await page.waitForTimeout(2000);
    await page.goto(`/s/${expiring}`);
    await expect(page.getByText("Ce lien a expiré.")).toBeVisible();
    await page.goto(`/s/${revoked}`);
    await expect(page.getByText("Ce lien a été retiré.")).toBeVisible();
  });

  test("révocation : l'invité connecté est coupé", async ({ page: owner, browser }) => {
    await openNewNote(owner, "Note révoquée e2e");
    const url = await createLink(owner, { write: true });
    const guest = await guestPage(browser, url);
    await guest.getByLabel("Ton nom").fill("Léa");
    await guest.getByRole("button", { name: "Rejoindre" }).click();
    await expect(guest.locator(".bn-editor").first()).toBeVisible();
    await owner.getByRole("button", { name: "Partager", exact: true }).first().click();
    await owner.getByRole("button", { name: "Retirer ce lien" }).last().click();
    // Task 6 : l'invité oublie son jeton et recharge une fois — il retombe sur
    // l'écran du lien fermé, pas sur un message dédié "Accès retiré".
    await expect(guest.getByText("Ce lien a été retiré.")).toBeVisible({ timeout: 15_000 });
  });

  test("email : le fil partagé s'affiche en texte, sans HTML interprété", async ({ page, browser, request }) => {
    const res = (await (
      await request.post("/api/share/resources", {
        data: { kind: "email", title: "Fil", snapshot: { subject: "Sujet e2e", messages: [{ from: "Alice", to: "Bob", date: "2026-09-22T10:00:00Z", bodyText: "<b>gras</b>" }] } },
      })
    ).json()) as { id: string; ownerKey: string };
    const link = ((await (
      await request.post(`/api/share/resources/${res.id}/links`, {
        headers: { "x-share-owner": res.ownerKey },
        data: { mode: "read" },
      })
    ).json()) as { link: { slug: string } }).link.slug;
    const guest = await guestPage(browser, `/s/${link}`);
    await expect(guest.getByRole("heading", { name: "Sujet e2e" })).toBeVisible();
    await expect(guest.getByText("<b>gras</b>")).toBeVisible();
    await expect(guest.locator("article b")).toHaveCount(0);

    await withInbox(page);
    await page.goto("/mail");
    await page.getByText("Compte rendu réunion").first().click();
    await page.getByRole("button", { name: "Plus d'actions" }).click();
    await page.getByRole("button", { name: "Partager par lien" }).click();
    await page.getByRole("button", { name: "Créer le lien" }).click();
    await expect(page.getByTestId("share-link-url")).toHaveCount(1);
  });

  test("mobile : page invitée sans débordement horizontal", async ({ page: owner, browser }) => {
    await openNewNote(owner, "Note mobile e2e");
    const url = await createLink(owner);
    const guest = await guestPage(browser, url, { width: 390, height: 844 });
    await expect(guest.locator(".bn-editor").first()).toBeVisible();
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("non-régression : la note garde le texte de l'invité après un arrêt de partage sans frappe du propriétaire", async ({
    page: owner,
    browser,
  }) => {
    await openNewNote(owner, "Note absence e2e");
    const noteUrl = owner.url();
    const url = await createLink(owner, { write: true });
    await owner.goto("/notes");

    const guest = await guestPage(browser, url);
    await guest.getByLabel("Ton nom").fill("Léa");
    await guest.getByRole("button", { name: "Rejoindre" }).click();
    await guest.locator(".bn-editor").first().click();
    await guest.keyboard.type("Pendant l'absence.");

    await owner.goto(noteUrl);
    await expect(owner.locator(".bn-editor").first()).toContainText("Pendant l'absence.");

    await owner.getByRole("button", { name: "Partager", exact: true }).first().click();
    await owner.getByRole("button", { name: "Arrêter le partage" }).last().click();
    await owner.getByRole("button", { name: "Arrêter le partage" }).last().click();
    // Les deux modales (panneau + confirmation) sont fermées : `stopShare()` a
    // résolu sans lever (sinon la modale resterait ouverte sur son `role="alert"`).
    await expect(owner.getByRole("dialog")).toHaveCount(0);

    await expect(owner.locator('.bn-editor[contenteditable="true"]')).toBeVisible();
    await expect(owner.locator(".bn-editor")).toContainText("Pendant l'absence.");

    // Le texte doit être dans le .md persisté, pas seulement en mémoire : un
    // rechargement rouvre le même coffre (bootCloud) et relit le corps sauvé.
    await owner.reload();
    await expect(owner.locator(".bn-editor").first()).toContainText("Pendant l'absence.");
  });
});
