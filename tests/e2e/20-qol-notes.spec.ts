import { test, expect, type Page } from "@playwright/test";
import { bootCloud, openNote, seedNote } from "./helpers";

// Les routes de note se compilent à froid (Vite) et le coffre OPFS rouvre lentement à chaque rechargement.
test.describe.configure({ timeout: 180_000 });

const filler = (n: number, word = "lorem") =>
  Array.from({ length: n }, (_, i) => `${word} ipsum dolor sit amet consectetur ${i}`).join("\n\n");

/** Note longue : 4 titres, 3 occurrences de « zèbre » (accents et casse variés), un #TODO et une case non cochée. */
const LONG_BODY = [
  "# Alpha",
  "Introduction de la note.",
  filler(22),
  "## Beta",
  "Le zèbre traverse la savane.",
  filler(22),
  "## Gamma",
  "Un autre zebre ici.",
  filler(22),
  "## Delta",
  "#TODO relire ce passage",
  "- [ ] case non cochée",
  "Zèbre final.",
  filler(22),
].join("\n\n");

/** Même longueur, aucune pastille ni case : sert de témoin négatif à la minimap. */
const PLAIN_BODY = ["# Alpha", filler(22), "## Beta", filler(22), "## Gamma", filler(22), "## Delta", filler(22)].join("\n\n");

interface SeedOpts {
  /** Barre d'outils de la note dépliée dès l'ouverture (préférence globale). */
  metaBar?: boolean;
  /** Index de la note à ouvrir. */
  open?: number;
}

/** Coffre cloud neuf, notes semées par le worker, première note ouverte après rechargement. */
async function seedAndOpen(page: Page, notes: { title: string; body: string }[], opts: SeedOpts = {}): Promise<string[]> {
  await bootCloud(page);
  await page.addInitScript((metaBar) => {
    // Le boot dev dépasse le seuil de gel du watchdog : sa bannière recouvrirait l'éditeur.
    for (const k of ["crumb", "longtasks", "errors"]) localStorage.removeItem(`sn:freeze:${k}`);
    if (metaBar) localStorage.setItem("supernote.notes.metaBarOpen", "1");
  }, opts.metaBar ?? false);
  await page.goto("/notes");
  const ids: string[] = [];
  for (const note of notes) ids.push(await seedNote(page, note));
  await openNote(page, ids[opts.open ?? 0]!);
  return ids;
}

/** Scroller de la note : le parent direct du gabarit `.sn-note-gutter` qui porte l'éditeur. */
const scroller = (page: Page) => page.locator(".bn-editor").first().locator("xpath=ancestor::div[contains(@class,'overflow-y-auto')][1]");

async function clickEditor(page: Page) {
  await page.locator(".bn-editor .bn-block-content").first().click();
}

/** Lit la minimap : `find` = canvas des résultats de recherche, `main` = canvas du texte et des pastilles. */
async function minimapInk(page: Page, canvas: "main" | "find", kind: "any" | "amber"): Promise<number> {
  return page.evaluate(
    ({ canvas, kind }) => {
      const root = [...document.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')].find(
        (el) => el.querySelectorAll(":scope > canvas").length === 2,
      );
      const el = root?.querySelectorAll("canvas")[canvas === "main" ? 0 : 1];
      const ctx = el?.getContext("2d");
      if (!el || !ctx || el.width === 0) return -1;
      const { data } = ctx.getImageData(0, 0, el.width, el.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
        // Ambre (pastille TODO, point de case non cochée) : rouge > vert > bleu, très saturé. Le texte miniature est gris.
        if (kind === "any" ? a > 0 : a > 128 && r - b > 100 && r > g && g > b) count++;
      }
      return count;
    },
    { canvas, kind },
  );
}

const highlightCount = (page: Page, name: "sn-find" | "sn-find-current") =>
  page.evaluate((n) => (CSS.highlights.get(n)?.size ?? 0), name);

