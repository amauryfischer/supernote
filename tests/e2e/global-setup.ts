import { chromium, type FullConfig, type Page } from "@playwright/test";
import { bootCloud, bootDegraded, NAV_ROUTES } from "./helpers";

// Routes lazy-loadées (react-router `lazy: () => import(...)`) : sur un
// serveur Vite froid, le premier accès dépasse le timeout d'expect (5 s) ou
// même de test (60 s, 04-agenda). Vite cache le module compilé ensuite —
// un passage ici avant les tests suffit pour toute la suite.
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL as string | undefined;
  if (!baseURL) return;

  const browser = await chromium.launch();

  const warm = async (page: Page, path: string, ready: () => Promise<unknown>) => {
    try {
      await page.goto(`${baseURL}${path}`, { timeout: 60_000 });
      await ready();
    } catch (err) {
      // Best effort : une route cassée sera signalée par les tests qui la couvrent.
      console.warn(`[warmup] ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const degraded = await browser.newContext();
  const degradedPage = await degraded.newPage();
  await bootDegraded(degradedPage);
  await warm(degradedPage, "/dev/writing-surface", () =>
    degradedPage.locator(".writing-surface-root").waitFor({ timeout: 60_000 }),
  );
  for (const route of NAV_ROUTES) {
    await warm(degradedPage, route.path, () =>
      degradedPage.getByRole("heading", { name: route.heading }).first().waitFor({ timeout: 60_000 }),
    );
  }
  await degraded.close();

  // Coffre cloud : worker SQLite/OPFS distinct du mode dégradé (04-agenda).
  const cloud = await browser.newContext();
  const cloudPage = await cloud.newPage();
  await bootCloud(cloudPage);
  await warm(cloudPage, "/todos", () => cloudPage.getByRole("heading", { name: "Todos" }).first().waitFor({ timeout: 60_000 }));
  // Sans compte Google connecté, l'agenda affiche l'état "connecte d'abord ton compte" (page.tsx).
  await warm(cloudPage, "/agenda", () =>
    cloudPage.getByRole("heading", { name: "Connecte d'abord ton compte Google" }).first().waitFor({ timeout: 60_000 }),
  );
  await cloud.close();

  await browser.close();
}
