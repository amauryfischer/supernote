import type { Page, Request } from "@playwright/test";

/**
 * Amorce l'app sans sélecteur de dossier ni visite guidée.
 *
 * Le mode dégradé fait tourner le coffre sur un mock localStorage : sans lui,
 * PwaVaultSetup affiche un overlay bloquant et `showDirectoryPicker()` ne peut
 * pas être piloté depuis un test. La persistence RPC y expire, l'édition
 * client fonctionne — c'est ce que ces tests couvrent.
 */
export async function bootDegraded(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("supernote.degraded", "1");
    localStorage.setItem("supernote.onboarding.completed", "true");
    // L'IA est active par défaut : avec un Ollama local, elle renommerait ou rangerait les notes des tests.
    for (const key of ["supernote.ai.autoTitle", "supernote.ai.autoTag", "supernote.ai.margins", "supernote.ai.inboxSort"]) {
      localStorage.setItem(key, "0");
    }
  });
}

const AI_FLAGS = ["supernote.ai.autoTitle", "supernote.ai.autoTag", "supernote.ai.margins", "supernote.ai.inboxSort"];

/**
 * Amorce l'app sur un coffre cloud neuf : vrai worker SQLite sur OPFS, sans
 * serveur de synchro. C'est le seul mode où le miroir mail/agenda, les modèles
 * et tout ce qui passe par le worker tournent réellement.
 *
 * `googleAccount` renseigne un compte Google connecté et remplace GIS par un
 * faux qui rend un jeton tout de suite ; les appels REST se simulent avec
 * `mockGoogleApis`.
 */
export async function bootCloud(page: Page, opts: { googleAccount?: string } = {}): Promise<void> {
  const vaultKey = `e2e${Date.now()}${Math.round(Math.random() * 1e6)}`;
  await page.addInitScript(
    ({ key, account, aiFlags }) => {
      // Garde : un rechargement doit rouvrir le même coffre, pas en créer un autre.
      if (!localStorage.getItem("supernote.cloud")) {
        localStorage.setItem("supernote.cloud", "1");
        localStorage.setItem(
          "supernote.onlineSync.config",
          JSON.stringify({ enabled: false, serverUrl: "", vaultKey: key }),
        );
      }
      localStorage.setItem("supernote.onboarding.completed", "true");
      for (const flag of aiFlags) localStorage.setItem(flag, "0");
      if (!account) return;
      localStorage.setItem(
        "supernote.settings",
        JSON.stringify({
          googleDrive: { clientId: "e2e-client", connectedEmail: account, driveRootFolderId: "" },
          gmail: { connectedEmail: account },
        }),
      );
      (window as unknown as { google: unknown }).google = {
        accounts: {
          oauth2: {
            initTokenClient: (cfg: { scope: string; callback: (r: unknown) => void }) => ({
              requestAccessToken: () =>
                setTimeout(() => cfg.callback({ access_token: "e2e-token", expires_in: 3600, scope: cfg.scope }), 0),
            }),
            revoke: () => undefined,
          },
        },
      };
    },
    { key: vaultKey, account: opts.googleAccount ?? "", aiFlags: AI_FLAGS },
  );
}

/**
 * Intercepte les API REST Google. `handler` rend le corps JSON de la réponse,
 * `undefined` pour un 204. Renvoie le journal des appels (« METHODE chemin »).
 */
export async function mockGoogleApis(
  page: Page,
  handler: (req: Request, url: URL) => unknown | Promise<unknown>,
): Promise<string[]> {
  const calls: string[] = [];
  await page.route("https://www.googleapis.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    calls.push(`${req.method()} ${url.pathname}`);
    const body = await handler(req, url);
    if (body === undefined) await route.fulfill({ status: 204, body: "" });
    else await route.fulfill({ json: body });
  });
  return calls;
}
