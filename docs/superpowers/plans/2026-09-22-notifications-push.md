# Notifications push — plan d'implémentation

> **Pour les agents :** exécuter tâche par tâche (superpowers:subagent-driven-development). Étapes en cases `- [ ]`.

**Objectif :** être prévenu sur le téléphone ou l'ordinateur même Supernote fermé : rappel de todo, début d'événement ou de bloc de tâche, relance mail échue, fil reporté qui revient.

**Architecture :** chaque appareil abonné calcule ses échéances des 7 prochains jours (`PushScheduleRunner`, route worker `push.upcoming`, `localStorage` mail) et les envoie au serveur (`PUT /api/push/schedule`), rattachées à son salon de synchro. `server.mjs` monte `push-backend.mjs` (stockage `push-store.mjs`, SQLite ou Postgres) qui réserve atomiquement les échéances dues toutes les 30 s et les pousse en Web Push VAPID (`web-push`) à tous les abonnements du salon. Le service worker affiche toujours la notification (Safari révoque la permission d'un push sans notification) et, si une fenêtre Supernote est visible, la relaie aussi au tiroir in-app.

**Stack :** Node 22 (`server.mjs` sans dépendance hors `DATABASE_URL`), `web-push` 3.6.7, better-sqlite3 / pg, service worker `public/sw.js` (injectManifest), React 19 + HeroUI v3 via `@supernote/ui`, tRPC (`@supernote/ipc`, zod v4) vers le worker SQLite wasm, Playwright 1.59.1 (canal `chromium`).

**Spec :** docs/superpowers/specs/2026-09-22-notifications-push-design.md

## Contraintes globales

- Payload push (serveur → SW), JSON figé : `{ "title": string, "body": string, "url": string, "tag": string, "joinUrl": string }` ; `tag` = `key` de l'échéance ; `joinUrl` = `""` sans Meet.
- Message SW → page : `client.postMessage({ type: "PUSH_RECEIVED", payload })`, `payload` au format ci-dessus.
- Notification système : `showNotification(title, { body, tag, icon: "/icons/icon-192.png", data: { url, joinUrl }, actions: joinUrl ? [{ action: "join", title: "Rejoindre" }] : [] })`.
- `GET /api/push/key` → `200 { "publicKey": string }`.
- `POST /api/push/subscribe?vault=<clé>` (en-tête `x-sync-token`), corps `{ "deviceId": string, "subscription": { "endpoint": "https://…", "keys": { "p256dh": string, "auth": string } } }` → `200 { "ok": true }` | `400` | `401 { "error": "unauthorized" }` | `403 { "error": "vault not protected" }`.
- `POST /api/push/unsubscribe`, corps `{ "endpoint": string }`, sans authentification → `200 { "ok": true }`.
- `PUT /api/push/schedule?vault=<clé>` (en-tête `x-sync-token`), corps `{ "deviceId": string, "categories": { "reminder"?: Row[], "event"?: Row[], "followup"?: Row[], "snooze"?: Row[] } }` → `200 { "ok": true, "accepted": number }` | `400` | `401` | `403`.
- `Row` = `{ "key": string, "fireAt": number, "title": string, "body": string, "url": string, "joinUrl": string }`.
- Clés : `reminder:<todoId>`, `event:<calendarId>:<eventId>`, `followup:<threadId>`, `snooze:<threadId>` ; le serveur exige le préfixe `<catégorie>:`.
- Catégories partagées `reminder`, `event` : un envoi remplace les lignes non envoyées **du salon** ; locales `followup`, `snooze` : celles **du salon et de l'appareil** ; seules les catégories présentes sont remplacées.
- Validation `schedule` : `url` commence par `/` et se résout sur l'origine (rejette `//…`, `/\…`, `/\t/…`) ; `joinUrl` vide ou `https://` ; `title` tronqué à 120, `body` à 240 ; `fireAt` entier dans `[now − 15 min, now + 7 j]` ; au plus 200 lignes par catégorie.
- Routes sauf `key` et `unsubscribe` : `vaultAuthed(req, url, vault)` puis `vaultProtected(vault)` (mot de passe `pw:<salon>` présent).
- Planificateur : `setInterval` 30 s + `unref` ; `UPDATE … SET sentat = now WHERE sentat IS NULL AND fireat <= now RETURNING …` ; ratée de plus de 15 min = marquée envoyée sans notifier ; TTL 900 s ; `topic` = 32 premiers caractères du SHA-256 base64url de `key` ; 404/410 → abonnement supprimé ; succès → `lastokat` ; envoyées purgées après 7 j dans le même tour.
- Index unique `(vault, key, fireat)` : une échéance déjà partie, ou envoyée par un autre appareil, n'est jamais doublée.
- Client : envoi 10 s après un changement, toutes les 15 min onglet visible, au `visibilitychange → hidden` avec `keepalive` (si corps < 60 000 octets), démarrage 10 s après le premier `connected` de la synchro.
- Prévenance d'événement : constante 10 min marquée `// ponytail:` ; bloc de tâche (`sourceRef` non vide) : à `startAt`.
- Variables d'env : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:`) ; générées et posées par Amaury, jamais écrites dans le dépôt ; en local, passées par l'environnement du processus.
- Push actif seulement si le backend de synchro l'est (`DATABASE_URL`) **et** les trois variables VAPID sont présentes ; sinon `/api/push/*` retombe sur le shell SPA (le client traite une réponse non JSON comme « indisponible »).
- Parallélisme : lots 1 et 2 indépendants ; tâche 16 après la 9 (même fichier) ; tâche 17 après la 10 (même fichier) ; tâche 12 après la **tâche 1 du plan planifier** (`docs/superpowers/plans/2026-09-22-planifier-todos-agenda.md`, colonne `cal_event.sourceRef`), seule dépendance entre les deux plans.
- Zéro test unitaire, pas de vitest ni de `*.test.ts` ; vérification = `pnpm typecheck` (après `pnpm build:packages` si `packages/*` change), `node --check` sur les `.mjs` et `sw.js`, `curl` sur serveur local, e2e Playwright `tests/e2e/`.
- `tests/` n'est couvert par aucun typecheck : relire les specs e2e à la main.
- Pas d'étape de commit : chaque tâche finit par un point de contrôle ; commit seulement sur demande d'Amaury, jamais `git add -A`.
- Ne pas toucher `apps/web/src/components/todos/TodoMatrix.tsx`, `apps/web/src/lib/gmail.ts`, `apps/web/src/lib/mail-mirror.ts` (modifs d'une autre session) ; les importer est permis.
- UI : HeroUI v3 via `@supernote/ui` (`Switch`, `Button`, `Tooltip`) ; bouton icône phosphor + `Tooltip` + `aria-label` ; pas de toast de succès ; utilisable à 360 px, cibles ≥ 32 px (`size="icon"`, `.sn-hit`).
- TypeScript strict, pas de `any` ; commentaires : pourquoi non déductible seulement, en français, une ligne.
- `@supernote/ipc` est consommé via `dist/` et son zod de sortie strippe toute clé non déclarée.

---

## Lot 1 — Serveur

### Tâche 1 : dépendance `web-push`

**Fichiers :** Modifier `apps/web/package.json:13-66` (`dependencies`), `pnpm-lock.yaml`

**Interfaces :** Produit `import("web-push")` → `default.setVapidDetails(subject, publicKey, privateKey)`, `default.sendNotification(subscription, payload, { TTL, topic, urgency })`, `default.generateVAPIDKeys()`.

- [ ] Étape 1 — depuis la racine du dépôt :

```bash
pnpm --filter @supernote/web add web-push@^3.6.7
```

`web-push` n'a aucun script d'installation (ni lui ni ses dépendances `asn1.js`, `http_ece`, `https-proxy-agent`, `jws`, `minimist`) : **aucune** entrée `allowBuilds` à ajouter dans `pnpm-workspace.yaml`. Il va en `dependencies`, pas en `devDependencies` : c'est `server.mjs` qui le charge à l'exécution sur Scalingo.

- [ ] Vérifier :

```bash
cd apps/web && node -e "import('web-push').then((m) => console.log(typeof m.default.sendNotification))"
git diff --stat -- pnpm-workspace.yaml
```

Attendu : `function`, puis aucune ligne pour `pnpm-workspace.yaml`. La sortie de `pnpm add` ne contient pas « Ignored build scripts ».

- [ ] Point de contrôle : `package.json` porte `"web-push": "^3.6.7"` en `dependencies`, le lockfile est à jour.

### Tâche 2 : exposer `vaultAuthed`, `vaultProtected` et `resolveSqlitePath`

**Fichiers :** Modifier `apps/web/sync-backend.mjs:207-218` (après `vaultAuthed`), `apps/web/sync-backend.mjs:567` (retour), `apps/web/sync-store.mjs:75` (`resolveSqlitePath`)

**Interfaces :**
- Produit : `createSyncBackend()` → `{ enabled: true, handle, vaultAuthed(req, url, vault): Promise<boolean>, vaultProtected(vault: string): Promise<boolean> }`
- Produit : `export function resolveSqlitePath(): string` (`sync-store.mjs`)

`vaultAuthed` est aujourd'hui une closure de `createSyncBackend()`, pas un export de module : on l'expose par l'objet renvoyé, que `server.mjs` passe au backend push.

- [ ] Étape 1 — `sync-backend.mjs`, juste après la fermeture de `vaultAuthed` (l.218) :

```js
  // Sur un salon libre, le nom suffit à passer vaultAuthed : le push exige un mot de passe.
  async function vaultProtected(vault) {
    return !!(await store.getVaultPassword(vault));
  }
```

- [ ] Étape 2 — `sync-backend.mjs:567`, remplacer `return { enabled: true, handle };` par :

```js
  return { enabled: true, handle, vaultAuthed, vaultProtected };
```

- [ ] Étape 3 — `sync-store.mjs:75`, `function resolveSqlitePath() {` devient `export function resolveSqlitePath() {` (corps inchangé).

- [ ] Vérifier :

```bash
cd apps/web && node --check sync-backend.mjs && node --check sync-store.mjs
D=$(mktemp -d) && DATABASE_URL="file:$D/s.db" node --input-type=module -e '
const { createSyncBackend } = await import("./sync-backend.mjs");
const b = await createSyncBackend();
console.log(typeof b.vaultAuthed, await b.vaultProtected("inconnu"));
process.exit(0);'
```

Attendu : `function false` (après la ligne `[sync] online realtime sync ENABLED …`).

- [ ] Point de contrôle : la synchro existante n'a changé que par ces trois lignes (`git diff apps/web/sync-backend.mjs apps/web/sync-store.mjs`).

### Tâche 3 : stockage `push-store.mjs`

**Fichiers :** Créer `apps/web/push-store.mjs`

**Interfaces :**
- Consomme : `resolveSqlitePath()` (tâche 2), `DATABASE_URL` (`postgres://` → pg, sinon SQLite)
- Produit : `export async function createPushStore()` → objet :
  - `kind: "sqlite" | "postgres"`, `label: string`
  - `upsertSubscription({ endpoint, vault, deviceId, p256dh, auth }): Promise<number>`
  - `removeSubscription(endpoint: string): Promise<number>`
  - `listSubscriptions(vault: string): Promise<Array<{ endpoint, p256dh, auth }>>`
  - `markSubscriptionOk(endpoint: string): Promise<number>`
  - `replaceSchedule({ vault, deviceId, category, shared }, rows: Row[]): Promise<void>`
  - `claimDue(now: number): Promise<Array<{ vault, category, key, fireat, title, body, url, joinurl }>>` (`fireat` est une chaîne en Postgres : `Number()` côté appelant)
  - `purgeSent(before: number): Promise<number>`

Double moteur comme `share-store.mjs`, mais un seul jeu de requêtes : `?` réécrits en `$n` pour pg. Pas de transaction : l'index unique `(vault, key, fireat)` empêche les doublons même si deux appareils remplacent en même temps, et une ligne perdue entre `DELETE` et `INSERT` revient au prochain envoi (≤ 15 min).

- [ ] Étape 1 — créer `apps/web/push-store.mjs` :

```js
import { randomBytes } from "node:crypto";
import { resolveSqlitePath } from "./sync-store.mjs";

// Minuscules (Postgres les replie) et BIGINT (affinité INTEGER en SQLite) : un seul SQL pour les deux moteurs.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS push_subscription (
    endpoint  TEXT PRIMARY KEY,
    vault     TEXT NOT NULL,
    deviceid  TEXT NOT NULL,
    p256dh    TEXT NOT NULL,
    auth      TEXT NOT NULL,
    createdat BIGINT NOT NULL,
    lastokat  BIGINT
  );
  CREATE INDEX IF NOT EXISTS push_subscription_vault ON push_subscription (vault);
  CREATE TABLE IF NOT EXISTS push_schedule (
    id       TEXT PRIMARY KEY,
    vault    TEXT NOT NULL,
    deviceid TEXT NOT NULL,
    category TEXT NOT NULL,
    key      TEXT NOT NULL,
    fireat   BIGINT NOT NULL,
    title    TEXT NOT NULL,
    body     TEXT NOT NULL,
    url      TEXT NOT NULL,
    joinurl  TEXT NOT NULL,
    sentat   BIGINT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS push_schedule_once ON push_schedule (vault, key, fireat);
  CREATE INDEX IF NOT EXISTS push_schedule_due ON push_schedule (sentat, fireat);
`;

async function openDb() {
  const url = process.env.DATABASE_URL ?? "";
  if (/^postgres(ql)?:\/\//.test(url)) {
    const { default: pg } = await import("pg");
    // Un tour toutes les 30 s : pas besoin d'occuper plus de connexions de l'addon.
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    const query = (sql, params) => {
      let i = 0;
      return pool.query(sql.replace(/\?/g, () => `$${++i}`), params);
    };
    return {
      kind: "postgres",
      label: url.replace(/:\/\/[^@/]*@/, "://***@"),
      exec: (sql) => pool.query(sql),
      all: async (sql, params) => (await query(sql, params)).rows,
      run: async (sql, params) => (await query(sql, params)).rowCount ?? 0,
    };
  }
  const { default: Database } = await import("better-sqlite3");
  const path = resolveSqlitePath();
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  return {
    kind: "sqlite",
    label: path,
    exec: async (sql) => db.exec(sql),
    all: async (sql, params) => db.prepare(sql).all(params),
    run: async (sql, params) => db.prepare(sql).run(params).changes,
  };
}

export async function createPushStore() {
  const db = await openDb();
  await db.exec(SCHEMA);
  return {
    kind: db.kind,
    label: db.label,
    upsertSubscription: ({ endpoint, vault, deviceId, p256dh, auth }) =>
      db.run(
        `INSERT INTO push_subscription (endpoint, vault, deviceid, p256dh, auth, createdat)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET vault = excluded.vault, deviceid = excluded.deviceid,
           p256dh = excluded.p256dh, auth = excluded.auth`,
        [endpoint, vault, deviceId, p256dh, auth, Date.now()],
      ),
    removeSubscription: (endpoint) =>
      db.run(`DELETE FROM push_subscription WHERE endpoint = ?`, [endpoint]),
    listSubscriptions: (vault) =>
      db.all(`SELECT endpoint, p256dh, auth FROM push_subscription WHERE vault = ?`, [vault]),
    markSubscriptionOk: (endpoint) =>
      db.run(`UPDATE push_subscription SET lastokat = ? WHERE endpoint = ?`, [Date.now(), endpoint]),
    async replaceSchedule({ vault, deviceId, category, shared }, rows) {
      await db.run(
        shared
          ? `DELETE FROM push_schedule WHERE vault = ? AND category = ? AND sentat IS NULL`
          : `DELETE FROM push_schedule WHERE vault = ? AND category = ? AND deviceid = ? AND sentat IS NULL`,
        shared ? [vault, category] : [vault, category, deviceId],
      );
      if (rows.length === 0) return;
      await db.run(
        `INSERT INTO push_schedule (id, vault, deviceid, category, key, fireat, title, body, url, joinurl)
         VALUES ${rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}
         ON CONFLICT (vault, key, fireat) DO NOTHING`,
        rows.flatMap((r) => [
          randomBytes(9).toString("base64url"),
          vault, deviceId, category, r.key, r.fireAt, r.title, r.body, r.url, r.joinUrl,
        ]),
      );
    },
    claimDue: (now) =>
      db.all(
        `UPDATE push_schedule SET sentat = ? WHERE sentat IS NULL AND fireat <= ?
         RETURNING vault, category, key, fireat, title, body, url, joinurl`,
        [now, now],
      ),
    purgeSent: (before) =>
      db.run(`DELETE FROM push_schedule WHERE sentat IS NOT NULL AND sentat < ?`, [before]),
  };
}
```

- [ ] Vérifier (SQLite ; doublon dans un lot, réservation atomique, ligne envoyée non réinsérée) :

```bash
cd apps/web && node --check push-store.mjs
D=$(mktemp -d) && DATABASE_URL="file:$D/p.db" node --input-type=module -e '
const { createPushStore } = await import("./push-store.mjs");
const s = await createPushStore();
const now = Date.now();
const row = { key: "reminder:a", fireAt: now - 1000, title: "t", body: "b", url: "/todos", joinUrl: "" };
await s.replaceSchedule({ vault: "v", deviceId: "d1", category: "reminder", shared: true }, [row, row]);
console.log((await s.claimDue(now)).length, (await s.claimDue(now)).length);
await s.replaceSchedule({ vault: "v", deviceId: "d2", category: "reminder", shared: true }, [row]);
console.log((await s.claimDue(now)).length);
process.exit(0);'
```

Attendu : `1 0` puis `0`.

- [ ] Point de contrôle : un seul fichier créé ; aucune table existante (`op`, `meta`, `share`, `sync_*`) touchée.

### Tâche 4 : routes `push-backend.mjs`

**Fichiers :** Créer `apps/web/push-backend.mjs`

**Interfaces :**
- Consomme : `createPushStore()` (tâche 3), `{ vaultAuthed, vaultProtected }` (tâche 2), env `VAPID_*`
- Produit : `export async function createPushBackend({ vaultAuthed, vaultProtected })` → `{ enabled: false, handle: () => false }` sans clés VAPID, sinon `{ enabled: true, handle(req, res): Promise<boolean> }` servant les routes des contraintes globales.

- [ ] Étape 1 — créer `apps/web/push-backend.mjs` :

```js
import { createPushStore } from "./push-store.mjs";

const CATEGORIES = ["reminder", "event", "followup", "snooze"];
const SHARED = new Set(["reminder", "event"]);
const HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
const MISSED_MS = 15 * 60 * 1000;
const MAX_ROWS = 200;
const MAX_BODY_BYTES = 1024 * 1024;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-sync-token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

// Même résolution que le navigateur : « /\evil » et « /\t/evil » deviennent « //evil ».
function isInternalPath(url) {
  if (typeof url !== "string" || !url.startsWith("/")) return false;
  try {
    return new URL(url, "https://supernote.invalid").origin === "https://supernote.invalid";
  } catch {
    return false;
  }
}

function cleanRow(category, item, now) {
  if (!item || typeof item !== "object") return null;
  const { key, fireAt, title, body, url, joinUrl } = item;
  if (typeof key !== "string" || !key.startsWith(`${category}:`) || key.length > 512) return null;
  if (!Number.isInteger(fireAt) || fireAt < now - MISSED_MS || fireAt > now + HORIZON_MS) return null;
  if (!isInternalPath(url)) return null;
  if (typeof joinUrl !== "string" || (joinUrl !== "" && !joinUrl.startsWith("https://"))) return null;
  if (typeof title !== "string" || typeof body !== "string") return null;
  return { key, fireAt, title: title.slice(0, 120), body: body.slice(0, 240), url, joinUrl };
}

function sendJson(res, status, body) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  try {
    return JSON.parse((await readBody(req)).toString("utf8"));
  } catch {
    return null;
  }
}

export async function createPushBackend({ vaultAuthed, vaultProtected }) {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.VAPID_SUBJECT ?? "";
  if (!publicKey || !privateKey || !subject) {
    console.log("[push] désactivé : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY ou VAPID_SUBJECT absente");
    return { enabled: false, handle: () => false };
  }
  const { default: webpush } = await import("web-push");
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const store = await createPushStore();
  console.log(`[push] web push ENABLED (${store.kind} store at ${store.label})`);

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;
    if (!path.startsWith("/api/push/")) return false;

    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return true;
    }

    if (path === "/api/push/key" && req.method === "GET") {
      sendJson(res, 200, { publicKey });
      return true;
    }

    // L'endpoint est lui-même le secret : pas d'authentification de salon.
    if (path === "/api/push/unsubscribe" && req.method === "POST") {
      const body = await readJson(req);
      if (typeof body?.endpoint !== "string") {
        sendJson(res, 400, { error: "missing endpoint" });
        return true;
      }
      await store.removeSubscription(body.endpoint);
      sendJson(res, 200, { ok: true });
      return true;
    }

    const vault = url.searchParams.get("vault") ?? "";
    if (!vault) {
      sendJson(res, 400, { error: "missing vault" });
      return true;
    }
    if (!(await vaultAuthed(req, url, vault))) {
      sendJson(res, 401, { error: "unauthorized" });
      return true;
    }
    if (!(await vaultProtected(vault))) {
      sendJson(res, 403, { error: "vault not protected" });
      return true;
    }

    if (path === "/api/push/subscribe" && req.method === "POST") {
      const body = await readJson(req);
      const deviceId = body?.deviceId;
      const endpoint = body?.subscription?.endpoint;
      const p256dh = body?.subscription?.keys?.p256dh;
      const auth = body?.subscription?.keys?.auth;
      // Le serveur POSTe vers cet endpoint : https seulement.
      if (
        typeof deviceId !== "string" || !deviceId ||
        typeof endpoint !== "string" || !endpoint.startsWith("https://") ||
        typeof p256dh !== "string" || typeof auth !== "string"
      ) {
        sendJson(res, 400, { error: "invalid subscription" });
        return true;
      }
      await store.upsertSubscription({ endpoint, vault, deviceId, p256dh, auth });
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (path === "/api/push/schedule" && req.method === "PUT") {
      const body = await readJson(req);
      const deviceId = body?.deviceId;
      const categories = body?.categories;
      if (typeof deviceId !== "string" || !deviceId || !categories || typeof categories !== "object") {
        sendJson(res, 400, { error: "missing deviceId or categories" });
        return true;
      }
      const now = Date.now();
      let accepted = 0;
      for (const category of CATEGORIES) {
        if (!Array.isArray(categories[category])) continue;
        const rows = categories[category]
          .map((item) => cleanRow(category, item, now))
          .filter(Boolean)
          .slice(0, MAX_ROWS);
        await store.replaceSchedule({ vault, deviceId, category, shared: SHARED.has(category) }, rows);
        accepted += rows.length;
      }
      sendJson(res, 200, { ok: true, accepted });
      return true;
    }

    sendJson(res, 404, { error: "unknown push route" });
    return true;
  }

  return { enabled: true, handle };
}
```

- [ ] Vérifier : `cd apps/web && node --check push-backend.mjs` → aucune sortie, code 0. Le comportement HTTP se vérifie à la tâche 6.
- [ ] Point de contrôle : aucune route n'écrit sans `vaultAuthed` + `vaultProtected`, sauf `unsubscribe` (suppression seulement).

### Tâche 5 : planificateur

**Fichiers :** Modifier `apps/web/push-backend.mjs` (import en tête, constantes, bloc entre le `console.log("[push] web push ENABLED …")` et `async function handle`)

**Interfaces :**
- Consomme : `store.claimDue`, `store.listSubscriptions`, `store.markSubscriptionOk`, `store.removeSubscription`, `store.purgeSent`, `webpush.sendNotification`
- Produit : envoi du payload figé (contraintes globales) à tous les abonnements du salon ; journaux `[push] <catégorie> → N abonnement(s)`, `[push] abonnement expiré retiré (404|410)`, `[push] envoi refusé (…)`. Le titre et le corps ne sont jamais journalisés.

- [ ] Étape 1 — en tête du fichier, avant l'import du store :

```js
import { createHash } from "node:crypto";
```

- [ ] Étape 2 — sous `MAX_BODY_BYTES` :

```js
const TICK_MS = 30_000;
const TTL_S = 15 * 60;
```

- [ ] Étape 3 — dans `createPushBackend`, juste après le `console.log` d'activation :

```js
  // Topic : 32 caractères base64url au plus, et `key` contient des « @ » (id d'agenda = adresse).
  const topicOf = (key) => createHash("sha256").update(key).digest("base64url").slice(0, 32);

  async function deliver(sub, payload, topic) {
    try {
      // urgency high : Android en veille diffère les messages « normal ».
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: TTL_S, topic, urgency: "high" },
      );
      await store.markSubscriptionOk(sub.endpoint);
    } catch (err) {
      const status = err?.statusCode;
      if (status === 404 || status === 410) {
        await store.removeSubscription(sub.endpoint);
        console.log(`[push] abonnement expiré retiré (${status})`);
      } else {
        console.warn(`[push] envoi refusé (${status ?? err})`);
      }
    }
  }

  async function tick() {
    try {
      const now = Date.now();
      const subsByVault = new Map();
      for (const row of await store.claimDue(now)) {
        if (now - Number(row.fireat) > MISSED_MS) continue;
        if (!subsByVault.has(row.vault)) subsByVault.set(row.vault, await store.listSubscriptions(row.vault));
        const subs = subsByVault.get(row.vault);
        const payload = JSON.stringify({
          title: row.title,
          body: row.body,
          url: row.url,
          tag: row.key,
          joinUrl: row.joinurl,
        });
        await Promise.all(subs.map((sub) => deliver(sub, payload, topicOf(row.key))));
        console.log(`[push] ${row.category} → ${subs.length} abonnement(s)`);
      }
      await store.purgeSent(now - HORIZON_MS);
    } catch (err) {
      console.warn("[push] tour du planificateur échoué", err);
    }
  }
  const timer = setInterval(() => void tick(), TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
```

- [ ] Vérifier : `cd apps/web && node --check push-backend.mjs` → code 0. Envoi réel : tâche 6.
- [ ] Point de contrôle : la réservation précède tout envoi (deux conteneurs ne notifient jamais deux fois la même ligne).

### Tâche 6 : branchement dans `server.mjs` et contrôle au `curl`

**Fichiers :** Modifier `apps/web/server.mjs:24-33` (après le bloc du backend de synchro), `apps/web/server.mjs:134-138` (après l'appel à `syncBackend.handle`)

**Interfaces :**
- Consomme : `syncBackend` (`{ enabled, handle, vaultAuthed, vaultProtected }`, tâche 2), `createPushBackend` (tâches 4-5)
- Produit : `/api/push/*` servi en production quand la synchro et les clés VAPID sont là.

Pas de montage dans `vite.config.ts` : le SW n'est jamais enregistré en dev (`src/lib/pwa/sw-register.ts:14`), aucun navigateur n'y recevrait de push ; l'e2e intercepte `/api/push/*`.

- [ ] Étape 1 — `server.mjs`, après le bloc `if (process.env.DATABASE_URL) { … createSyncBackend … }` (l.33) :

```js
// Push : l'identité est le salon de synchro, donc seulement avec le backend de synchro.
let pushBackend = { enabled: false, handle: () => false };
if (syncBackend.enabled) {
  try {
    const { createPushBackend } = await import("./push-backend.mjs");
    pushBackend = await createPushBackend(syncBackend);
  } catch (err) {
    console.error("[server] push backend failed to load (static serving continues):", err);
  }
}
```

- [ ] Étape 2 — dans `createServer`, juste après le bloc `if (syncBackend.enabled) { … }` :

```js
    if (pushBackend.enabled && (req.url ?? "").startsWith("/api/push/")) {
      const handled = await pushBackend.handle(req, res);
      if (handled) return;
    }
```

- [ ] Vérifier — syntaxe :

```bash
cd apps/web && for f in server.mjs sync-backend.mjs sync-store.mjs push-store.mjs push-backend.mjs; do node --check "$f" || echo "KO $f"; done
```

Attendu : aucune ligne `KO`.

- [ ] Vérifier — serveur local avec des clés de dev jetables (les routes API passent avant le statique : pas besoin de `dist/`). Lancer le serveur **en arrière-plan** :

```bash
cd apps/web && D=$(mktemp -d) && echo "$D"
node -e 'const k = require("web-push").generateVAPIDKeys(); console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}`)' > "$D/vapid.env"
env $(cat "$D/vapid.env") VAPID_SUBJECT=mailto:dev@localhost DATABASE_URL="file:$D/push.db" PORT=3399 \
  node server.mjs > "$D/server.log" 2>&1 &
echo $! > "$D/pid"
```

Puis, dans le même shell (`B` = base, `T` = en-têtes du salon protégé) :

```bash
B=http://localhost:3399
curl -s $B/api/push/key
curl -s -X POST $B/api/sync/join -H 'content-type: application/json' -d '{"vault":"push-test","password":"motdepasse-dev"}'
SUB=$(node -e 'const c = require("node:crypto"); const e = c.createECDH("prime256v1"); e.generateKeys(); console.log(JSON.stringify({ deviceId: "curl", subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/curl-factice", keys: { p256dh: e.getPublicKey().toString("base64url"), auth: c.randomBytes(16).toString("base64url") } } }))')
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$B/api/push/subscribe?vault=push-test" -H 'content-type: application/json' -d "$SUB"
curl -s -X POST "$B/api/push/subscribe?vault=salon-libre" -H 'content-type: application/json' -d "$SUB"
curl -s -X POST "$B/api/push/subscribe?vault=push-test" -H 'content-type: application/json' -H 'x-sync-token: motdepasse-dev' -d "$SUB"
AT=$(node -p 'Date.now() + 40000')
SCHED='{"deviceId":"curl","categories":{"reminder":[{"key":"reminder:t1","fireAt":'$AT',"title":"Rappel","body":"Test","url":"/todos","joinUrl":""},{"key":"reminder:t2","fireAt":'$AT',"title":"x","body":"x","url":"/\\evil.example","joinUrl":""},{"key":"event:x","fireAt":'$AT',"title":"x","body":"x","url":"/agenda","joinUrl":""}]}}'
curl -s -X PUT "$B/api/push/schedule?vault=push-test" -H 'content-type: application/json' -H 'x-sync-token: motdepasse-dev' -d "$SCHED"
```

Attendu, dans l'ordre : `{"publicKey":"B…"}` · `{"ok":true,"created":true}` · `401` · `{"error":"vault not protected"}` · `{"ok":true}` · `{"ok":true,"accepted":1}` (`/\evil.example` rejeté, `event:x` rejeté car hors de la catégorie `reminder`).

Attendre l'envoi (entre 40 et 70 s), puis rejouer le même `PUT` et relire la base :

```bash
timeout 120 sh -c 'until grep -q "\[push\] reminder →" "$0"; do sleep 2; done' "$D/server.log"; grep "\[push\]" "$D/server.log"
curl -s -X PUT "$B/api/push/schedule?vault=push-test" -H 'content-type: application/json' -H 'x-sync-token: motdepasse-dev' -d "$SCHED"
DB="$D/push.db" node -e 'const D = require("better-sqlite3"); const db = new D(process.env.DB); console.log(db.prepare("SELECT count(*) AS n FROM push_subscription").get(), db.prepare("SELECT key, sentat IS NOT NULL AS sent FROM push_schedule").all())'
kill "$(cat "$D/pid")"
```

Attendu : journal `[push] web push ENABLED (sqlite store at …)`, `[push] abonnement expiré retiré (410)` (FCM refuse l'endpoint factice), `[push] reminder → 1 abonnement(s)` ; puis `{ n: 0 }` et une seule ligne `[ { key: 'reminder:t1', sent: 1 } ]` (le second `PUT` n'a pas recréé l'échéance déjà partie).

- [ ] Point de contrôle : `git status --short apps/web` ne montre que `package.json`, `server.mjs`, `sync-backend.mjs`, `sync-store.mjs`, `push-store.mjs`, `push-backend.mjs` (et le lockfile à la racine).

### Tâche 7 : clés VAPID de production (action d'Amaury)

**Fichiers :** aucun

**Interfaces :** Produit les variables d'env Scalingo `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

Les agents **n'exécutent pas** cette tâche : ils la remettent telle quelle à Amaury. Une clé changée plus tard invalide tous les abonnements.

- [ ] Étape 1 — Amaury, depuis `apps/web`, génère une paire et ne la colle nulle part dans le dépôt :

```bash
npx web-push generate-vapid-keys
```

- [ ] Étape 2 — Amaury la pose sur Scalingo en remplaçant les trois `<…>` :

```bash
scalingo --app supernote env-set VAPID_PUBLIC_KEY=<clé publique> VAPID_PRIVATE_KEY=<clé privée> VAPID_SUBJECT=mailto:<adresse de contact>
```

- [ ] Vérifier (après déploiement, `git push scalingo main` sur demande seulement) : `curl -s https://supernote.osc-fr1.scalingo.io/api/push/key` → `{"publicKey":"…"}` égal à la clé publique posée.
- [ ] Point de contrôle : `git grep -n "VAPID_PRIVATE_KEY=" -- ':!docs'` ne renvoie rien.

---

## Lot 2 — Réception

### Tâche 8 : handlers `push` et `notificationclick` du service worker

**Fichiers :** Modifier `apps/web/public/sw.js:212` (insérer une section « Web Push » juste avant le `notificationclick`), `apps/web/public/sw.js:213-224` (remplacer le `notificationclick` actuel)

**Interfaces :**
- Consomme : payload push figé (contraintes globales), `data.reason === "periodic-sync"` des notifications existantes (`sw.js:205`)
- Produit : `postMessage({ type: "PUSH_RECEIVED", payload })` vers la fenêtre visible s'il y en a une, et dans tous les cas une notification système `{ tag, data: { url, joinUrl }, actions }` ; clic `join` → `openWindow(joinUrl)`, clic simple → `focus()` + `navigate(url)` ou `openWindow(url)`.

- [ ] Étape 1 — insérer, juste avant `self.addEventListener("notificationclick", …)` (l.213) :

```js
// ── Web Push ──────────────────────────────────────────────────────────────────

// Revérifiés ici : le SW ouvre des fenêtres avec ces valeurs.
function internalPath(url) {
  try {
    const u = new URL(url, self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : "/";
  } catch {
    return "/";
  }
}

function httpsUrl(url) {
  try {
    return new URL(url).protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

const text = (v) => (typeof v === "string" ? v : "");

self.addEventListener("push", (event) => {
  let data = {};
  try {
    const parsed = event.data ? event.data.json() : null;
    if (parsed && typeof parsed === "object") data = parsed;
  } catch {
    /* charge illisible : notification générique */
  }
  const payload = {
    title: text(data.title) || "Supernote",
    body: text(data.body),
    url: internalPath(text(data.url) || "/"),
    tag: text(data.tag),
    joinUrl: httpsUrl(text(data.joinUrl)),
  };
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const visible = windows.find((c) => c.visibilityState === "visible");
      if (visible) visible.postMessage({ type: "PUSH_RECEIVED", payload });
      // Toujours afficher : Safari révoque la permission d'un site qui reçoit un push sans notification.
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        tag: payload.tag || undefined,
        icon: "/icons/icon-192.png",
        data: { url: payload.url, joinUrl: payload.joinUrl },
        actions: payload.joinUrl ? [{ action: "join", title: "Rejoindre" }] : [],
      });
    })(),
  );
});
```

- [ ] Étape 2 — remplacer le `notificationclick` des l.213-224 par un handler unique :

```js
self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data ?? {};
  event.notification.close();
  if (event.action === "join") {
    const joinUrl = httpsUrl(text(data.joinUrl));
    if (joinUrl) event.waitUntil(self.clients.openWindow(joinUrl));
    return;
  }
  // periodic-sync : ramener l'app sans changer de page.
  const target = data.reason === "periodic-sync" ? null : internalPath(text(data.url) || "/");
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((c) => c.url.startsWith(self.location.origin));
      if (!existing) return self.clients.openWindow(target ?? "/");
      await existing.focus();
      if (target) await existing.navigate(target).catch(() => self.clients.openWindow(target));
    })(),
  );
});
```

- [ ] Vérifier : `node --check apps/web/public/sw.js` → code 0 ; `grep -c "__WB_MANIFEST" apps/web/public/sw.js` → `1` (le manifeste injecté reste). Comportement : tâche 10.
- [ ] Point de contrôle : `CACHE_VERSION` inchangé (le navigateur met à jour le SW sur simple différence d'octets).

### Tâche 9 : relais in-app des push reçus page visible

**Fichiers :** Modifier `apps/web/src/lib/pwa/AutomationNotificationBridge.tsx:1-12` (en-tête), `:31-89` (second effet)

**Interfaces :**
- Consomme : message SW `{ type: "PUSH_RECEIVED", payload: { title, body, url, tag, joinUrl } }`, `useNotificationsContext().push`, `buildNotification`
- Produit : une entrée du tiroir `{ level: "info", title, body, source: "push" }`, sauf pour `tag` en `reminder:` (le moteur local l'a déjà posée).

- [ ] Étape 1 — dans l'en-tête, après la ligne `2. The OS native Notification API …` et sa suite, ajouter :

```tsx
 *   3. Relaie au tiroir les push reçus pendant qu'une fenêtre est visible (message SW `PUSH_RECEIVED`).