test.describe("20 — QoL notes (desktop)", () => {
  test.use({ viewport: { width: 1600, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });

  test("Mod+F : compteur n/m, Entrée passe au suivant, Échap ferme, repères dans la minimap", async ({ page }) => {
    await seedAndOpen(page, [{ title: "Savane", body: LONG_BODY }]);
    await clickEditor(page);
    // Le navigateur ne doit pas recevoir Ctrl+F : la barre de la note l'intercepte quand le focus est dans la note.
    await page.keyboard.press("Control+f");
    const search = page.getByRole("search");
    const input = search.getByLabel("Rechercher dans la note");
    await expect(input).toBeFocused();

    // « zebre » sans accent doit trouver « zèbre », « zebre » et « Zèbre » : 3 résultats.
    await input.fill("zebre");
    const counter = search.locator("[aria-live=polite]");
    await expect(counter).toHaveText("1/3");
    await expect.poll(() => highlightCount(page, "sn-find")).toBe(3);
    await expect.poll(() => highlightCount(page, "sn-find-current")).toBe(1);
    // Repères dans la minimap : un trait par résultat sur le canvas dédié.
    await expect.poll(() => minimapInk(page, "find", "any")).toBeGreaterThan(0);

    await page.keyboard.press("Enter");
    await expect(counter).toHaveText("2/3");
    await page.keyboard.press("Shift+Enter");
    await expect(counter).toHaveText("1/3");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(counter).toHaveText("3/3");
    await page.keyboard.press("Enter");
    await expect(counter).toHaveText("1/3");

    await input.fill("introuvable-xyz");
    await expect(counter).toHaveText("0/0");
    await expect.poll(() => minimapInk(page, "find", "any")).toBe(0);

    await page.keyboard.press("Escape");
    await expect(search).toHaveCount(0);
    await expect.poll(() => highlightCount(page, "sn-find")).toBe(0);
  });

  test("un #TODO dans le texte apparaît comme pastille ambre dans la minimap, pas dans une note sans tag", async ({ page }) => {
    // Assez large pour la minimap complète : réduite en rail, elle ne trace rien sur une note sans tag.
    await page.setViewportSize({ width: 2400, height: 900 });
    const [, tagged] = await seedAndOpen(page, [
      { title: "Sans tag", body: PLAIN_BODY },
      { title: "Avec tag", body: LONG_BODY },
    ]);
    await expect.poll(() => minimapInk(page, "main", "any")).toBeGreaterThan(0);
    expect(await minimapInk(page, "main", "amber")).toBe(0);

    await openNote(page, tagged!);
    await expect.poll(() => minimapInk(page, "main", "amber")).toBeGreaterThan(0);
  });

  test("plan : titre collant après défilement, liste des titres, clic → le titre arrive en haut", async ({ page }) => {
    await seedAndOpen(page, [{ title: "Plan", body: LONG_BODY }], { metaBar: true });
    const sticky = page.getByRole("button", { name: /^Plan de la note, section courante/ });
    await expect(sticky).toHaveCount(0);

    // Gamma juste sorti par le haut : c'est la section courante.
    await scrollHeadingToTop(page, "Gamma", -10);
    await expect(sticky).toBeVisible();
    await expect(sticky).toHaveAccessibleName("Plan de la note, section courante : Gamma");

    await sticky.click();
    const panel = page.getByRole("dialog", { name: "Plan de la note" });
    // La ligne porte aussi les tags de sa section (« Delta #TODO »).
    for (const title of ["Alpha", "Beta", "Gamma", "Delta"]) await expect(panel.getByRole("button", { name: new RegExp(`^${title}( |$)`) })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Gamma", exact: true })).toHaveAttribute("aria-current", "location");

    await panel.getByRole("button", { name: /^Delta( |$)/ }).click();
    await expect(panel).toHaveCount(0);
    // Défilement fluide : le titre se pose à ~48 px du haut de la zone de texte.
    await expect.poll(() => headingOffset(page, "Delta")).toBeGreaterThan(30);
    await expect.poll(() => headingOffset(page, "Delta")).toBeLessThan(70);
    await expect(sticky).toHaveAccessibleName("Plan de la note, section courante : Delta");

    // Le bouton « Plan » de la barre d'outils ouvre la même liste (la note s'appelle aussi « Plan » dans l'arbre).
    await page.locator("#note-meta-bar").getByRole("button", { name: "Plan", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Plan de la note" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Plan de la note" })).toHaveCount(0);
  });

  test("Mod+Alt+↓ / ↑ sautent au titre suivant / précédent", async ({ page }) => {
    await seedAndOpen(page, [{ title: "Sauts", body: LONG_BODY }]);
    await page.locator('.bn-editor [data-content-type="heading"]', { hasText: "Alpha" }).click();
    expect(await selectedHeading(page)).toBe("Alpha");
    await page.keyboard.press("Control+Alt+ArrowDown");
    await expect.poll(() => selectedHeading(page)).toBe("Beta");
    await page.keyboard.press("Control+Alt+ArrowDown");
    await expect.poll(() => selectedHeading(page)).toBe("Gamma");
    await page.keyboard.press("Control+Alt+ArrowUp");
    await expect.poll(() => selectedHeading(page)).toBe("Beta");
  });

  test("« Copier le lien » d'un titre puis ouverture de ?heading= : le titre est dans la vue, malgré la position reprise", async ({ page }) => {
    const [id] = await seedAndOpen(page, [{ title: "Lien", body: LONG_BODY }], { metaBar: true });
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await page.getByRole("dialog", { name: "Plan de la note" }).getByRole("button", { name: "Copier le lien vers « Gamma »", exact: true }).click();
    await expect.poll(() => readClipboard(page)).toContain("?heading=");
    const url = await readClipboard(page);
    expect(new URL(url).pathname).toBe(`/notes/${id}`);

    // La reprise de position (localStorage) ramènerait en bas : le paramètre doit la primer.
    await page.evaluate(() => {
      const sc = document.querySelector(".bn-editor")!.closest(".overflow-y-auto")!;
      sc.scrollTop = sc.scrollHeight;
    });
    await page.waitForTimeout(900);
    await page.goto(url);
    await page.locator(".bn-editor").first().waitFor();
    await expect.poll(() => headingOffset(page, "Gamma"), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => headingOffset(page, "Gamma")).toBeLessThan(150);
  });

  test("largeur de lecture : colonne limitée par défaut, « Pleine largeur » l'élargit et survit au rechargement", async ({ page }) => {
    // Le panneau de note ne dépasse la largeur de lecture (736 px) que sur un très grand écran : arbre, liste et panneau droit le mangent.
    await page.setViewportSize({ width: 2400, height: 1000 });
    const [id] = await seedAndOpen(page, [{ title: "Largeur", body: LONG_BODY }], { metaBar: true });
    const width = () => page.locator(".bn-editor").first().evaluate((el) => el.getBoundingClientRect().width);
    const narrow = await width();
    expect(narrow).toBeGreaterThan(400);
    expect(narrow).toBeLessThanOrEqual(760);

    const full = page.getByRole("button", { name: "Pleine largeur" });
    await expect(full).toHaveAttribute("aria-pressed", "false");
    await full.click();
    await expect(full).toHaveAttribute("aria-pressed", "true");
    await expect.poll(width).toBeGreaterThan(narrow + 150);
    const wide = await width();

    await openNote(page, id!);
    await expect(page.getByRole("button", { name: "Pleine largeur" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(width).toBeGreaterThan(narrow + 150);
    expect(Math.abs((await width()) - wide)).toBeLessThan(40);
  });

  test("pied de note : « N mots · M min » cohérent avec le texte, et il suit la frappe", async ({ page }) => {
    const [, short] = await seedAndOpen(page, [
      { title: "Long texte", body: Array.from({ length: 400 }, () => "mot").join(" ") },
      { title: "Court texte", body: "un deux trois" },
    ]);
    await expect(page.getByText("400 mots · 2 min", { exact: true })).toBeVisible();

    await openNote(page, short!);
    await expect(page.getByText("3 mots · 1 min", { exact: true })).toBeVisible();
    await page.locator(".bn-editor .bn-block-content").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" quatre cinq");
    await expect(page.getByText("5 mots · 1 min", { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test("/date insère la date du jour en français", async ({ page }) => {
    await seedAndOpen(page, [{ title: "Dates", body: "Début" }]);
    await page.locator(".bn-editor .bn-block-content").first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/date");
    await page.getByRole("option", { name: /^Date du jour/ }).click();
    const today = new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
    await expect(page.locator(".bn-editor")).toContainText(today);
  });

  test("Mod+Maj+C copie le bloc du curseur en Markdown", async ({ page }) => {
    await seedAndOpen(page, [{ title: "Copie", body: "## Section A\n\nPremier **gras** paragraphe\n\n- item de liste" }]);
    await page.locator('.bn-editor [data-content-type="heading"]', { hasText: "Section A" }).click();
    await page.keyboard.press("Control+Shift+C");
    await expect.poll(() => readClipboard(page)).toBe("## Section A");

    await page.locator(".bn-editor p", { hasText: "Premier" }).click();
    await page.keyboard.press("Control+Shift+C");
    await expect.poll(() => readClipboard(page)).toBe("Premier **gras** paragraphe");
  });

  test("replier une section masque les blocs suivants jusqu'au prochain titre, et survit au rechargement", async ({ page }) => {
    const [id] = await seedAndOpen(page, [
      { title: "Repli", body: "# Titre un\n\nbloc un\n\nbloc deux\n\n# Titre deux\n\nbloc trois" },
    ]);
    const editor = page.locator(".bn-editor");
    await editor.locator('[data-content-type="heading"]', { hasText: "Titre un" }).hover();
    await page.getByRole("button", { name: "Replier la section" }).first().click();
    await expect(editor.getByText("bloc un")).toBeHidden();
    await expect(editor.getByText("bloc deux")).toBeHidden();
    await expect(editor.getByText("bloc trois")).toBeVisible();
    await expect(page.getByRole("button", { name: "Déplier la section (2 blocs masqués)" })).toHaveAttribute("aria-expanded", "false");

    await openNote(page, id!);
    await expect(editor.getByText("bloc un")).toBeHidden();
    await expect(editor.getByText("bloc trois")).toBeVisible();
    await page.getByRole("button", { name: "Déplier la section (2 blocs masqués)" }).click();
    await expect(editor.getByText("bloc un")).toBeVisible();
    await expect(editor.getByText("bloc deux")).toBeVisible();
  });

  test("coller une URL seule crée un lien, puis le texte devient le titre de la page (unfurl mocké)", async ({ page }) => {
    const url = "https://exemple.test/article";
    const asked: string[] = [];
    await page.route("**/api/unfurl*", async (route) => {
      asked.push(new URL(route.request().url()).searchParams.get("url") ?? "");
      // Réponse tardive : laisse observer le lien tel que collé, avant le remplacement.
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.fulfill({ json: { title: "Titre mocké" } });
    });
    await seedAndOpen(page, [{ title: "Collage", body: "Voici :" }]);
    const editor = page.locator(".bn-editor");
    await editor.locator(".bn-block-content").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" ");
    await editor.evaluate((el, text) => {
      const data = new DataTransfer();
      data.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, url);

    const link = editor.locator(`a[href="${url}"]`);
    await expect(link).toHaveText(url);
    await expect(link).toHaveText("Titre mocké");
    expect(asked).toEqual([url]);
  });

  test("Ctrl+K sans saisie liste les notes récentes ; Ctrl+Alt+← revient à la note précédente", async ({ page }) => {
    const ids = await seedAndOpen(page, [
      { title: "Note A", body: "premier" },
      { title: "Note B", body: "deuxième" },
      { title: "Note C", body: "troisième" },
    ]);
    await openNote(page, ids[1]!);
    await openNote(page, ids[2]!);

    await page.keyboard.press("Control+k");
    const palette = page.locator("[cmdk-root]");
    await expect(palette.getByText("Récents", { exact: true })).toBeVisible();
    // Dans le groupe : l'aperçu de l'élément présélectionné répète son titre.
    const recents = palette.getByLabel("Récents");
    await expect(recents.getByText("Note B", { exact: true })).toBeVisible();
    await expect(recents.getByText("Note A", { exact: true })).toBeVisible();
    // La note courante n'est pas proposée.
    await expect(palette.getByText("Note C", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);

    // Focus dans l'éditeur : c'est là qu'on écrit.
    await page.locator(".bn-editor .bn-block-content").first().click();
    await page.keyboard.press("Control+Alt+ArrowLeft");
    await expect(page).toHaveURL(new RegExp(`/notes/${ids[1]}$`));
    await expect(page.getByLabel("Titre de la note")).toHaveValue("Note B");
    await page.keyboard.press("Control+Alt+ArrowLeft");
    await expect(page).toHaveURL(new RegExp(`/notes/${ids[2]}$`));
  });
});

/** Distance entre le haut du titre et le haut de la zone de défilement de la note (celle qui porte l'éditeur). */
function headingOffset(page: Page, name: string): Promise<number> {
  return page.evaluate((n) => {
    const sc = document.querySelector(".bn-editor")!.closest(".overflow-y-auto")!;
    const h = [...document.querySelectorAll('.bn-editor [data-content-type="heading"]')].find((el) => el.textContent?.includes(n));
    return h ? h.getBoundingClientRect().top - sc.getBoundingClientRect().top : Number.NaN;
  }, name);
}

/** Fait défiler pour que le titre soit à `offset` px du haut de la zone de texte. */
async function scrollHeadingToTop(page: Page, name: string, offset: number): Promise<void> {
  const delta = (await headingOffset(page, name)) - offset;
  await page.evaluate((d) => {
    document.querySelector(".bn-editor")!.closest(".overflow-y-auto")!.scrollBy({ top: d });
  }, delta);
}

/** Titre qui contient la sélection (curseur), ou null. */
function selectedHeading(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const node = getSelection()?.anchorNode;
    const h = (node instanceof Element ? node : node?.parentElement)?.closest('[data-content-type="heading"]');
    return h?.textContent?.replace(/[›\s]+$/, "") ?? null;
  });
}

const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText()).then((t) => t.trim());

test.describe("20 — QoL notes (mobile)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  const horizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  /** Loupe de la barre « Plan » (hors barre d'outils de la note). */
  const floatingLoupe = (page: Page) =>
    page.locator('xpath=//button[@aria-label="Rechercher dans la note"][not(ancestor::*[@id="note-meta-bar"])]');

  test("la loupe flottante reste atteignable au doigt quand le curseur est dans le premier bloc", async ({ page }) => {
    await seedAndOpen(page, [{ title: "Savane", body: LONG_BODY }]);
    const loupe = floatingLoupe(page);
    await expect(loupe).toBeVisible();
    const box = await loupe.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(32);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(32);
    await loupe.tap();
    await expect(page.getByRole("search")).toBeVisible();
  });

  test("recherche au toucher : compteur, suivant, repères et pastille #TODO dans la minimap", async ({ page }) => {
    await seedAndOpen(page, [{ title: "Savane", body: LONG_BODY }]);
    const loupe = floatingLoupe(page);
    await page.getByRole("button", { name: "Afficher les outils de la note" }).tap();
    await page.locator('#note-meta-bar button[aria-label="Rechercher dans la note"]').tap();

    const search = page.getByRole("search");
    await expect(search).toBeVisible();
    const sbox = await search.boundingBox();
    expect((sbox?.x ?? -1) + (sbox?.width ?? 0)).toBeLessThanOrEqual(390);
    await search.getByLabel("Rechercher dans la note").fill("zebre");
    const counter = search.locator("[aria-live=polite]");
    await expect(counter).toHaveText("1/3");
    await search.getByRole("button", { name: "Résultat suivant" }).tap();
    await expect(counter).toHaveText("2/3");
    await expect.poll(() => minimapInk(page, "find", "any")).toBeGreaterThan(0);
    await expect.poll(() => minimapInk(page, "main", "amber")).toBeGreaterThan(0);

    await search.getByRole("button", { name: "Fermer la recherche" }).tap();
    await expect(search).toHaveCount(0);
    await expect(loupe).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("le plan s'ouvre en feuille, toucher un titre y mène ; le pied de note tient sans débordement", async ({ page }) => {
    await seedAndOpen(page, [{ title: "Plan", body: LONG_BODY }]);
    await page.getByRole("button", { name: "Afficher les outils de la note" }).tap();
    await page.getByRole("button", { name: "Plan", exact: true }).tap();

    const gamma = page.getByRole("button", { name: "Gamma", exact: true });
    await expect(gamma).toBeVisible();
    const row = await gamma.boundingBox();
    expect(row?.height ?? 0).toBeGreaterThanOrEqual(32);
    await gamma.tap();
    await expect(gamma).toHaveCount(0);
    await expect.poll(() => headingOffset(page, "Gamma")).toBeGreaterThan(30);
    await expect.poll(() => headingOffset(page, "Gamma")).toBeLessThan(70);

    await page.evaluate(() => {
      const sc = document.querySelector(".bn-editor")!.closest(".overflow-y-auto")!;
      sc.scrollTop = sc.scrollHeight;
    });
    await expect(page.getByText(/ mots · \d+ min$/).first()).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });

  test("la loupe du haut de /notes liste les Récents ; « Note précédente » ramène à la note précédente", async ({ page }) => {
    const ids = await seedAndOpen(page, [
      { title: "Note A", body: "premier" },
      { title: "Note B", body: "deuxième" },
    ]);
    await openNote(page, ids[1]!);

    // Une page de note n'a pas de loupe dans l'en-tête (flèche retour) : la palette s'ouvre depuis /notes.
    await page.goto("/notes");
    await page.getByRole("button", { name: "Recherche", exact: true }).tap();
    const palette = page.locator("[cmdk-root]");
    await expect(palette.getByText("Récents", { exact: true })).toBeVisible();
    const recents = palette.getByLabel("Récents");
    await expect(recents.getByText("Note A", { exact: true })).toBeVisible();
    await expect(recents.getByText("Note B", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);

    await openNote(page, ids[1]!);
    await page.getByRole("button", { name: "Note précédente" }).tap();
    await expect(page).toHaveURL(new RegExp(`/notes/${ids[0]}$`));
    await expect(page.getByLabel("Titre de la note")).toHaveValue("Note A");
  });
});
