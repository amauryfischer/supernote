import { test, expect, type Page } from "@playwright/test";
import { bootCloud, bootDegraded } from "./helpers";

// Le headless shell refuse showNotification dans le SW ; le Chromium complet l'accepte.
test.use({ channel: "chromium" });

interface Registration {
  registrationId: string;
  scopeURL: string;
  isDeleted: boolean;
}

async function createTodo(page: Page, fields: Record<string, unknown>): Promise<string> {
  await page.waitForFunction(() => "__supernoteWorker" in window);
  return page.evaluate(async (todoFields) => {
    const worker = (window as unknown as { __supernoteWorker: Worker }).__supernoteWorker;
    const call = (id: string) =>
      new Promise<{ ok: boolean; result?: { id: string } }>((resolve) => {
        const onMessage = (e: MessageEvent) => {
          if ((e.data as { id?: string } | null)?.id !== id) return;
          worker.removeEventListener("message", onMessage);
          resolve(e.data as { ok: boolean; result?: { id: string } });
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage({ id, type: "mutation", path: "entities.create", input: { typeId: "todo", fields: todoFields } });
      });
    // Le coffre répond « Vault not initialized » tant qu'il n'est pas prêt.
    for (let attempt = 0; attempt < 60; attempt++) {
      const res = await call(`e2e-todo-${attempt}`);
      if (res.ok && res.result) return res.result.id;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("coffre jamais prêt");
  }, fields);
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

  test("un rappel créé part dans les échéances du salon", async ({ page }) => {
    const info = await page.request.get("/api/sync/info");
    const syncReady =
      (info.headers()["content-type"] ?? "").includes("json") &&
      !((await info.json()) as { requiresToken?: boolean }).requiresToken;
    test.skip(!syncReady, "synchro de dev absente ou sous SYNC_TOKEN (apps/web/.env.local)");
    await bootCloud(page);
    await page.addInitScript(() => {
      const configKey = "supernote.onlineSync.config";
      const config = JSON.parse(localStorage.getItem(configKey) ?? "{}") as { enabled?: boolean };
      if (!config.enabled) {
        localStorage.setItem(configKey, JSON.stringify({ ...config, enabled: true, token: "e2e-mot-de-passe" }));
      }
      const settings = JSON.parse(localStorage.getItem("supernote.settings") ?? "{}") as { notifications?: object };
      localStorage.setItem(
        "supernote.settings",
        JSON.stringify({ ...settings, notifications: { ...settings.notifications, pushSubscribed: true } }),
      );
    });
    const schedules: string[] = [];
    await page.route("**/api/push/**", async (route) => {
      if (route.request().method() === "PUT") schedules.push(route.request().postData() ?? "");
      await route.fulfill({ json: { ok: true, accepted: 0 } });
    });
    await page.goto("/todos");
    const todoId = await createTodo(page, {
      text: "Appeler la mairie",
      reminderAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const withTodo = () => schedules.find((b) => b.includes(`"reminder:${todoId}"`));
    await expect.poll(() => Boolean(withTodo()), { timeout: 45_000 }).toBe(true);
    const body = JSON.parse(withTodo()!) as { categories: { reminder: Array<Record<string, unknown>> } };
    expect(body.categories.reminder).toContainEqual(
      expect.objectContaining({ key: `reminder:${todoId}`, title: "Rappel", body: "Appeler la mairie", url: "/todos", joinUrl: "" }),
    );
  });

  test("le réglage tient sur un téléphone de 360 px", async ({ page }) => {
    await bootCloud(page);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/parametres");
    await page.getByRole("button", { name: "Notifications", exact: true }).click();
    await expect(page.getByRole("switch", { name: "Notifications app fermée" })).toBeDisabled();
    await expect(page.getByText("Active la synchronisation en ligne pour recevoir les notifications.")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByRole("button", { name: "Configurer le salon" }).click();
    await expect(page.getByText("Nom du salon")).toBeVisible();
  });
});