```

- [ ] Étape 2 — sous `interface AutomationNotificationDetail { … }` :

```tsx
interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  joinUrl: string;
}
```

- [ ] Étape 3 — dans `AutomationNotificationBridge`, après le premier `useEffect` (avant `return null;`) :

```tsx
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return undefined;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; payload?: PushPayload } | null;
      if (data?.type !== "PUSH_RECEIVED" || !data.payload) return;
      // Le moteur local a déjà posé ce rappel dans le tiroir.
      if (data.payload.tag.startsWith("reminder:")) return;
      push(
        buildNotification({
          level: "info",
          title: data.payload.title,
          body: data.payload.body,
          source: "push",
        }),
      );
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [push]);
```

- [ ] Vérifier : `pnpm typecheck` → 0 erreur.
- [ ] Point de contrôle : le premier effet (automatisations) est inchangé.

### Tâche 10 : e2e du service worker

**Fichiers :** Créer `tests/e2e/07-push.spec.ts`

**Interfaces :**
- Consomme : `bootDegraded(page)` (`tests/e2e/helpers.ts:11`), CDP `ServiceWorker.enable`, évènement `ServiceWorker.workerRegistrationUpdated`, `ServiceWorker.deliverPushMessage({ origin, registrationId, data })`, bouton « Ouvrir le centre de notifications » (`components/shell/SidebarRail.tsx:134`)
- Produit : `test.describe("07 — notifications push")`, enrichi à la tâche 17.

Faits vérifiés avec Playwright 1.59.1 installé (sonde du 2026-09-22) :
- `deliverPushMessage` déclenche bien le handler `push` du SW, fenêtre ouverte ou non, sans abonnement réel.
- Le **headless shell** par défaut refuse `showNotification` dans le SW (`Notification.permission` = `denied` malgré `grantPermissions`) ; le **Chromium complet** (`channel: "chromium"`, build `chromium-1217` présent) l'accepte et `getNotifications()` renvoie la notification.
- En dev, `registerServiceWorker` ne fait rien (`sw-register.ts:14`), mais Vite sert `public/sw.js` brut en `/sw.js` (200, `text/javascript`) : l'e2e l'enregistre lui-même.
- Après `page.goto("about:blank")`, aucune fenêtre de l'origine : le SW prend la branche notification système, lisible via `context.serviceWorkers()[0].evaluate(…)`.

- [ ] Étape 1 — créer `tests/e2e/07-push.spec.ts` :

```ts
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
          return (await reg.getNotifications()).map((n) => ({
            title: n.title,
            body: n.body,
            tag: n.tag,
            data: n.data as unknown,
            actions: (n as unknown as { actions: Array<{ action: string }> }).actions.map((a) => a.action),
          }));
        }),
      )
      .toEqual([
        {
          title: "Pas de réponse",
          body: "Devis mairie de Lyon",
          tag: "followup:t1",
          data: { url: "/mail?thread=t1", joinUrl: "" },
          actions: [],
        },
        {
          title: "Dans 10 min · 14:00",
          body: "Point équipe",
          tag: "event:primary:ev1",
          data: { url: "/", joinUrl: "https://meet.google.com/abc-defg-hij" },
          actions: ["join"],
        },
      ]);
  });
});
```

- [ ] Vérifier : `pnpm test:e2e tests/e2e/07-push.spec.ts` → `1 passed`. Le clic sur la notification (`notificationclick`) n'est pas pilotable en headless : il est couvert par le contrôle réel de la tâche 18.
- [ ] Point de contrôle : `pnpm test:e2e` complet reste vert (les autres specs tournent toujours sur le headless shell).

---

## Lot 3 — Abonnement et envoi

### Tâche 11 : contrat IPC `push.upcoming`

**Fichiers :** Créer `packages/ipc/src/schemas/push.ts`, `packages/ipc/src/router/push.router.ts` ; Modifier `packages/ipc/src/router/index.ts:18` (import), `:45` (`appRouter`), `:67` (export), `packages/ipc/src/index.ts:50` (export du routeur), `:88` (export des schémas)

**Interfaces :**
- Produit :
  - `PushUpcomingInput = { from: number; to: number; accountId: string }` (`accountId` vide → `events: []`)
  - `PushUpcomingReminder = { todoId: string; reminderAt: number; text: string; reminderText: string }`
  - `PushUpcomingEvent = { calendarId: string; eventId: string; summary: string; startAt: number; meetUrl: string; sourceRef: string }`
  - `PushUpcomingOutput = { reminders: PushUpcomingReminder[]; events: PushUpcomingEvent[] }`
  - `trpcVanillaClient.push.upcoming.query(input): Promise<PushUpcomingOutput>`

La spec écrit `push.upcoming({ from, to })` ; `cal_event` est clé par `accountId` (`calendar-routes.ts:156`), d'où le troisième champ.

- [ ] Étape 1 — `packages/ipc/src/schemas/push.ts` :

```ts
import { z } from "zod";

