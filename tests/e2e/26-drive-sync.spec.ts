import { createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { bootCloud, seedNote, workerCall } from "./helpers";

const FOLDER = "application/vnd.google-apps.folder";

interface MockFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content: string;
  trashed: boolean;
}

/** Drive en mémoire : juste ce que la synchro de dossier appelle. */
class MockDrive {
  files = new Map<string, MockFile>();
  writes: string[] = [];
  private seq = 0;

  add(name: string, parent: string, mimeType = "text/markdown", content = ""): MockFile {
    const f = { id: `f${++this.seq}`, name, mimeType, parents: [parent], content, trashed: false };
    this.files.set(f.id, f);
    return f;
  }

  md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

  view = (f: MockFile) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    ...(f.mimeType === FOLDER ? {} : { md5Checksum: this.md5(f.content) }),
  });

  /** Chemin relatif → fichier, sous `rootId`, hors corbeille. */
  tree(rootId: string, dir = ""): Map<string, MockFile> {
    const out = new Map<string, MockFile>();
    for (const f of this.files.values()) {
      if (f.trashed || !f.parents.includes(rootId)) continue;
      const rel = dir ? `${dir}/${f.name}` : f.name;
      if (f.mimeType === FOLDER) for (const [k, v] of this.tree(f.id, rel)) out.set(k, v);
      else out.set(rel, f);
    }
    return out;
  }

  async install(page: Page): Promise<void> {
    await page.route("https://www.googleapis.com/**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const method = req.method();
      const fileId = /\/files\/([^/?]+)/.exec(url.pathname)?.[1];
      if (!url.pathname.includes("/drive/v3/")) return route.fulfill({ json: {} });
      if (method !== "GET") this.writes.push(`${method} ${url.pathname}`);

      if (method === "GET" && !fileId) {
        const q = url.searchParams.get("q") ?? "";
        const parent = /'([^']+)' in parents/.exec(q)?.[1] ?? "";
        const onlyFolders = q.includes(`mimeType = '${FOLDER}'`);
        const files = [...this.files.values()]
          .filter((f) => !f.trashed && f.parents.includes(parent) && (!onlyFolders || f.mimeType === FOLDER))
          .map(this.view);
        return route.fulfill({ json: { files } });
      }
      if (method === "GET" && fileId && url.searchParams.get("alt") === "media") {
        return route.fulfill({ status: 200, contentType: "text/markdown", body: this.files.get(fileId)?.content ?? "" });
      }
      if (method === "POST" && url.pathname.startsWith("/upload/")) {
        const body = req.postData() ?? "";
        const [, metaPart, contentPart] = body.split(/--supernote-drive-sync\r\n/);
        const meta = JSON.parse((metaPart ?? "").split("\r\n\r\n")[1]?.trim() ?? "{}") as { name: string; parents: string[] };
        const content = (contentPart ?? "").split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n--supernote-drive-sync--$/, "");
        const f = this.add(meta.name, meta.parents[0] ?? "", "text/markdown", content);
        return route.fulfill({ json: { id: f.id, md5Checksum: this.md5(content) } });
      }
      if (method === "POST") {
        const meta = JSON.parse(req.postData() ?? "{}") as { name: string; mimeType: string; parents: string[] };
        return route.fulfill({ json: { id: this.add(meta.name, meta.parents[0] ?? "", meta.mimeType).id } });
      }
      const f = fileId ? this.files.get(fileId) : undefined;
      if (method === "PATCH" && f) {
        if (url.pathname.startsWith("/upload/")) f.content = req.postData() ?? "";
        else {
          const patch = JSON.parse(req.postData() ?? "{}") as { name?: string; trashed?: boolean };
          if (patch.name) f.name = patch.name;
          if (patch.trashed) f.trashed = true;
          const add = url.searchParams.get("addParents");
          if (add) f.parents = [add];
        }
        return route.fulfill({ json: { id: f.id, md5Checksum: this.md5(f.content) } });
      }
      return route.fulfill({ status: 404, json: { error: "mock" } });
    });
  }
}

const lastSync = (page: Page) =>
  page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem("supernote.driveSync.links") ?? "{}") as Record<string, Array<{ lastSyncAt?: number; lastError?: string }>>;
    const link = Object.values(all).flat()[0];
    return { at: link?.lastSyncAt ?? 0, error: link?.lastError ?? null };
  });

async function syncOnce(page: Page): Promise<void> {
  const before = (await lastSync(page)).at;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("supernote:drive-sync-request", { detail: {} })));
  await expect.poll(async () => (await lastSync(page)).at, { timeout: 30_000 }).toBeGreaterThan(before);
  expect((await lastSync(page)).error).toBeNull();
}

const localFiles = (page: Page) =>
  workerCall<Array<{ entityId: string; filePath: string; content: string }>>(page, "query", "driveSync.localFiles", { prefix: "Projets" });

