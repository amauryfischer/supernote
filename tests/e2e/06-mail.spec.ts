import { test, expect } from "@playwright/test";
import { withInbox, MESSAGE } from "./helpers";

const NEWSLETTER = `<html><head><style>.titre{font-size:40px;font-weight:700}</style></head>
<body bgcolor="#0f1420"><table width="600" cellpadding="0" cellspacing="0" style="background-color:#0f1420">
<tr><td style="color:#fff;padding:24px">Pour visualiser correctement cette lettre d'information, cliquez ici</td></tr>
<tr><td><img src="https://img.exemple.fr/la-rochelle.jpg" width="600" height="300" alt="La Rochelle"></td></tr>
<tr><td class="titre" style="color:#fff;padding:24px">Mon carnet de voyage</td></tr>
</table></body></html>`;

const NEWSLETTER_MESSAGE = {
  ...MESSAGE,
  payload: {
    ...MESSAGE.payload,
    mimeType: "text/html",
    body: { size: NEWSLETTER.length, data: Buffer.from(NEWSLETTER, "utf8").toString("base64url") },
  },
};

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

  test("destinataire : autocomplétion par nom et par ma propre adresse, Ctrl+Entrée envoie", async ({ page }) => {
    await withInbox(page);
    await page.goto("/mail");
    await expect(page.getByText("Compte rendu réunion").first()).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press("c");
    const dialog = page.getByRole("dialog", { name: "Nouveau message" });

    await page.getByLabel("Objet").fill("Point");
    await page.keyboard.press("Control+Enter");
    await expect(dialog.getByRole("alert")).toContainText("destinataire");

    const to = page.getByLabel("À", { exact: true });
    await to.fill("alic");
    await expect(page.getByRole("option", { name: /Alice Dupont/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("button", { name: "Retirer alice@exemple.fr" })).toBeVisible();
    await expect(to).toHaveValue("");

    await to.fill("moi@");
    await page.getByRole("option", { name: /moi@exemple\.fr/ }).click();
    await expect(dialog.getByRole("button", { name: "Retirer moi@exemple.fr" })).toBeVisible();
    await expect(page.getByRole("listbox", { name: "Suggestions de destinataires" })).toHaveCount(0);
  });

  test("archiver un fil (e) affiche la pastille Annuler, cliquer dessus le restaure", async ({ page }) => {
    await withInbox(page);
    await page.goto("/mail");
    await expect(page.getByText("Compte rendu réunion").first()).toBeVisible({ timeout: 20_000 });

    await page.keyboard.press("j");
    await page.keyboard.press("e");

    const undoButton = page.getByRole("button", { name: /Annuler/ });
    await expect(undoButton).toBeVisible();
    await expect(page.getByText("Compte rendu réunion")).toHaveCount(0);

    await undoButton.click();
    await expect(page.getByText("Compte rendu réunion").first()).toBeVisible();
  });

  test("en-tête du fil réduit à Todo · Archiver · Reporter · Plus ; d archive comme e", async ({ page }) => {
    await withInbox(page);
    await page.goto("/mail");
    await page.getByText("Compte rendu réunion").first().click();

    const triage = page.getByRole("group", { name: "Triage du fil" });
    await expect(triage.getByRole("button", { name: "Archiver" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Plus d'actions" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Marquer comme fait" })).toHaveCount(0);
    await expect(triage.getByRole("button", { name: "Supprimer (corbeille)" })).toHaveCount(0);

    await page.getByRole("button", { name: "Plus d'actions" }).click();
    await expect(page.getByRole("button", { name: "Supprimer (corbeille)" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Supprimer (corbeille)" })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(triage).toHaveCount(0);
    await page.keyboard.press("j");
    await page.keyboard.press("d");
    await expect(page.getByRole("button", { name: /Annuler/ })).toBeVisible();
    await expect(page.getByText("Compte rendu réunion")).toHaveCount(0);
  });

  test("hiérarchie calme : / focalise la recherche, capture dans le menu Plus", async ({ page }) => {
    await withInbox(page);
    await page.goto("/mail");
    await expect(page.getByText("Compte rendu réunion").first()).toBeVisible({ timeout: 20_000 });

    await page.keyboard.press("/");
    await expect(page.getByLabel("Rechercher dans les emails")).toBeFocused();
    await page.keyboard.press("Escape");

    await page.getByRole("banner").getByRole("button", { name: "Nouveau message" }).click();
    await expect(page.getByRole("dialog", { name: "Nouveau message" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Nouveau message" })).toHaveCount(0);

    await page.getByText("Compte rendu réunion").first().click();
    await expect(page.getByText("Capturer :")).toHaveCount(0);
    await page.getByRole("button", { name: "Plus d'actions" }).click();
    await expect(page.getByRole("button", { name: "Capturer en note" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Capturer dans une base" })).toBeVisible();
    const more = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Capturer en note" }) });
    await more.getByRole("button", { name: "Mettre une étoile" }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(more.getByRole("button", { name: "Marquer comme non lu" })).toBeFocused();
  });

  test("clavier : . ouvre le menu de la ligne, flèches + Entrée, heures sans AM/PM", async ({ page }) => {
    await withInbox(page);
    await page.goto("/mail");
    await expect(page.getByText("Compte rendu réunion").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("listbox", { name: "Boîte mail" })).not.toContainText(/\b(AM|PM)\b/);

    await page.keyboard.press("j");
    await page.keyboard.press(".");
    const menu = page.getByRole("menu", { name: "Actions de l'email" });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", { name: "Supprimer" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    await page.keyboard.press(".");
    await menu.getByRole("menuitem", { name: "Archiver" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Annuler/ })).toBeVisible();
    await expect(page.getByText("Compte rendu réunion")).toHaveCount(0);
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

    test("un gabarit newsletter tient dans la largeur, images affichées par défaut", async ({ page }) => {
      await withInbox(page);
      await page.route("https://gmail.googleapis.com/**/threads/t1**", (route) =>
        route.fulfill({ json: { id: "t1", historyId: "10", messages: [NEWSLETTER_MESSAGE] } }),
      );
      const imageLoads: string[] = [];
      await page.route("https://img.exemple.fr/**", (route) => {
        imageLoads.push(route.request().url());
        return route.fulfill({ status: 404, body: "" });
      });
      await page.goto("/mail");
      await page.getByText("Compte rendu réunion").first().click();

      const frameEl = page.locator('iframe[title="Contenu du message"]');
      await expect(frameEl).toBeVisible();
      const frame = page.frameLocator('iframe[title="Contenu du message"]');
      await expect(frame.getByText("Mon carnet de voyage")).toBeVisible();
      await expect(frame.locator(".titre")).toHaveCSS("font-size", "40px");

      const box = await frameEl.boundingBox();
      const viewport = page.viewportSize();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
      const scale = await frameEl.evaluate((el) => {
        const root = (el as HTMLIFrameElement).contentDocument!.getElementById("sn-root")!;
        return root.getBoundingClientRect().width / (el as HTMLIFrameElement).clientWidth;
      });
      expect(scale).toBeLessThanOrEqual(1.01);
      expect(box!.height).toBeGreaterThan(100);
      await expect.poll(() => imageLoads.length).toBeGreaterThan(0);
      await expect(page.getByText("Images masquées")).toHaveCount(0);
      if (process.env["SHOTS"]) await page.screenshot({ path: `${process.env["SHOTS"]}/newsletter-mobile.png` });
    });

    test("fil ouvert : actions au pouce à la place de la nav, sujet en titre", async ({ page }) => {
      await withInbox(page);
      await page.goto("/mail");
      const nav = page.getByRole("navigation", { name: "Navigation principale" });
      await expect(nav).toBeVisible();

      await page.getByText("Compte rendu réunion").first().click();
      const triage = page.getByRole("group", { name: "Triage du fil" });
      await expect(triage.getByRole("button", { name: "Archiver" })).toBeVisible();
      await expect(nav).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Répondre", exact: true })).toBeVisible();

      const box = await triage.boundingBox();
      expect(box!.y).toBeGreaterThan(page.viewportSize()!.height / 2);
      await expect(page.getByRole("banner").getByText("Compte rendu réunion")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      await page.getByRole("button", { name: "Retour" }).click();
      await expect(nav).toBeVisible();
    });

    test("le retour système ferme le fil au lieu de quitter /mail", async ({ page }) => {
      await withInbox(page);
      await page.goto("/notes");
      await page.goto("/mail");
      const copy = page.getByRole("button", { name: "Copier le message" });

      await page.getByText("Compte rendu réunion").first().click();
      await expect(copy).toBeVisible();
      await page.goBack();
      await expect(copy).toBeHidden();
      await expect(page).toHaveURL(/\/mail$/);

      await page.getByText("Compte rendu réunion").first().click();
      await expect(copy).toBeVisible();
      await page.getByRole("button", { name: "Retour" }).click();
      await expect(copy).toBeHidden();
      // La flèche du haut retire l'entrée : le retour suivant quitte bien /mail.
      await page.goBack();
      await expect(page).toHaveURL(/\/notes/);
    });
  });
});
