import { test, expect } from "@playwright/test";
import { bootCloud, bootDegraded, withInbox } from "./helpers";

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

  test("C : /mail?compose=1 ouvre la composition", async ({ page }) => {
    await withInbox(page);
    await page.goto("/mail?compose=1");
    await expect(page.getByRole("dialog", { name: "Nouveau message" })).toBeVisible();
    await expect(page).toHaveURL(/\/mail$/);
  });

  test("C : /mail?new=note crée une note Inbox", async ({ page }) => {
    await bootCloud(page);
    await page.goto("/mail?new=note");
    await expect(page).toHaveURL(/\/notes\//, { timeout: 20_000 });
  });

  test("C : un partage crée une note Inbox", async ({ page }) => {
    await bootCloud(page);
    await page.goto("/mail");
    await page.evaluate(async () => {
      const cache = await caches.open("share-inbox");
      await cache.put(
        "/share-target/pending",
        new Response(
          JSON.stringify({ title: "Article partagé", text: "à lire", url: "https://example.com", files: [] }),
        ),
      );
    });
    await page.goto("/partage?pending=1");
    await expect(page).toHaveURL(/\/notes\//, { timeout: 20_000 });
    await expect(page.getByLabel("Titre de la note")).toHaveValue("Article partagé");
  });

  test("C : /mail?thread=X&action=archive archive sans ouvrir le fil", async ({ page }) => {
    await withInbox(page);
    const modifyCalls: { threadId: string; removeLabelIds: string[] }[] = [];
    // Route plus spécifique enregistrée après withInbox : Playwright l'essaie en premier.
    await page.route("https://gmail.googleapis.com/gmail/v1/users/me/threads/*/modify", async (route) => {
      const threadId = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
      const body = route.request().postDataJSON() as { removeLabelIds?: string[] } | null;
      modifyCalls.push({ threadId, removeLabelIds: body?.removeLabelIds ?? [] });
      await route.fulfill({ json: {} });
    });
    await page.goto("/mail?thread=t1&action=archive");
    await expect(page).toHaveURL(/\/mail$/);
    await expect
      .poll(() => modifyCalls.some((c) => c.threadId === "t1" && c.removeLabelIds.includes("INBOX")))
      .toBe(true);
  });
});

test.describe("08 — push mail sans jeton (SW)", () => {
  // Le headless shell refuse showNotification dans le SW ; le Chromium complet l'accepte.
  test.use({ channel: "chromium" });

  interface Registration {
    registrationId: string;
    scopeURL: string;
    isDeleted: boolean;
  }

  test("notification générique + badge quand IndexedDB n'a pas de jeton Gmail", async ({ page, context }) => {
    await bootDegraded(page);
    await context.grantPermissions(["notifications"]);
    await page.goto("/");
    const origin = new URL(page.url()).origin;

    const cdp = await context.newCDPSession(page);
    const registrations: Registration[] = [];
    cdp.on("ServiceWorker.workerRegistrationUpdated", (e: { registrations: Registration[] }) => {
      registrations.push(...e.registrations);
    });
    await cdp.send("ServiceWorker.enable");
    // En dev, registerServiceWorker ne fait rien : on enregistre le SW brut de public/.
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
    });
    const live = () => registrations.find((r) => !r.isDeleted && r.scopeURL.startsWith(origin));
    await expect.poll(() => Boolean(live())).toBe(true);
    const registrationId = live()!.registrationId;

    // Démarrage à froid de Vite : attendre le rendu de la coquille avant de livrer le push.
    await expect(page.getByText("vault · aucun changement")).toBeVisible({ timeout: 30000 });

    await cdp.send("ServiceWorker.deliverPushMessage", {
      origin,
      registrationId,
      data: JSON.stringify({ kind: "mail", historyId: "1", title: "Nouveau mail" }),
    });

    const sw = context.serviceWorkers()[0]!;
    await expect
      .poll(() =>
        sw.evaluate(async () => {
          const reg = (globalThis as unknown as { registration: ServiceWorkerRegistration }).registration;
          const notifications = await reg.getNotifications();
          return notifications.map((n) => n.title);
        }),
      )
      .toContain("Du nouveau dans ta boîte");
  });
});