test("26 — synchro d'un dossier avec Drive (Drive simulé)", async ({ page }) => {
  test.setTimeout(240_000);
  const drive = new MockDrive();
  const root = drive.add("SN-test", "root", FOLDER);
  await drive.install(page);
  await bootCloud(page, { googleAccount: "e2e@example.com" });
  await page.addInitScript(() => {
    for (const k of ["crumb", "longtasks", "errors"]) localStorage.removeItem(`sn:freeze:${k}`);
  });
  await page.goto("/notes");
  const alphaId = await seedNote(page, { title: "Alpha", body: "# Alpha\n\nversion 1\n", folder: "Projets" });
  const betaId = await seedNote(page, { title: "Beta", body: "# Beta\n\ntexte\n", folder: "Projets/Sous" });

  // Clic droit sur le dossier → choix de l'emplacement dans le Drive.
  await page.goto("/notes");
  await page.getByText("Projets", { exact: true }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Synchroniser avec Drive…" }).click();
  const browser = page.getByRole("dialog");
  await expect(browser.getByText("Synchroniser « Projets » avec…")).toBeVisible();
  await browser.getByRole("button", { name: "SN-test" }).click();
  await browser.getByRole("button", { name: /Choisir « SN-test »/ }).click();
  await expect(browser).toHaveCount(0);

  // a) envoi initial, sous-dossier recréé
  await expect.poll(() => [...drive.tree(root.id).keys()].sort(), { timeout: 30_000 }).toHaveLength(2);
  const remote = drive.tree(root.id);
  expect([...remote.keys()].some((k) => k.startsWith("Sous/"))).toBe(true);
  await expect.poll(async () => (await lastSync(page)).at).toBeGreaterThan(0);

  // b) deux passes sans changement : aucune écriture
  await syncOnce(page);
  drive.writes = [];
  await syncOnce(page);
  await syncOnce(page);
  expect(drive.writes).toEqual([]);

  // c) modification côté Drive → note mise à jour, puis plus d'écho
  const alphaRemote = [...drive.tree(root.id).entries()].find(([k]) => !k.includes("/"))![1];
  alphaRemote.content = alphaRemote.content.replace("version 1", "version Drive");
  await syncOnce(page);
  const alpha = await workerCall<{ body: string }>(page, "query", "entities.get", { id: alphaId });
  expect(alpha.body).toContain("version Drive");
  drive.writes = [];
  await syncOnce(page);
  expect(drive.writes).toEqual([]);

  // d) .md créé à la main sur Drive, sans frontmatter
  const sous = [...drive.files.values()].find((f) => f.name === "Sous" && f.mimeType === FOLDER)!;
  const fresh = drive.add("nouveau.md", sous.id, "text/markdown", "Écrit depuis Drive\n");
  await syncOnce(page);
  const created = (await localFiles(page)).find((l) => l.content.includes("Écrit depuis Drive"));
  expect(created?.filePath.startsWith("Projets/Sous/")).toBe(true);
  expect(fresh.content.startsWith("---")).toBe(true);
  expect(fresh.content).toMatch(/^id:/m);

  // e) modifiée des deux côtés → copie de conflit, rien d'écrasé
  await workerCall(page, "mutation", "entities.update", { id: alphaId, body: "# Alpha\n\nversion locale\n" });
  const alphaNow = [...drive.files.values()].find((f) => f.id === alphaRemote.id)!;
  alphaNow.content = alphaNow.content.replace("version Drive", "version Drive 2");
  await syncOnce(page);
  const after = await localFiles(page);
  expect(after.some((l) => l.filePath.includes("(conflit Drive") && l.content.includes("version Drive 2"))).toBe(true);
  expect((await workerCall<{ body: string }>(page, "query", "entities.get", { id: alphaId })).body).toContain("version locale");

  // f) supprimée localement → corbeille Drive
  const betaRemote = [...drive.files.values()].find((f) => f.content.includes(betaId))!;
  await workerCall(page, "mutation", "entities.delete", { id: betaId });
  await syncOnce(page);
  expect(betaRemote.trashed).toBe(true);
  // g) repère sur le dossier lié dans l'arbre (navigation sans rechargement : le jeton Drive vit en mémoire)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("g");
  await page.keyboard.press("n");
  await expect(page).toHaveURL(/\/notes/);
  await expect(page.getByRole("img", { name: /Synchronisé avec Drive/ }).first()).toBeVisible();

  // h) Google Doc créé sur Drive → pointeur dans le coffre, ouvert par GDocViewer
  drive.add("Rapport", root.id, "application/vnd.google-apps.document");
  await syncOnce(page);
  const pointers = await workerCall<Array<{ filePath: string }>>(page, "query", "driveSync.localPointers", { prefix: "Projets" });
  expect(pointers.map((p) => p.filePath)).toContain("Projets/Rapport.gdoc");
  drive.writes = [];
  await syncOnce(page);
  expect(drive.writes).toEqual([]);

  // i) « Nouveau Google Docs ici » dans un dossier lié : créé dans le dossier Drive, ouvert dans Supernote
  await page.getByText("Projets", { exact: true }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Nouveau Google Docs ici" }).click();
  const nameInput = page.getByRole("dialog").getByRole("textbox");
  await nameInput.fill("Compte rendu");
  await nameInput.press("Enter");
  await expect(page).toHaveURL(/\/notes\/[^?]+\?folder=Projets/);
  expect([...drive.files.values()].some((f) => f.name === "Compte rendu" && f.parents.includes(root.id))).toBe(true);
  drive.writes = [];
  await syncOnce(page);
  expect(drive.writes).toEqual([]);
});