export const PushUpcomingInput = z.object({
  from: z.number(),
  to: z.number(),
  /** Compte de l'agenda connecté ; vide = pas d'événements. */
  accountId: z.string(),
});
export type PushUpcomingInput = z.infer<typeof PushUpcomingInput>;

export const PushUpcomingReminderSchema = z.object({
  todoId: z.string(),
  reminderAt: z.number(),
  text: z.string(),
  reminderText: z.string(),
});
export type PushUpcomingReminder = z.infer<typeof PushUpcomingReminderSchema>;

export const PushUpcomingEventSchema = z.object({
  calendarId: z.string(),
  eventId: z.string(),
  summary: z.string(),
  startAt: z.number(),
  meetUrl: z.string(),
  sourceRef: z.string(),
});
export type PushUpcomingEvent = z.infer<typeof PushUpcomingEventSchema>;

export const PushUpcomingOutput = z.object({
  reminders: z.array(PushUpcomingReminderSchema),
  events: z.array(PushUpcomingEventSchema),
});
export type PushUpcomingOutput = z.infer<typeof PushUpcomingOutput>;
```

- [ ] Étape 2 — `packages/ipc/src/router/push.router.ts` :

```ts
import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import { PushUpcomingInput, PushUpcomingOutput } from "../schemas/push.js";

