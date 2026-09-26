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

const AI_FLAGS = ["supernote.ai.autoTitle", "supernote.ai.autoTag", "supernote.ai.margins", "supernote.ai.inboxSort", "supernote.ai.commitments"];

/**
 * Amorce l'app sur un coffre cloud neuf : vrai worker SQLite sur OPFS, sans
 * serveur de synchro. C'est le seul mode où le miroir mail/agenda, les modèles
 * et tout ce qui passe par le worker tournent réellement.
 *
 * `googleAccount` renseigne un compte Google connecté et remplace GIS par un
 * faux qui rend un jeton tout de suite ; les appels REST se simulent avec
 * `mockGoogleApis`.
 *
 * `password` pose un salon protégé (synchro activée, jeton présent) : requis
 * pour que `pushAvailability()` renvoie `ok` (un salon libre ne pousse pas).
 */
export async function bootCloud(
  page: Page,
  opts: { googleAccount?: string; password?: string; vaultKey?: string } = {},
): Promise<void> {
  const vaultKey = opts.vaultKey ?? `e2e${Date.now()}${Math.round(Math.random() * 1e6)}`;
  await page.addInitScript(
    ({ key, account, aiFlags, password }) => {
      // Garde : un rechargement doit rouvrir le même coffre, pas en créer un autre.
      if (!localStorage.getItem("supernote.cloud")) {
        localStorage.setItem("supernote.cloud", "1");
        localStorage.setItem(
          "supernote.onlineSync.config",
          JSON.stringify(
            password
              ? { enabled: true, serverUrl: "", vaultKey: key, token: password }
              : { enabled: false, serverUrl: "", vaultKey: key },
          ),
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
    { key: vaultKey, account: opts.googleAccount ?? "", aiFlags: AI_FLAGS, password: opts.password ?? "" },
  );
}

/** Routes principales de l'app et le titre attendu au premier rendu. */
export const NAV_ROUTES: { path: string; heading: string }[] = [
  { path: "/notes", heading: "Sélectionnez une note ou créez-en une" },
  { path: "/todos", heading: "Todos" },
  { path: "/contacts", heading: "Contacts" },
  { path: "/finance", heading: "Finance" },
  // Mode dégradé : pas de coffre, donc l'état vide de l'agenda.
  { path: "/agenda", heading: "Ouvre un coffre pour utiliser l'agenda" },
  { path: "/carte", heading: "Ouvre un coffre pour voir la carte" },
];

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

const BODY =
  "Bonjour,\n\nVoici le compte rendu de la réunion de ce matin.\n- budget validé\n- planning décalé\n\nAlice";

export const MESSAGE = {
  id: "m1",
  threadId: "t1",
  labelIds: ["INBOX", "UNREAD"],
  snippet: "Voici le compte rendu",
  internalDate: String(Date.now() - 3_600_000),
  historyId: "10",
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: "Alice Dupont <alice@exemple.fr>" },
      { name: "To", value: "moi@exemple.fr" },
      { name: "Subject", value: "Compte rendu réunion" },
      { name: "Date", value: new Date().toUTCString() },
      { name: "Message-ID", value: "<m1@exemple.fr>" },
    ],
    body: { size: BODY.length, data: Buffer.from(BODY, "utf8").toString("base64url") },
  },
};

/** Réponse JSON attendue pour un chemin Gmail relatif — GET direct ou sous-requête d'un lot batch. */
function resolveInboxPath(path: string): unknown {
  if (path === "/threads") return { threads: [{ id: "t1", snippet: MESSAGE.snippet }] };
  if (path.startsWith("/threads/")) return { id: "t1", historyId: "10", messages: [MESSAGE] };
  if (path.startsWith("/messages/")) return MESSAGE;
  if (path === "/profile") return { emailAddress: "moi@exemple.fr", historyId: "10" };
  if (path.startsWith("/labels/")) return { id: "INBOX", threadsTotal: 1, threadsUnread: 1 };
  if (path === "/labels") return { labels: [] };
  return {};
}

/**
 * Sous-requêtes (`{ id, path }`) d'un corps `multipart/mixed` de batch Gmail
 * (POST `/batch/gmail/v1`). Exporté : chaque mock Gmail qui pose sa propre
 * route (09, 10) en a besoin pour répondre à l'endpoint batch.
 */
export function parseGmailBatchRequestBody(body: string): Array<{ id: string; path: string }> {
  const out: Array<{ id: string; path: string }> = [];
  for (const part of body.split(/--\S+/)) {
    const idMatch = /Content-ID:\s*<([^>]+)>/i.exec(part);
    const pathMatch = /GET\s+\/gmail\/v1\/users\/me(\S*)\s+HTTP/i.exec(part);
    if (idMatch && pathMatch) out.push({ id: idMatch[1]!, path: pathMatch[1]! });
  }
  return out;
}

/**
 * Réponse `multipart/mixed` d'un lot Gmail batch, une sous-réponse 200 par
 * sous-requête reçue. `resolve` rend le JSON pour un chemin relatif donné
 * (même résolveur que les routes GET directes du mock appelant).
 */
export function buildGmailBatchResponse(
  items: Array<{ id: string; path: string }>,
  resolve: (path: string) => unknown,
): { contentType: string; body: string } {
  const boundary = "e2e_batch_boundary";
  const parts = items.map(
    ({ id, path }) =>
      `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <response-${id}>\r\n\r\n` +
      `HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(resolve(path))}\r\n`,
  );
  return { contentType: `multipart/mixed; boundary=${boundary}`, body: parts.join("") + `--${boundary}--` };
}

/** Boîte Gmail d'un seul fil ; Agenda et Drive vides. */
export async function withInbox(page: Page): Promise<void> {
  await bootCloud(page, { googleAccount: "moi@exemple.fr" });
  await page.route("https://gmail.googleapis.com/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/batch/gmail/v1") {
      const { contentType, body } = buildGmailBatchResponse(
        parseGmailBatchRequestBody(route.request().postData() ?? ""),
        resolveInboxPath,
      );
      return route.fulfill({ status: 200, contentType, body });
    }
    return route.fulfill({ json: resolveInboxPath(url.pathname.replace("/gmail/v1/users/me", "")) });
  });
  await page.route("https://www.googleapis.com/**", (route) => route.fulfill({ json: { items: [] } }));
}

/** Crée une note dans un coffre cloud neuf, lui donne un titre, attend l'éditeur prêt. */
export async function openNewNote(page: Page, title: string): Promise<void> {
  await bootCloud(page);
  await page.goto("/notes");
  // Correspondance partielle : "Nouvelle note" matche aussi "Nouvelle note depuis un modèle" du TopBar.
  await page.getByRole("button", { name: "Nouvelle note", exact: true }).first().click();
  await page.locator(".bn-editor").first().waitFor();
  await page.getByLabel("Titre de la note").fill(title);
}
