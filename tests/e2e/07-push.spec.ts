import { test, expect } from "@playwright/test";
import { bootDegraded } from "./helpers";

// Le headless shell refuse showNotification dans le SW ; le Chromium complet l'accepte.
test.use({ channel: "chromium" });

interface Registration {
  registrationId: string;
  scopeURL: string;
  isDeleted: boolean;
}

test.describe("07 — notifications push", () => {
  test("le SW affiche toujours le push et le relaie à la fenêtre visible", async ({ page, context }) => {
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
    const deliver = (payload: Record<string, string>) =>
      cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId, data: JSON.stringify(payload) });

    // Démarrage à froid de Vite : attendre que la coquille (et donc
    // AutomationNotificationBridge, monté dans RootLayout) soit rendue avant
    // de livrer le push — sinon le postMessage part avant que l'écouteur
    // React ne soit attaché et se perd (postMessage n'est pas rejouable).
    await expect(page.getByText("vault · aucun changement")).toBeVisible({ timeout: 30000 });

    await deliver({ title: "Pas de réponse", body: "Devis mairie de Lyon", url: "/mail?thread=t1", tag: "followup:t1", joinUrl: "" });
    await page.getByRole("button", { name: "Ouvrir le centre de notifications" }).click();
    await expect(page.getByText("Devis mairie de Lyon")).toBeVisible();

    await page.goto("about:blank");
    await deliver({
      title: "Dans 10 min · 14:00",
      body: "Point équipe",
      url: "//evil.example/x",
      tag: "event:primary:ev1",
      joinUrl: "https://meet.google.com/abc-defg-hij",
    });
    const sw = context.serviceWorkers()[0]!;
    await expect
      .poll(() =>
        sw.evaluate(async () => {
          const reg = (globalThis as unknown as { registration: ServiceWorkerRegistration }).registration;
          const notifications = await reg.getNotifications();
          // L'ordre de getNotifications() n'est pas garanti par le standard : on trie par tag.
          return notifications
            .map((n) => ({
              title: n.title,
              body: n.body,
              tag: n.tag,
              data: n.data as unknown,
              actions: (n as unknown as { actions: Array<{ action: string }> }).actions.map((a) => a.action),
            }))
            .sort((a, b) => a.tag.localeCompare(b.tag));
        }),
      )
      .toEqual([
        {
          title: "Dans 10 min · 14:00",
          body: "Point équipe",
          tag: "event:primary:ev1",
          data: { url: "/", joinUrl: "https://meet.google.com/abc-defg-hij" },
          actions: ["join"],
        },
        {
          title: "Pas de réponse",
          body: "Devis mairie de Lyon",
          tag: "followup:t1",
          data: { url: "/mail?thread=t1", joinUrl: "" },
          actions: [],
        },
      ]);
  });
});
