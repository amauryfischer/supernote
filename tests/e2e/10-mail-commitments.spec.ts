import { test, expect, type Page } from "@playwright/test";
import { bootCloud, MESSAGE } from "./helpers";

const BODY =
  "Bonjour,\n\nMerci pour l'échange. Je vous envoie le devis signé vendredi 2 octobre.\n\nAlice";

function message(id: string, body: string) {
  return {
    ...MESSAGE,
    id,
    payload: {
      ...MESSAGE.payload,
      headers: MESSAGE.payload.headers.map((h) => (h.name === "Subject" ? { ...h, value: "Devis Acme" } : h)),
      body: { size: body.length, data: Buffer.from(body, "utf8").toString("base64url") },
    },
    snippet: "Je vous envoie le devis signé vendredi",
  };
}

async function withPromiseInbox(page: Page, engagements: unknown[]): Promise<void> {
  await bootCloud(page, { googleAccount: "moi@exemple.fr" });
  // bootCloud coupe les flags IA : on réactive celui-ci et on configure Ollama.
  await page.addInitScript(() => {
    localStorage.setItem("supernote.ai.commitments", "1");
    const s = JSON.parse(localStorage.getItem("supernote.settings") ?? "{}");
    s.ia = { ...(s.ia ?? {}), ollamaModel: "qwen3.5:4b" };
    localStorage.setItem("supernote.settings", JSON.stringify(s));
  });
  const msg = message("m1", BODY);
  await page.route("https://gmail.googleapis.com/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/gmail/v1/users/me", "");
    if (path === "/threads") return route.fulfill({ json: { threads: [{ id: "t1", snippet: msg.snippet }] } });
    if (path.startsWith("/threads/")) return route.fulfill({ json: { id: "t1", historyId: "10", messages: [msg] } });
    if (path.startsWith("/messages/")) return route.fulfill({ json: msg });
    if (path === "/profile") return route.fulfill({ json: { emailAddress: "moi@exemple.fr", historyId: "10" } });
    if (path.startsWith("/labels/")) return route.fulfill({ json: { id: "INBOX", threadsTotal: 1, threadsUnread: 1 } });
    if (path === "/labels") return route.fulfill({ json: { labels: [] } });
    return route.fulfill({ json: {} });
  });
  await page.route("https://www.googleapis.com/**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("http://127.0.0.1:11434/**", (route) =>
    route.fulfill({ json: { response: JSON.stringify({ engagements }), done: true } }),
  );
}

test.describe("10 — engagements mail", () => {
  test("une promesse reçue devient une relance ; une citation inventée est rejetée", async ({ page }) => {
    await withPromiseInbox(page, [
      { message: 1, direction: "eux", text: "Envoyer le devis signé", due: "2026-10-02", quote: "Je vous envoie le devis signé vendredi 2 octobre." },
      { message: 1, direction: "eux", text: "Appeler demain", due: null, quote: "Je vous appelle demain sans faute." },
    ]);
    await page.goto("/mail");
    await page.getByText("Devis Acme").first().click();

    const banner = page.getByRole("region", { name: "Engagements" });
    await expect(banner).toContainText("Envoyer le devis signé", { timeout: 20_000 });
    await expect(banner).toContainText("On me doit");
    await expect(banner).not.toContainText("Appeler demain");

    await banner.getByRole("button", { name: "Suivre : relance à l'échéance" }).click();
    await expect(banner).toBeHidden();
    const followups = await page.evaluate(() => localStorage.getItem("supernote.mail.followups") ?? "");
    expect(followups).toContain("t1");
  });

  test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("aucune détection d'engagements sur mobile", async ({ page }) => {
      const calls: string[] = [];
      await withPromiseInbox(page, []);
      page.on("request", (r) => {
        // Les réponses rapides existantes appellent déjà Ollama sur mobile : on ne compte que la détection.
        if (r.url().startsWith("http://127.0.0.1:11434") && (r.postData() ?? "").includes("ENGAGEMENTS")) calls.push(r.url());
      });
      await page.goto("/mail");
      await page.getByText("Devis Acme").first().click();
      await page.waitForTimeout(2_000);
      expect(calls).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
});