/** Implémenté par le worker du coffre (`apps/web/src/lib/vault-worker/calendar-routes.ts`). */
export const pushRouter = router({
  upcoming: publicProcedure
    .input(PushUpcomingInput)
    .output(PushUpcomingOutput)
    .query(() => {
      throw notImplemented("push.upcoming");
    }),
});

export type PushRouter = typeof pushRouter;
```

- [ ] Étape 3 — `router/index.ts` : `import { pushRouter } from "./push.router.js";` sous l'import de `calendarRouter` ; `push: pushRouter,` sous `calendar: calendarRouter,` ; `export { pushRouter, type PushRouter } from "./push.router.js";` sous l'export de `calendarRouter`.
- [ ] Étape 4 — `src/index.ts` : `export { pushRouter, type PushRouter } from "./router/push.router.js";` sous la l.50 ; `export * from "./schemas/push.js";` sous la l.88.
- [ ] Vérifier :

```bash
pnpm --filter @supernote/ipc build && ls packages/ipc/dist/router/push.router.js && pnpm typecheck
```

Attendu : le fichier existe, typecheck 0 erreur.

- [ ] Point de contrôle : chaque champ renvoyé par la route (tâche 12) est déclaré dans `PushUpcomingOutput`.

### Tâche 12 : route worker `push.upcoming`

**Dépendance explicite :** tâche 1 du plan `docs/superpowers/plans/2026-09-22-planifier-todos-agenda.md` (colonne `cal_event.sourceRef` et sa migration). La route lit `e.*` : sans la colonne, elle rend `sourceRef: ""` et les blocs de tâche sont traités comme des événements ordinaires (−10 min, `/agenda`).

**Fichiers :** Modifier `apps/web/src/lib/vault-worker/calendar-routes.ts:7-17` (imports), fin de `buildCalendarRoutes` (avant le `return` l.340), map de retour (l.349)

**Interfaces :**
- Consomme : `PushUpcomingInput`, `PushUpcomingReminder`, `PushUpcomingEvent` (tâche 11), `rows`, `parseJson` (déjà dans le fichier)
- Produit : route `"push.upcoming"` : todos non terminés avec `reminderAt` dans `[from, to]` et `reminderFiredAt` vide, triés par `reminderAt` ; événements des agendas cochés, minutés, non déclinés, non annulés, `startAt` dans `[from, to]`, triés par `startAt`.

- [ ] Étape 1 — ajouter aux imports de `@supernote/ipc` : `PushUpcomingEvent`, `PushUpcomingInput`, `PushUpcomingReminder`.
- [ ] Étape 2 — dans `buildCalendarRoutes`, après `const overlay = …;` :

```ts
  const pushUpcoming = async (input: unknown): Promise<unknown> => {
    const { from, to, accountId } = input as PushUpcomingInput;
    const reminders: PushUpcomingReminder[] = [];
    const todos = rows(db.exec(
      `SELECT id, fields FROM entity WHERE vaultId = ? AND typeId = 'todo'
         AND COALESCE(json_extract(fields, '$.reminderAt'), '') != ''
         AND COALESCE(json_extract(fields, '$.reminderFiredAt'), '') = ''`,
      [vaultId],
    ));
    for (const t of todos) {
      const f = parseJson<Record<string, unknown>>(t["fields"], {});
      if (f["done"] === true || f["done"] === "true") continue;
      // datetime-local sans fuseau : lu à l'heure locale de l'appareil.
      const reminderAt = new Date(String(f["reminderAt"])).getTime();
      if (!(reminderAt >= from && reminderAt <= to)) continue;
      reminders.push({
        todoId: String(t["id"]),
        reminderAt,
        text: typeof f["text"] === "string" ? f["text"] : "",
        reminderText: typeof f["reminderText"] === "string" ? f["reminderText"].trim() : "",
      });
    }
    reminders.sort((a, b) => a.reminderAt - b.reminderAt);
    // e.* : `sourceRef` n'existe qu'après la migration de « Planifier ses todos ».
    const events: PushUpcomingEvent[] = accountId
      ? rows(db.exec(
          `SELECT e.* FROM cal_event e
             JOIN cal_calendar c ON c.accountId = e.accountId AND c.id = e.calendarId
            WHERE e.accountId = ? AND c.selected = 1 AND e.status != 'cancelled' AND e.allDay = 0
              AND e.selfResponse != 'declined' AND e.startAt >= ? AND e.startAt <= ?
            ORDER BY e.startAt ASC`,
          [accountId, from, to],
        )).map((e) => ({
          calendarId: String(e["calendarId"]),
          eventId: String(e["id"]),
          summary: String(e["summary"] ?? ""),
          startAt: Number(e["startAt"]),
          meetUrl: String(e["meetUrl"] ?? ""),
          sourceRef: String(e["sourceRef"] ?? ""),
        }))
      : [];
    return { reminders, events };
  };
