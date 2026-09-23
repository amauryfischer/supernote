import { test, expect } from "@playwright/test";
import { bootCloud } from "./helpers";

test.describe("08 — notifications & PWA", () => {
  test("A : le bandeau propose le push, Plus tard le masque", async ({ page }) => {
    // /mail exige Gmail connecté (useGmailConnected) et un salon protégé
    // (pushAvailability n'est "ok" que jeton présent).
    await bootCloud(page, { googleAccount: "e2e@example.com", password: "e2e-pass" });
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
