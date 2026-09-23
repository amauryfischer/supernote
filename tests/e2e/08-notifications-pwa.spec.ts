import { test, expect } from "@playwright/test";
import { bootCloud } from "./helpers";

test.describe("08 — notifications & PWA", () => {
  test("A : le bandeau propose le push, Plus tard le masque", async ({ page }) => {
    // /mail exige Gmail connecté (useGmailConnected) et un salon protégé
    // (pushAvailability n'est "ok" qu'avec un jeton).
    await bootCloud(page, { googleAccount: "e2e@example.com", password: "e2e-pass" });
    // Sandbox sans service de notification système (pas de démon D-Bus) :
    // Chromium fige Notification.permission à "denied" quoi qu'on fasse côté
    // Permissions API/CDP, alors qu'un vrai poste démarre à "default". On
    // simule cet état de départ légitime pour tester le bandeau.
    await page.addInitScript(() => {
      Object.defineProperty(Notification, "permission", { value: "default", configurable: true });
    });
    await page.route("https://gmail.googleapis.com/**", (route) => {
      const path = new URL(route.request().url()).pathname.replace("/gmail/v1/users/me", "");
      if (path === "/threads") return route.fulfill({ json: { threads: [] } });
      if (path === "/profile") return route.fulfill({ json: { emailAddress: "e2e@example.com", historyId: "1" } });
      if (path.startsWith("/labels/")) return route.fulfill({ json: { id: "INBOX", threadsTotal: 0, threadsUnread: 0 } });
      if (path === "/labels") return route.fulfill({ json: { labels: [] } });
      return route.fulfill({ json: {} });
    });
    await page.route("https://www.googleapis.com/**", (route) => route.fulfill({ json: { items: [] } }));

    await page.goto("/mail");
    const banner = page.getByRole("region", { name: "Notifications" });
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Plus tard" }).click();
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(page.getByRole("region", { name: "Notifications" })).toBeHidden();
  });
});
