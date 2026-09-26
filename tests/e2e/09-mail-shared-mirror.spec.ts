import { test, expect, type Page } from "@playwright/test";
import { bootCloud, MESSAGE, parseGmailBatchRequestBody, buildGmailBatchResponse } from "./helpers";

const ACCOUNT = "moi@exemple.fr";
const SUBJECT = "Compte rendu réunion";

/** Réponse JSON pour un chemin Gmail relatif — GET direct ou sous-requête d'un lot batch. */
function resolveGmailPath(path: string): unknown {
  if (path === "/threads") return { threads: [{ id: "t1", snippet: MESSAGE.snippet }] };
  if (path.startsWith("/threads/")) return { id: "t1", historyId: "10", messages: [MESSAGE] };
  if (path === "/profile") return { emailAddress: ACCOUNT, historyId: "10" };
  if (path === "/history") return { historyId: "10" };
  if (path.startsWith("/labels/")) return { id: "INBOX", threadsTotal: 1, threadsUnread: 1 };
  if (path === "/labels") return { labels: [] };
  return {};
}

/**
 * Mock Gmail d'un fil ; `down` simule Gmail injoignable. Renvoie le journal des
 * chemins — pour un lot batch, une entrée par SOUS-requête (pas le chemin
 * `/batch/gmail/v1` lui-même), pour garder la granularité que le test vérifie.
 */
async function mockGmail(page: Page, state: { down: boolean }): Promise<string[]> {
  const calls: string[] = [];
  await page.route("https://gmail.googleapis.com/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/batch/gmail/v1") {
      const items = parseGmailBatchRequestBody(route.request().postData() ?? "");
      for (const it of items) calls.push(it.path);
      if (state.down) return route.fulfill({ status: 503, body: "" });
      const { contentType, body } = buildGmailBatchResponse(items, resolveGmailPath);
      return route.fulfill({ status: 200, contentType, body });
    }
    const path = url.pathname.replace("/gmail/v1/users/me", "");
    calls.push(path);
    if (state.down) return route.fulfill({ status: 503, body: "" });
    return route.fulfill({ json: resolveGmailPath(path) });
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
    // Le salon épargne la RELECTURE DE LA LISTE (résumés/metadata, page threads.list) :
    // aucun de ces appels n'est attendu. Le préchargement du corps (format=full,
    // par lot) est le nouveau coût voulu par `prefetchThreadBodies` — les corps ne
    // voyagent pas via le salon — donc autorisé, borné au fil affiché et à 20 fils max.
    const threadCalls = callsB.filter((p) => p.startsWith("/threads"));
    expect(threadCalls.some((p) => p === "/threads" || p.includes("format=metadata"))).toBe(false);
    expect(threadCalls.length).toBeLessThanOrEqual(20);
    for (const p of threadCalls) expect(p).toMatch(/^\/threads\/t1\?.*format=full/);
  });
});