```

- [ ] Étape 3 — dans l'objet renvoyé, sous `"calendar.overlay": overlay,` : `"push.upcoming": pushUpcoming,`
- [ ] Vérifier : `pnpm typecheck` → 0 erreur. Rappels : e2e de la tâche 17. Événements : contrôle réel de la tâche 18.
- [ ] Point de contrôle : aucune autre route de `calendar-routes.ts` modifiée par cette tâche.

### Tâche 13 : client push `lib/push/push-client.ts`

**Fichiers :** Créer `apps/web/src/lib/push/push-client.ts`

**Interfaces :**
- Consomme : `loadOnlineSyncConfig()`, `getOrCreateClientId()`, `OnlineSyncConfig` (`lib/online-sync/config-storage.ts`), routes HTTP figées
- Produit :
  - `export type PushCategory = "reminder" | "event" | "followup" | "snooze"`
  - `export interface PushScheduleRow { key: string; fireAt: number; title: string; body: string; url: string; joinUrl: string }`
  - `export type PushAvailability = "ok" | "ios-not-installed" | "unsupported" | "no-sync" | "no-password"`
  - `export function pushAvailability(config?: OnlineSyncConfig): PushAvailability`
  - `export async function subscribePush(config?: OnlineSyncConfig): Promise<void>` (lève un `Error` au message affichable)
  - `export async function unsubscribePush(config?: OnlineSyncConfig): Promise<void>`
  - `export async function refreshPushSubscription(config?: OnlineSyncConfig): Promise<void>`
  - `export async function sendPushSchedule(categories: Partial<Record<PushCategory, PushScheduleRow[]>>, keepalive?: boolean, config?: OnlineSyncConfig): Promise<void>`

- [ ] Étape 1 — créer le fichier :

```ts
import {
  getOrCreateClientId,
  loadOnlineSyncConfig,
  type OnlineSyncConfig,
} from "@/lib/online-sync/config-storage";

