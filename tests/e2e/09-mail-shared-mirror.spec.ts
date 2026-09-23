import { test, expect, type Page } from "@playwright/test";
import { bootCloud, MESSAGE } from "./helpers";

const ACCOUNT = "moi@exemple.fr";
const SUBJECT = "Compte rendu réunion";

/** Mock Gmail d'un fil ; `down` simule Gmail injoignable. Renvoie le journal des chemins. */
async function mockGmail(page: Page, state: { down: boolean }): Promise<string[]> {
  const calls: string[] = [];
  await page.route("https://gmail.googleapis.com/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/gmail/v1/users/me", "");
    calls.push(path);
    if (state.down) return route.fulfill({ status: 503, body: "" });
    if (path === "/threads") return route.fulfill({ json: { threads: [{ id: "t1", snippet: MESSAGE.snippet }] } });
    if (path.startsWith("/threads/")) return route.fulfill({ json: { id: "t1", historyId: "10", messages: [MESSAGE] } });
    if (path === "/profile") return route.fulfill({ json: { emailAddress: ACCOUNT, historyId: "10" } });
    if (path === "/history") return route.fulfill({ json: { historyId: "10" } });
    if (path.startsWith("/labels/")) return route.fulfill({ json: { id: "INBOX", threadsTotal: 1, threadsUnread: 1 } });
    if (path === "/labels") return route.fulfill({ json: { labels: [] } });
    return route.fulfill({ json: {} });
  });
  await page.route("https://www.googleapis.com/**", (route) => route.fulfill({ json: { items: [] } }));
  return calls;
}

test.describe("09 — miroir mail partagé", () => {
  test("un second appareil reçoit la boîte par le salon protégé sans relire les fils", async ({ browser }) => {
    test.setTimeout(240_000);
    const vaultKey = `e2email${Date.now()}`;
    const opts = { googleAccount: ACCOUNT, password: "e2e-pass", vaultKey };

    const a = await (await browser.newContext()).newPage();
    await bootCloud(a, opts);
    await mockGmail(a, { down: false });
    await a.goto("/mail");
    await expect(a.getByText(SUBJECT).first()).toBeVisible({ timeout: 60_000 });

    // B démarre avec Gmail injoignable : ce qu'il affiche ne peut venir que du salon.
    const b = await (await browser.newContext()).newPage();
    await bootCloud(b, opts);
    const gmailB = { down: true };
    const callsB = await mockGmail(b, gmailB);
    // Pas de rechargement en boucle : un premier démarrage interrompu réinitialise la base.
    await b.goto("/mail");
    await expect(b.getByText(SUBJECT).first()).toBeVisible({ timeout: 90_000 });

    // Gmail revient : B part du curseur reçu, une lecture d'historique suffit.
    gmailB.down = false;
    callsB.length = 0;
    await b.reload();
    await expect(b.getByText(SUBJECT).first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => callsB.includes("/history"), { timeout: 30_000 }).toBe(true);
    expect(callsB.filter((p) => p.startsWith("/threads"))).toEqual([]);
  });
});