export type PushCategory = "reminder" | "event" | "followup" | "snooze";

export interface PushScheduleRow {
  key: string;
  fireAt: number;
  title: string;
  body: string;
  url: string;
  joinUrl: string;
}

export type PushAvailability = "ok" | "ios-not-installed" | "unsupported" | "no-sync" | "no-password";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function pushAvailability(config: OnlineSyncConfig = loadOnlineSyncConfig()): PushAvailability {
  if (typeof navigator === "undefined") return "unsupported";
  if (isIos() && (navigator as Navigator & { standalone?: boolean }).standalone !== true) return "ios-not-installed";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (!config.enabled || !config.vaultKey) return "no-sync";
  // Un salon protégé exige son mot de passe sur chaque appareil : sans jeton, le salon est libre.
  if (!config.token) return "no-password";
  return "ok";
}

function apiUrl(config: OnlineSyncConfig, path: string, withVault: boolean): string {
  const base = `${config.serverUrl.replace(/\/+$/, "")}${path}`;
  return withVault ? `${base}?vault=${encodeURIComponent(config.vaultKey)}` : base;
}

function headers(config: OnlineSyncConfig): Record<string, string> {
  return config.token
    ? { "content-type": "application/json", "x-sync-token": config.token }
    : { "content-type": "application/json" };
}

function refusal(status: number): Error {
  if (status === 403) return new Error("Protège ton salon par un mot de passe pour activer les notifications.");
  if (status === 401) return new Error("Mot de passe du salon refusé.");
  return new Error(`Le serveur a refusé l'abonnement (HTTP ${status}).`);
}

function base64UrlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function registerOnServer(config: OnlineSyncConfig, sub: PushSubscription): Promise<void> {
  const res = await fetch(apiUrl(config, "/api/push/subscribe", true), {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify({ deviceId: getOrCreateClientId(), subscription: sub.toJSON() }),
  });
  if (!res.ok) throw refusal(res.status);
}

export async function subscribePush(config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications bloquées par le navigateur : autorise-les dans les réglages du site."
        : "Autorisation de notifier non accordée.",
    );
  }
  const keyRes = await fetch(apiUrl(config, "/api/push/key", false));
  const keyBody = keyRes.ok ? ((await keyRes.json().catch(() => null)) as { publicKey?: unknown } | null) : null;
  const key = keyBody?.publicKey;
  if (typeof key !== "string" || !key) {
    throw new Error("Le serveur n'envoie pas de notifications push (clés VAPID absentes).");
  }
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error("Service worker indisponible : recharge la page puis réessaie.");
  // Une clé VAPID changée rend l'ancien abonnement inutilisable : on repart d'un neuf.
  await (await reg.pushManager.getSubscription())?.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(key) });
  await registerOnServer(config, sub);
}

export async function unsubscribePush(config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<void> {
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (!sub) return;
  // Hors ligne, le serveur l'apprendra par un 410 au prochain envoi.
  await fetch(apiUrl(config, "/api/push/unsubscribe", false), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => undefined);
  await sub.unsubscribe();
}

/** Abonnement perdu (410) ou salon changé : réabonne ou ré-enregistre sans geste utilisateur. */
export async function refreshPushSubscription(config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (sub) await registerOnServer(config, sub);
  else await subscribePush(config);
}

let lastSent = "";

export async function sendPushSchedule(
  categories: Partial<Record<PushCategory, PushScheduleRow[]>>,
  keepalive = false,
  config: OnlineSyncConfig = loadOnlineSyncConfig(),
): Promise<void> {
  const body = JSON.stringify({ deviceId: getOrCreateClientId(), categories });
  const stamp = `${config.vaultKey}\n${body}`;
  if (stamp === lastSent) return;
  const res = await fetch(apiUrl(config, "/api/push/schedule", true), {
    method: "PUT",
    headers: headers(config),
    body,
    // Chrome refuse un corps keepalive au-delà de 64 Ko.
    keepalive: keepalive && new Blob([body]).size < 60_000,
  });
  if (!res.ok) throw new Error(`push schedule ${res.status}`);
  lastSent = stamp;
}
```

- [ ] Vérifier : `pnpm typecheck` → 0 erreur.
- [ ] Point de contrôle : aucune clé, aucun jeton écrit ailleurs que dans les en-têtes des requêtes ; `refreshPushSubscription` ne demande jamais la permission (seulement si déjà accordée).

### Tâche 14 : interrupteur « Notifications app fermée »

**Fichiers :** Modifier `apps/web/src/components/settings/types.ts:61-66`, `apps/web/src/components/settings/defaults.ts:42-47`, `apps/web/src/components/settings/tabs/NotificationsTab.tsx:1-97`, `apps/web/src/app/parametres/page.tsx:63`, `:71`, `:171`

**Interfaces :**
- Consomme : `pushAvailability`, `subscribePush`, `unsubscribePush`, `PushAvailability` (tâche 13), `useOnlineSync()`, `Switch`, `Tooltip`, `Button` de `@supernote/ui`
- Produit : `NotificationSettings.pushSubscribed: boolean` (défaut `false`, lu par les tâches 15 et 16) ; `NotificationsTab({ onOpenSync }: { onOpenSync: () => void })`

Un nouveau défaut à `false` atteint les navigateurs existants : `loadInitialSettings` fusionne `notifications` clé par clé avec les défauts (`SettingsContext.tsx:47`).

- [ ] Étape 1 — `types.ts`, dans `NotificationSettings`, après `toastDuration: number;` : `pushSubscribed: boolean;`
- [ ] Étape 2 — `defaults.ts`, dans `notifications`, après `toastDuration: 4,` : `pushSubscribed: false,`
- [ ] Étape 3 — `NotificationsTab.tsx` : imports

```tsx
import { useState } from "react";
import { Bell, GearSix } from "@phosphor-icons/react";
import { Button } from "@heroui/react";
import { Button as UiButton, Switch, Tooltip } from "@supernote/ui";
import { useOnlineSync } from "@/lib/online-sync/OnlineSyncProvider";
import {
  pushAvailability,
  subscribePush,
  unsubscribePush,
  type PushAvailability,
} from "@/lib/push/push-client";
```

(les imports existants de `SettingsContext`, `SettingRow`, `SettingSection`, `ToggleSwitch`, `RangeSlider`, `@supernote/notifications/renderer` restent).

- [ ] Étape 4 — au-dessus de `export function NotificationsTab` :

```tsx
const PUSH_HINTS: Record<PushAvailability, string> = {
  ok: "Rappels, événements et relances, même Supernote fermé, sur tous les appareils du salon.",
  "ios-not-installed": "Ajoute Supernote à l'écran d'accueil pour recevoir les notifications.",
  unsupported: "Ce navigateur ne reçoit pas les notifications push.",
  "no-sync": "Active la synchronisation en ligne pour recevoir les notifications.",
  "no-password": "Protège ton salon par un mot de passe pour activer les notifications.",
};

function PushRow({ onOpenSync }: { onOpenSync: () => void }) {
  const { settings, updateSettings } = useSettings();
  const online = useOnlineSync();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subscribed = settings.notifications.pushSubscribed;
  const availability = online ? pushAvailability(online.config) : "no-sync";

  const toggle = async (next: boolean) => {
    setPending(true);
    setError(null);
    try {
      await (next ? subscribePush(online?.config) : unsubscribePush(online?.config));
      updateSettings("notifications", { ...settings.notifications, pushSubscribed: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <SettingRow label="Notifications app fermée" description={PUSH_HINTS[availability]}>
        <div className="flex items-center gap-2">
          {(availability === "no-sync" || availability === "no-password") && (
            <Tooltip content="Configurer le salon">
              <UiButton variant="ghost" size="icon" aria-label="Configurer le salon" onPress={onOpenSync}>
                <GearSix size={16} />
              </UiButton>
            </Tooltip>
          )}
          <Switch
            aria-label="Notifications app fermée"
            className="sn-hit"
            isSelected={subscribed}
            isDisabled={pending || (availability !== "ok" && !subscribed)}
            onChange={(next) => void toggle(next)}
          />
        </div>
      </SettingRow>
      {error && (
        <p role="alert" className="py-2 text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}
    </>
  );
}
```

- [ ] Étape 5 — `export function NotificationsTab() {` devient `export function NotificationsTab({ onOpenSync }: { onOpenSync: () => void }) {` ; insérer `<PushRow onOpenSync={onOpenSync} />` juste après le `</SettingRow>` de « Notifications OS ».
- [ ] Étape 6 — `app/parametres/page.tsx` : `function TabContent({ active, onOpenSync }: { active: SettingsTab; onOpenSync: () => void })` (l.63) ; `case "notifications": return <NotificationsTab onOpenSync={onOpenSync} />;` (l.71) ; `<TabContent active={activeTab} onOpenSync={() => setActiveTab("sync")} />` (l.171).
- [ ] Vérifier : `pnpm typecheck` → 0 erreur. Rendu 360 px : tâche 17.
- [ ] Point de contrôle : pas de toast ; l'échec s'affiche sous la ligne (`role="alert"`) et l'interrupteur reste sur l'état précédent ; en cas de refus de permission, il revient à off avec la raison.

### Tâche 15 : `PushScheduleRunner`

`blockUrl` reprend la table de `taskSourcePath` (plan planifier, tâche 2) sans l'importer, pour ne pas dépendre de ce module s'il n'est pas encore écrit ; à fusionner quand les deux plans sont livrés.

**Fichiers :** Créer `apps/web/src/lib/push/PushScheduleRunner.tsx` ; Modifier `apps/web/src/RootLayout.tsx:35` (import), `:85-86` (montage)

**Interfaces :**
- Consomme : `sendPushSchedule`, `refreshPushSubscription`, `PushCategory`, `PushScheduleRow` (tâche 13) ; `trpcVanillaClient.push.upcoming` (tâches 11-12) ; `loadFollowups`, `MAIL_FOLLOWUP_EVENT` (`lib/mail-followup.ts`) ; `loadSnoozed`, `MAIL_SNOOZE_EVENT` (`lib/mail-triage.ts`) ; `CALENDAR_CHANGED_EVENT` (`lib/calendar-mirror.ts`) ; `calendarAccount`, `isCalendarConnected` (`lib/calendar-sync.ts`) ; `mirrorAvailable` (`lib/mail-mirror.ts`, import seul) ; `hasWorkerBackend` (`lib/trpc/client.ts`) ; `onWorkerMessage` (`lib/trpc/browser-link.ts`) ; `useOnlineSync`, `useSettings`
- Produit : `export function PushScheduleRunner(): null`, monté **dans** `<OnlineSyncProvider>` (à la différence de `CalendarRunner`, `RootLayout.tsx:75`) parce que `useOnlineSync()` rend `null` hors du provider (`OnlineSyncProvider.tsx:291`).

`status === "connected"` part à l'ouverture du flux SSE (`online-sync/client.ts:242`), avant le rejeu : le premier envoi part 10 s après, le temps que le rejeu s'applique. Une fois vu `connected`, un décrochage de la synchro n'annule plus les envois (sinon chaque reconnexion repousserait le délai).

- [ ] Étape 1 — créer le fichier :

```tsx
"use client";

import { useEffect, useState } from "react";
import type { EntityOp } from "@supernote/sync";
import { useSettings } from "@/components/settings/SettingsContext";
import { useOnlineSync } from "@/lib/online-sync/OnlineSyncProvider";
import { onWorkerMessage } from "@/lib/trpc/browser-link";
import { hasWorkerBackend, trpcVanillaClient } from "@/lib/trpc/client";
import { mirrorAvailable } from "@/lib/mail-mirror";
import { CALENDAR_CHANGED_EVENT } from "@/lib/calendar-mirror";
import { calendarAccount, isCalendarConnected } from "@/lib/calendar-sync";
import { loadFollowups, MAIL_FOLLOWUP_EVENT } from "@/lib/mail-followup";
import { loadSnoozed, MAIL_SNOOZE_EVENT } from "@/lib/mail-triage";
import {
  refreshPushSubscription,
  sendPushSchedule,
  type PushCategory,
  type PushScheduleRow,
} from "./push-client";

const HORIZON_MS = 7 * 24 * 60 * 60_000;
// ponytail: prévenance fixe de 10 min ; un réglage si les notifications d'événement doublonnent avec Google Agenda.
const EVENT_LEAD_MS = 10 * 60_000;
const DEBOUNCE_MS = 10_000;
const TICK_MS = 15 * 60_000;
const CHANGE_EVENTS = [MAIL_FOLLOWUP_EVENT, MAIL_SNOOZE_EVENT, CALENDAR_CHANGED_EVENT];

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const threadUrl = (threadId: string) => `/mail?thread=${encodeURIComponent(threadId)}`;

function blockUrl(ref: string): string {
  const [kind = "", id = ""] = ref.split(":");
  if (kind === "todo") return `/todos?edit=${encodeURIComponent(id)}`;
  if (kind === "mail") return threadUrl(id);
  if (kind === "checklist") return `/notes/${encodeURIComponent(id)}`;
  return "/agenda";
}

async function computeSchedule(calendarAccountId: string): Promise<Partial<Record<PushCategory, PushScheduleRow[]>>> {
  const now = Date.now();
  // Lu à l'envoi : connecter l'agenda pose un drapeau localStorage sans re-rendre le runner.
  const accountId = isCalendarConnected() ? calendarAccountId : "";
  const ahead = (at: number) => at > now && at <= now + HORIZON_MS;
  const schedule: Partial<Record<PushCategory, PushScheduleRow[]>> = {
    followup: loadFollowups()
      .filter((f) => ahead(f.dueAt))
      .map((f) => ({
        key: `followup:${f.threadId}`,
        fireAt: f.dueAt,
        title: "Pas de réponse",
        body: f.subject,
        url: threadUrl(f.threadId),
        joinUrl: "",
      })),
    snooze: loadSnoozed()
      .filter((s) => ahead(s.until))
      .map((s) => ({
        key: `snooze:${s.threadId}`,
        fireAt: s.until,
        title: "De retour",
        body: s.subject || "Fil reporté",
        url: threadUrl(s.threadId),
        joinUrl: "",
      })),
  };
  // Sans worker, pas de source : une liste vide effacerait celle du salon.
  if (!mirrorAvailable()) return schedule;
  const { reminders, events } = await trpcVanillaClient.push.upcoming.query({
    from: now,
    to: now + HORIZON_MS,
    accountId,
  });
  schedule.reminder = reminders.map((r) => ({
    key: `reminder:${r.todoId}`,
    fireAt: r.reminderAt,
    title: "Rappel",
    body: r.reminderText || r.text,
    url: "/todos",
    joinUrl: "",
  }));
  // Sans agenda connecté, ne rien envoyer : un appareil sans Google viderait les événements du salon.
  if (accountId) {
    schedule.event = events
      .map((e): PushScheduleRow => {
        const key = `event:${e.calendarId}:${e.eventId}`;
        const body = e.summary || "(sans titre)";
        return e.sourceRef
          ? { key, fireAt: e.startAt, title: "C'est l'heure", body, url: blockUrl(e.sourceRef), joinUrl: e.meetUrl }
          : { key, fireAt: e.startAt - EVENT_LEAD_MS, title: `Dans ${EVENT_LEAD_MS / 60_000} min · ${hhmm(e.startAt)}`, body, url: "/agenda", joinUrl: e.meetUrl };
      })
      .filter((row) => row.fireAt > now);
  }
  return schedule;
}

export function PushScheduleRunner(): null {
  const { settings } = useSettings();
  const online = useOnlineSync();
  const subscribed = settings.notifications.pushSubscribed;
  const syncOn = Boolean(online?.config.enabled);
  const [synced, setSynced] = useState(false);
  const accountId = calendarAccount(settings)?.accountId ?? "";

  useEffect(() => {
    if (online?.status === "connected") setSynced(true);
  }, [online?.status]);

  useEffect(() => {
    if (!subscribed || !syncOn || !synced) return undefined;
    let debounce: number | undefined;
    const send = (keepalive = false) =>
      void computeSchedule(accountId)
        .then((categories) => sendPushSchedule(categories, keepalive))
        .catch((err: unknown) => console.warn("[push] envoi des échéances", err));
    const soon = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => send(), DEBOUNCE_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") send(true);
    };
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") send();
    }, TICK_MS);
    const stopWorker = hasWorkerBackend()
      ? onWorkerMessage((msg) => {
          const m = msg as { type?: string; op?: EntityOp };
          if (m.type === "ENTITY_CHANGE" && (m.op?.kind === "delete" || m.op?.payload?.typeId === "todo")) soon();
        })
      : () => undefined;
    void refreshPushSubscription().catch((err: unknown) => console.warn("[push] réabonnement", err));
    soon();
    for (const name of CHANGE_EVENTS) window.addEventListener(name, soon);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(tick);
      stopWorker();
      for (const name of CHANGE_EVENTS) window.removeEventListener(name, soon);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [subscribed, syncOn, synced, accountId]);

  return null;
}
```

- [ ] Étape 2 — `RootLayout.tsx` : `import { PushScheduleRunner } from "@/lib/push/PushScheduleRunner";` sous l'import de `CalendarRunner` ; puis entre `<OnlineSyncProvider>` et `<MountSyncProvider>` :

```tsx
                      {/* Échéances vers le serveur de push : lit l'état de la synchro, donc sous son provider. */}
                      <PushScheduleRunner />
```

- [ ] Vérifier : `pnpm typecheck` → 0 erreur. Envoi réel : e2e de la tâche 17.
- [ ] Point de contrôle : `git diff apps/web/src/lib/mail-mirror.ts apps/web/src/lib/gmail.ts` identique à l'état de départ (import seul).

### Tâche 16 : plus de notification système locale pour les rappels quand l'appareil est abonné

**Fichiers :** Modifier `apps/web/src/lib/pwa/AutomationNotificationBridge.tsx:37-87` (premier effet)

**Interfaces :**
- Consomme : `settings.notifications.pushSubscribed` (tâche 14) ; titre `"Rappel todo"` posé par `buildReminderAutomation` (`vault-worker/worker.ts:271-277`)
- Produit : rappels abonnés → tiroir in-app seulement ; le moteur local continue de poser `reminderFiredAt`.

- [ ] Étape 1 — dans le handler, juste après `push(payload);` :

```tsx
      // Abonné : le push affiche déjà la notification système des rappels (titre de buildReminderAutomation, worker.ts).
      const pushShowsIt = settings.notifications.pushSubscribed && detail.title === "Rappel todo";
```

puis la condition `if (settings.notifications.osNotifications && typeof window !== "undefined" && "Notification" in window)` devient :

```tsx
      if (
        settings.notifications.osNotifications &&
        !pushShowsIt &&
        typeof window !== "undefined" &&
        "Notification" in window
      ) {
```

- [ ] Étape 2 — tableau de dépendances de l'effet : ajouter `settings.notifications.pushSubscribed`.
- [ ] Vérifier : `pnpm typecheck` → 0 erreur.
- [ ] Point de contrôle : les autres automatisations (anniversaires, routines) gardent leur notification système.

### Tâche 17 : e2e de l'envoi et du réglage mobile

**Fichiers :** Modifier `tests/e2e/07-push.spec.ts` (tâche 10)

**Interfaces :**
- Consomme : `bootCloud(page)` (`tests/e2e/helpers.ts:33`), `window.__supernoteWorker` (`lib/trpc/browser-link.ts:103`, protocole `{ id, type, path, input }` → `{ id, ok, result | error }`), backend de synchro du serveur de dev (`DATABASE_URL` dans `apps/web/.env.local`)
- Produit : deux tests de plus dans `07 — notifications push`.

Le test d'envoi a besoin d'une vraie synchro `connected` : le serveur de dev Playwright monte le backend de synchro quand `DATABASE_URL` est dans `apps/web/.env.local` ; sinon, ou si `SYNC_TOKEN` y est posé, le test se déclare `skipped`. `/api/push/*` est intercepté, le backend push n'est pas nécessaire. Simuler la synchro par `page.route` a été écarté : une réponse SSE simulée se ferme aussitôt (`open` puis `error`, sonde du 2026-09-22) et React peut ne jamais rendre l'état `connected` entre les deux. Effet de bord connu : chaque passage laisse un salon `e2e…` dans la base de dev (`sync-dev.db`), visible dans `/admin`.

- [ ] Étape 1 — import : `import { bootCloud, bootDegraded } from "./helpers";` et `import { test, expect, type Page } from "@playwright/test";`
- [ ] Étape 2 — sous l'interface `Registration` :

```ts
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
```

- [ ] Étape 3 — dans le `describe`, après le premier test :

```ts
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
```

- [ ] Vérifier : `pnpm build:packages && pnpm test:e2e tests/e2e/07-push.spec.ts` → `3 passed` (ou `2 passed, 1 skipped` sans `DATABASE_URL` en dev, raison affichée).
- [ ] Point de contrôle : relire la spec à la main (hors typecheck) ; aucun helper partagé modifié.

### Tâche 18 : point de contrôle final et contrôle réel

**Fichiers :** aucun

**Interfaces :** Consomme tout ce qui précède.

- [ ] Vérifier — ensemble :

```bash
pnpm build:packages
pnpm typecheck
cd apps/web && for f in server.mjs sync-backend.mjs sync-store.mjs push-store.mjs push-backend.mjs public/sw.js; do node --check "$f" || echo "KO $f"; done; cd ../..
pnpm test:e2e
git status --short
```

Attendu : typecheck 0 erreur ; aucune ligne `KO` ; toutes les specs e2e vertes (07 : 3 tests, dont 1 éventuellement `skipped`) ; `git status` ne liste que les fichiers de ce plan, le lockfile, et les trois fichiers de l'autre session (`TodoMatrix.tsx`, `lib/gmail.ts`, `lib/mail-mirror.ts`) inchangés par nous.

- [ ] Contrôle réel (Amaury, après tâche 7 et déploiement) :
  1. Réglages › Notifications sur un salon protégé : l'interrupteur s'active, la permission est demandée.
  2. Android (Chrome), app fermée : un todo avec rappel dans 3 min sonne ; un événement Meet dans 12 min sonne à −10 min avec « Rejoindre », qui ouvre Meet ; une relance posée sur l'ordinateur sonne sur le téléphone ; le clic sur la notification ouvre la bonne page.
  3. iPhone, PWA installée, app fermée : mêmes cas (sans bouton « Rejoindre »).
  4. App ouverte et visible : la notification système s'affiche quand même, et l'entrée arrive aussi dans le tiroir.
  5. iPhone : trois push app ouverte, puis un quatrième app fermée qui doit encore arriver (la permission n'est pas révoquée).
- [ ] Point de contrôle : signaler à la session principale que la carte du codebase est périmée (`tech-landscape.md` : variables `VAPID_*` ; `communication.md` : routes `/api/push/*`, backend push dans `server.mjs`).

---

## Auto-relecture

| Exigence de la spec | Tâche |
|---|---|
| `web-push` installé, aucune entrée `allowBuilds` | 1 |
| `vaultAuthed` exporté, `vaultProtected` sur `pw:<salon>` | 2 |
| `push_subscription`, `push_schedule`, double moteur | 3 |
| routes `key` / `subscribe` / `unsubscribe` / `schedule`, auth, validation, 200 lignes, 7 j | 4 |
| planificateur 30 s `unref`, réservation atomique, ratée > 15 min, TTL 15 min, `topic`, 404/410, `lastOkAt`, purge 7 j | 5 |
| backend chargé par `server.mjs` si `DATABASE_URL` + clés VAPID ; `curl` à `now + 40 s` | 6 |
| clés VAPID générées et posées par l'utilisateur | 7 |
| handler `push` : `showNotification` + « Rejoindre » toujours, relais in-app en plus si une fenêtre est visible ; `notificationclick` générique ; `periodic-sync` conservé ; revérification `url` / `joinUrl` | 8 |
| relais in-app (`useNotificationsContext().push`) | 9 |
| e2e CDP `deliverPushMessage` + `getNotifications()` | 10 |
| contrat IPC `push.upcoming`, chaque champ déclaré | 11 |
| rappels (7 j, `reminderFiredAt` vide, non terminés) et événements (cochés, minutés, non déclinés, non annulés, `sourceRef`) | 12 |
| `push-client.ts` : permission, `pushManager.subscribe`, `POST subscribe`, arrêt des deux côtés, réabonnement si `getSubscription() === null` | 13 |
| interrupteur, iOS hors PWA, pas de synchro, salon non protégé, permission refusée, mobile | 14 |
| `PushScheduleRunner` : 4 catégories, titres/corps/URL, déclencheurs (démarrage, 10 s, 15 min, `hidden` + `keepalive`), source requise par catégorie | 15 |
| plus de `new Notification` pour les rappels abonnés | 16 |
| e2e `PUT` contenant `reminder:<todoId>` ; réglage à 360 px | 17 |
| typecheck, contrôle réel Android + iPhone | 18 |

Placeholders : aucun hors les `<…>` de la tâche 7, volontaires (secrets d'Amaury). Noms vérifiés d'une tâche à l'autre : `pushSubscribed`, `PUSH_RECEIVED`, `push.upcoming`, `PushScheduleRow`, `sendPushSchedule`, `refreshPushSubscription`, `createPushBackend`, `createPushStore`, `vaultProtected`, `resolveSqlitePath`.
