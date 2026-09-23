# Notifications par défaut, mails en push, PWA — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push activé par défaut via un bandeau, notification à chaque nouveau mail (Gmail watch → Pub/Sub → Web Push), badge, actions de notification, raccourcis et cible de partage PWA.

**Architecture:** Le serveur Scalingo (`push-backend.mjs`) reçoit les webhooks Pub/Sub et pousse un signal `kind: "mail"` sans contenu. Le service worker (`public/sw.js`) enrichit la notification avec un jeton Gmail court que la page recopie dans une base IndexedDB dédiée (`supernote-sw`). Sans jeton valide, il affiche une notification générique. La page gère le bandeau de permission, le renouvellement du watch, le badge et les deep-links (`/mail?compose|new|action`, `/share`).

**Tech Stack:** React 19 + Vite SPA, HeroUI v3 + `@supernote/ui`, `@phosphor-icons/react`, Node `server.mjs` (zéro dépendance au runtime), `web-push`, SQLite/Postgres (`push-store.mjs`), Gmail REST v1, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-23-notifications-pwa-design.md`

## Global Constraints

- Politique **zéro test unitaire** : aucun `*.test.ts`, pas de vitest. Vérif = `pnpm typecheck` + e2e Playwright (`pnpm test:e2e`) + `curl` pour le serveur.
- UI : HeroUI v3 / `@supernote/ui` uniquement ; boutons icône phosphor + `Tooltip` de `@supernote/ui` + `aria-label` obligatoire.
- Pas de toasts : le retour passe par le bouton (`lib/action-feedback.tsx`) ; toast seulement pour une erreur orpheline.
- Mobile dans le même mouvement : `px-4 md:px-10`, cibles ≥ 32 px.
- Commentaires : français, une ligne, uniquement le POURQUOI non déductible.
- TypeScript strict, pas de `any`.
- Le serveur ne stocke **jamais** de jeton Gmail ni de contenu de mail, et ne les journalise pas.
- Tout push affiche une notification (sinon Safari révoque la permission).
- Base IndexedDB SW : nom `supernote-sw`, version `1`, un store `kv` ; clés `gmailToken` (`{ token: string, expiresAt: number }`), `mailHistoryId` (string), `badgeCount` (number). **Jamais** la base des handles de coffre.
- Variables serveur : `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUSH_SECRET`. Absentes → routes mail inactives, le reste du push inchangé.
- Conventional commits en français (`feat(push): …`). Un commit par tâche, **seulement les fichiers de la tâche** : l'arbre de travail est partagé avec une autre session.
- Paquets `@supernote/*` consommés via `dist/` : aucun n'est touché ici, pas de `pnpm build:packages` requis.

## File Structure

| Fichier | Responsabilité | Tâche |
|---|---|---|
| `apps/web/src/components/settings/defaults.ts` | `pushSubscribed: true` | 1 |
| `apps/web/src/lib/push/push-client.ts` | `ensurePushSubscription`, `pushPromptState`, `fetchPushConfig` | 1, 5 |
| `apps/web/src/lib/push/PushScheduleRunner.tsx` | appelle `ensurePushSubscription` + `renewMailWatch` | 1, 5 |
| `apps/web/src/components/mail/PushPromptBanner.tsx` (nouveau) | bandeau de permission | 1 |
| `apps/web/src/app/mail/page.tsx` | bandeau, `?compose=1`, `?new=note`, `?action=` | 1, 4, 6 |
| `apps/web/push-store.mjs` | table `push_mail_watch` | 2 |
| `apps/web/push-backend.mjs` | `/api/push/mail-watch`, `/api/push/gmail`, `gmailTopic` dans `/key` | 2 |
| `apps/web/src/lib/sw-kv.ts` (nouveau) | lecture/écriture IndexedDB `supernote-sw` côté page | 3 |
| `apps/web/src/lib/google-drive.ts` | recopie du jeton Gmail dans `sw-kv` | 3 |
| `apps/web/src/lib/mail-sync.ts` | écrit `mailHistoryId` après chaque synchro | 3 |
| `apps/web/src/hooks/useInboxUnreadCount.ts` | `setAppBadge` + `badgeCount` | 3 |
| `apps/web/public/manifest.json` | `shortcuts`, `share_target` | 4 |
| `apps/web/public/icons/shortcuts/*.png` (nouveaux) | icônes 96 px | 4 |
| `apps/web/src/app/share/page.tsx` (nouveau) + `src/router.tsx` | route `/share` | 4 |
| `apps/web/public/sw.js` | share-target (4) ; push mail + actions (6) | 4, 6 |
| `apps/web/src/lib/mail-push-watch.ts` (nouveau) | `users.watch` + inscription serveur | 5 |
| `tests/e2e/08-notifications-pwa.spec.ts` (nouveau) | e2e A, C, actions | 1, 4, 6 |

**Vagues** : 1, 2, 3 et 4 en parallèle. Puis 5 (après 2 et 3) et 6 (après 3 et 4, puisqu'il touche `sw.js` après 4).

---

### Task 1: Push activé par défaut + bandeau de permission (A)

**Files:**
- Modify: `apps/web/src/components/settings/defaults.ts:47`
- Modify: `apps/web/src/lib/push/push-client.ts`
- Modify: `apps/web/src/lib/push/PushScheduleRunner.tsx`
- Create: `apps/web/src/components/mail/PushPromptBanner.tsx`
- Modify: `apps/web/src/app/mail/page.tsx` (insertion au-dessus de la liste, desktop et mobile)
- Test: `tests/e2e/08-notifications-pwa.spec.ts`

**Interfaces:**
- Produces: `ensurePushSubscription(config?: OnlineSyncConfig): Promise<void>` ; `pushPromptState(config?: OnlineSyncConfig): PushPrompt` avec `type PushPrompt = "hidden" | "ask" | "protect" | "install"` ; `dismissPushPrompt(): void` ; constante `PUSH_PROMPT_KEY = "supernote.push.promptDismissedUntil"`.

- [ ] **Step 1: Défaut**

`defaults.ts` : `pushSubscribed: true,`. Vérifier que le chargement des réglages fusionne les défauts (un utilisateur existant avec `pushSubscribed: false` enregistré reste à `false` : c'est voulu, il l'a coupé ou ne l'a jamais activé. Si les réglages stockés contiennent `false` **par défaut** faute de choix explicite, c'est acceptable, le bandeau n'apparaîtra pas pour lui ; le noter dans le rapport de tâche).

- [ ] **Step 2: `push-client.ts`**

Ajouter en fin de fichier :

```ts
export const PUSH_PROMPT_KEY = "supernote.push.promptDismissedUntil";
const PROMPT_SNOOZE_MS = 14 * 24 * 60 * 60_000;

export type PushPrompt = "hidden" | "ask" | "protect" | "install";

export function pushPromptState(config: OnlineSyncConfig = loadOnlineSyncConfig()): PushPrompt {
  if (typeof Notification === "undefined" && pushAvailability(config) !== "ios-not-installed") return "hidden";
  try {
    if (Number(localStorage.getItem(PUSH_PROMPT_KEY) ?? 0) > Date.now()) return "hidden";
  } catch {
    /* stockage indisponible : on montre le bandeau */
  }
  const availability = pushAvailability(config);
  if (availability === "ios-not-installed") return "install";
  if (availability === "no-password") return "protect";
  if (availability !== "ok" || Notification.permission !== "default") return "hidden";
  return "ask";
}

export function dismissPushPrompt(): void {
  try {
    localStorage.setItem(PUSH_PROMPT_KEY, String(Date.now() + PROMPT_SNOOZE_MS));
  } catch {
    /* rien à retenir */
  }
}

/** Permission déjà accordée : abonne sans geste. Sinon le bandeau prend le relais. */
export async function ensurePushSubscription(config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<void> {
  if (pushAvailability(config) !== "ok" || Notification.permission !== "granted") return;
  await refreshPushSubscription(config);
}
```

- [ ] **Step 3: Runner**

Dans `PushScheduleRunner.tsx`, remplacer `void refreshPushSubscription()…` par `void ensurePushSubscription(online?.config).catch(…)` (même message de log). Mettre à jour l'import.

- [ ] **Step 4: `PushPromptBanner.tsx`**

```tsx
"use client";

import { useState } from "react";
import { BellRinging, X } from "@phosphor-icons/react";
import { Button, Tooltip } from "@supernote/ui";
import { useSettings } from "@/components/settings/SettingsContext";
import { useOnlineSync } from "@/lib/online-sync/OnlineSyncProvider";
import { dismissPushPrompt, pushPromptState, subscribePush } from "@/lib/push/push-client";

const COPY = {
  ask: "Reçois tes mails, rappels et relances même Supernote fermé.",
  protect: "Protège ton salon par un mot de passe pour recevoir les notifications app fermée.",
  install: "Ajoute Supernote à l'écran d'accueil pour recevoir les notifications.",
} as const;

export function PushPromptBanner({ onOpenSync }: { onOpenSync: () => void }) {
  const { settings, updateSettings } = useSettings();
  const online = useOnlineSync();
  const [state, setState] = useState(() => pushPromptState(online?.config));
  const [error, setError] = useState<string | null>(null);
  if (!settings.notifications.pushSubscribed || state === "hidden") return null;

  const activate = async () => {
    setError(null);
    try {
      await subscribePush(online?.config);
      updateSettings("notifications", { ...settings.notifications, pushSubscribed: true });
      setState("hidden");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div role="region" aria-label="Notifications" className="mx-4 my-2 flex items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm md:mx-10">
      <BellRinging size={18} aria-hidden />
      <p className="min-w-0 flex-1">{error ?? COPY[state]}</p>
      {state === "ask" && <Button size="sm" onPress={() => void activate()}>Activer</Button>}
      {state === "protect" && <Button size="sm" variant="ghost" onPress={onOpenSync}>Protéger le salon</Button>}
      <Tooltip content="Plus tard">
        <Button variant="ghost" size="icon" className="sn-hit" aria-label="Plus tard" onPress={() => { dismissPushPrompt(); setState("hidden"); }}>
          <X size={16} />
        </Button>
      </Tooltip>
    </div>
  );
}
```

Adapter les props de `Button` de `@supernote/ui` à son API réelle (lire `packages/ui/src` pour `variant`/`size`). Brancher le retour chargement → coche via `lib/action-feedback.tsx` si ce module expose un wrapper de bouton ; sinon garder `isPending`.

- [ ] **Step 5: Insertion dans `/mail`**

Dans `app/mail/page.tsx`, rendre `<PushPromptBanner onOpenSync={…} />` juste au-dessus de la liste des fils (rendu commun desktop/mobile). `onOpenSync` : réutiliser la même ouverture des réglages de salon que la page utilise déjà (chercher `onOpenSync` / ouverture des Settings sur l'onglet synchro, par ex. dans `components/settings`). Si aucune ouverture programmatique n'existe, naviguer vers les réglages par le mécanisme existant du `TopBar`.

- [ ] **Step 6: e2e**

Créer `tests/e2e/08-notifications-pwa.spec.ts` (réutiliser `bootCloud`, `mockGoogleApis` de `tests/e2e/helpers`) :

```ts
import { test, expect } from "@playwright/test";
import { bootCloud } from "./helpers";

test.describe("08 — notifications & PWA", () => {
  test("A : le bandeau propose le push, Plus tard le masque", async ({ page }) => {
    await bootCloud(page, { password: "e2e-pass" });
    await page.goto("/mail");
    const banner = page.getByRole("region", { name: "Notifications" });
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Plus tard" }).click();
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(page.getByRole("region", { name: "Notifications" })).toBeHidden();
  });
});
```

Adapter l'appel `bootCloud` à sa signature réelle : il faut un salon **protégé** (jeton présent). Si `bootCloud` ne sait pas poser de mot de passe, ajouter l'option dans le helper.

- [ ] **Step 7: Vérifier**

Run: `pnpm typecheck` → PASS. Run: `pnpm test:e2e -- 08-notifications-pwa` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components/settings/defaults.ts apps/web/src/lib/push/push-client.ts apps/web/src/lib/push/PushScheduleRunner.tsx apps/web/src/components/mail/PushPromptBanner.tsx apps/web/src/app/mail/page.tsx tests/e2e/08-notifications-pwa.spec.ts
git commit -m "feat(push): activé par défaut avec bandeau de permission dans /mail"
```

---

### Task 2: Serveur — watch Gmail et webhook Pub/Sub (B)

**Files:**
- Modify: `apps/web/push-store.mjs`
- Modify: `apps/web/push-backend.mjs`

**Interfaces:**
- Produces (HTTP) :
  - `GET /api/push/key` → `{ publicKey: string, gmailTopic: string }` (`gmailTopic` vide si non configuré).
  - `POST /api/push/mail-watch?vault=<v>` (en-tête `x-sync-token`), corps `{ accessToken: string }` → `200 { ok: true, email }` | `400` | `401` | `403` | `404` si mail désactivé.
  - `POST /api/push/gmail?key=<GMAIL_PUSH_SECRET>`, corps Pub/Sub `{ message: { data: base64(JSON {emailAddress, historyId}) } }` → `204` | `403`.
  - Payload Web Push : `{ kind: "mail", title: "Nouveau mail", body: "", url: "/mail", tag: "mail-new", historyId: string, email: string }`.

- [ ] **Step 1: Store**

Ajouter à `SCHEMA` :

```sql
CREATE TABLE IF NOT EXISTS push_mail_watch (
  email     TEXT NOT NULL,
  vault     TEXT NOT NULL,
  updatedat BIGINT NOT NULL,
  PRIMARY KEY (email, vault)
);
```

Et au store retourné :

```js
upsertMailWatch: ({ email, vault }) =>
  db.run(
    `INSERT INTO push_mail_watch (email, vault, updatedat) VALUES (?, ?, ?)
     ON CONFLICT (email, vault) DO UPDATE SET updatedat = excluded.updatedat`,
    [email, vault, Date.now()],
  ),
listMailWatchVaults: async (email) =>
  (await db.all(`SELECT vault FROM push_mail_watch WHERE email = ?`, [email])).map((r) => r.vault),
purgeMailWatch: (before) => db.run(`DELETE FROM push_mail_watch WHERE updatedat < ?`, [before]),
```

- [ ] **Step 2: Backend — config et `/key`**

Dans `createPushBackend`, après les clés VAPID :

```js
const gmailTopic = process.env.GMAIL_PUBSUB_TOPIC ?? "";
const gmailSecret = process.env.GMAIL_PUSH_SECRET ?? "";
const mailEnabled = Boolean(gmailTopic && gmailSecret);
const MAIL_COALESCE_MS = 30_000;
const MAIL_WATCH_TTL_MS = 8 * 24 * 60 * 60 * 1000;
```

`/api/push/key` renvoie `{ publicKey, gmailTopic: mailEnabled ? gmailTopic : "" }`.

Dans `tick()`, ajouter `await store.purgeMailWatch(Date.now() - MAIL_WATCH_TTL_MS);`.

- [ ] **Step 3: Coalescence**

```js
// Une rafale Pub/Sub (lecture, archivage, plusieurs arrivées) ne fait qu'un push par fenêtre.
const mailPending = new Map(); // `${vault}\n${email}` → { lastSentAt, timer, historyId }

async function sendMail(vault, email, historyId) {
  const payload = JSON.stringify({ kind: "mail", title: "Nouveau mail", body: "", url: "/mail", tag: "mail-new", historyId, email });
  const subs = await store.listSubscriptions(vault);
  await Promise.all(subs.map((sub) => deliver(sub, payload, topicOf(`mail:${email}`))));
  console.log(`[push] mail → ${subs.length} abonnement(s)`);
}

function queueMail(vault, email, historyId) {
  const key = `${vault}\n${email}`;
  const entry = mailPending.get(key) ?? { lastSentAt: 0, timer: null, historyId };
  entry.historyId = historyId;
  mailPending.set(key, entry);
  if (entry.timer) return;
  const wait = Math.max(0, entry.lastSentAt + MAIL_COALESCE_MS - Date.now());
  entry.timer = setTimeout(() => {
    entry.timer = null;
    entry.lastSentAt = Date.now();
    void sendMail(vault, email, entry.historyId).catch((err) => console.warn("[push] mail", err));
  }, wait);
  if (typeof entry.timer.unref === "function") entry.timer.unref();
}
```

- [ ] **Step 4: `/api/push/gmail`**

À placer **avant** le contrôle `vault` (pas d'authentification de salon, la clé fait foi) :

```js
if (path === "/api/push/gmail" && req.method === "POST") {
  const given = Buffer.from(url.searchParams.get("key") ?? "");
  const expected = Buffer.from(gmailSecret);
  if (!mailEnabled || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    sendJson(res, 403, { error: "forbidden" });
    return true;
  }
  const body = await readJson(req);
  res.writeHead(204, CORS);
  res.end();
  try {
    const data = JSON.parse(Buffer.from(body?.message?.data ?? "", "base64").toString("utf8"));
    const email = typeof data?.emailAddress === "string" ? data.emailAddress.toLowerCase() : "";
    const historyId = data?.historyId != null ? String(data.historyId) : "";
    if (!email || !historyId) return true;
    for (const vault of await store.listMailWatchVaults(email)) queueMail(vault, email, historyId);
  } catch {
    /* message Pub/Sub illisible : acquitté, ignoré */
  }
  return true;
}
```

Importer `timingSafeEqual` depuis `node:crypto`.

- [ ] **Step 5: `/api/push/mail-watch`**

Après les contrôles `vaultAuthed` / `vaultProtected` :

```js
if (path === "/api/push/mail-watch" && req.method === "POST") {
  if (!mailEnabled) {
    sendJson(res, 404, { error: "mail push disabled" });
    return true;
  }
  const body = await readJson(req);
  const accessToken = body?.accessToken;
  if (typeof accessToken !== "string" || !accessToken) {
    sendJson(res, 400, { error: "missing accessToken" });
    return true;
  }
  // Preuve que l'appelant possède l'adresse ; le jeton n'est ni gardé ni journalisé.
  const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const email = typeof profile?.emailAddress === "string" ? profile.emailAddress.toLowerCase() : "";
  if (!email) {
    sendJson(res, 400, { error: "gmail profile refused" });
    return true;
  }
  await store.upsertMailWatch({ email, vault });
  sendJson(res, 200, { ok: true, email });
  return true;
}
```

- [ ] **Step 6: Vérifier au `curl`**

Lancer le serveur local avec `DATABASE_URL`, les clés VAPID (`npx web-push generate-vapid-keys`), `GMAIL_PUBSUB_TOPIC=projects/x/topics/y` et `GMAIL_PUSH_SECRET=s3cret` (voir `docs`/`onboarding.md` pour la commande de démarrage de `server.mjs`).

```bash
curl -s localhost:$PORT/api/push/key                      # → {"publicKey":"…","gmailTopic":"projects/x/topics/y"}
curl -s -o /dev/null -w '%{http_code}\n' -X POST "localhost:$PORT/api/push/gmail?key=bad" -d '{}'   # → 403
DATA=$(printf '{"emailAddress":"a@b.c","historyId":"42"}' | base64 -w0)
curl -s -o /dev/null -w '%{http_code}\n' -X POST "localhost:$PORT/api/push/gmail?key=s3cret" -d "{\"message\":{\"data\":\"$DATA\"}}"  # → 204
```

Expected : codes ci-dessus, aucun plantage. Log `[push] mail → N abonnement(s)` uniquement si une ligne `push_mail_watch` existe pour `a@b.c` (insérer à la main en SQLite pour le voir).

- [ ] **Step 7: Commit**

```bash
git add apps/web/push-store.mjs apps/web/push-backend.mjs
git commit -m "feat(push): webhook Pub/Sub Gmail et inscription du watch côté serveur"
```

---

### Task 3: Pont page → SW (jeton, historyId, badge)

**Files:**
- Create: `apps/web/src/lib/sw-kv.ts`
- Modify: `apps/web/src/lib/google-drive.ts` (callback de `requestAccessToken`, `clearAccessToken`, `forgetAccessToken`)
- Modify: `apps/web/src/lib/mail-sync.ts` (fin de `syncMailbox`)
- Modify: `apps/web/src/hooks/useInboxUnreadCount.ts`

**Interfaces:**
- Produces: `swKvSet(key: SwKvKey, value: unknown): Promise<void>`, `swKvGet<T>(key: SwKvKey): Promise<T | undefined>`, `swKvDelete(key: SwKvKey): Promise<void>`, `type SwKvKey = "gmailToken" | "mailHistoryId" | "badgeCount"`, `setBadge(n: number): void`.

- [ ] **Step 1: `sw-kv.ts`**

```ts
// Base dédiée : ne jamais faire évoluer la version de celle des handles de coffre.
const DB_NAME = "supernote-sw";
const STORE = "kv";

export type SwKvKey = "gmailToken" | "mailHistoryId" | "badgeCount";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  if (typeof indexedDB === "undefined") return undefined;
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const swKvGet = <T>(key: SwKvKey) => run<T>("readonly", (s) => s.get(key));
export const swKvSet = async (key: SwKvKey, value: unknown) => void (await run("readwrite", (s) => s.put(value, key)));
export const swKvDelete = async (key: SwKvKey) => void (await run("readwrite", (s) => s.delete(key)));

export function setBadge(n: number): void {
  void swKvSet("badgeCount", n).catch(() => undefined);
  if (!("setAppBadge" in navigator)) return;
  void (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => undefined);
}
```

- [ ] **Step 2: `google-drive.ts`**

Dans le callback de `requestAccessToken`, après `tokenCache.set(…)` :

```ts
const granted = (response.scope ?? scope).split(" ");
// Le SW réveillé par un push n'a pas accès à la mémoire de la page.
if (granted.includes(GMAIL_MODIFY_SCOPE)) {
  void swKvSet("gmailToken", { token: response.access_token, expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 }).catch(() => undefined);
}
```

`GMAIL_MODIFY_SCOPE` est défini plus bas dans le même fichier (`:773`) : le déplacer en haut ou référencer la chaîne. Dans `clearAccessToken` et `forgetAccessToken` : `void swKvDelete("gmailToken").catch(() => undefined);` (au pire, le SW retombe sur la notif générique).

- [ ] **Step 3: `mail-sync.ts`**

Dans `syncMailbox`, après la synchro et avant `dispatchEvent(MAIL_SYNCED_EVENT)` :

```ts
const after = await trpcVanillaClient.mail.getState.query({ accountId });
if (after.historyId) void swKvSet("mailHistoryId", after.historyId).catch(() => undefined);
```

- [ ] **Step 4: Badge**

Dans `useInboxUnreadCount.ts`, dans le `.then((n) => …)` : appeler `setBadge(n)` (avant le test `cancelled`, puisque le badge ne dépend pas du montage).

- [ ] **Step 5: Vérifier**

Run: `pnpm typecheck` → PASS. Dans le navigateur (`pnpm dev`, Gmail connecté), DevTools → Application → IndexedDB → `supernote-sw/kv` contient `gmailToken`, `mailHistoryId`, `badgeCount`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/sw-kv.ts apps/web/src/lib/google-drive.ts apps/web/src/lib/mail-sync.ts apps/web/src/hooks/useInboxUnreadCount.ts
git commit -m "feat(pwa): jeton Gmail, historyId et badge non-lus partagés avec le service worker"
```

---

### Task 4: Raccourcis d'icône et partage vers Supernote (C)

**Files:**
- Modify: `apps/web/public/manifest.json`
- Create: `apps/web/public/icons/shortcuts/{mail,note,agenda,todos}.png` (96×96)
- Modify: `apps/web/public/sw.js` (interception `POST /share-target`, en tête du handler `fetch`)
- Create: `apps/web/src/app/share/page.tsx`
- Modify: `apps/web/src/router.tsx` (route `/share`)
- Modify: `apps/web/src/app/mail/page.tsx` (`?compose=1`, `?new=note`)
- Test: `tests/e2e/08-notifications-pwa.spec.ts`

**Interfaces:**
- Produces: Cache Storage `share-inbox`, entrée `/share-target/pending` = `Response` JSON `{ title, text, url, files: { name, type, dataUrl }[] }`.

- [ ] **Step 1: Manifest**

Ajouter :

```json
"shortcuts": [
  { "name": "Nouveau message", "url": "/mail?compose=1", "icons": [{ "src": "/icons/shortcuts/mail.png", "sizes": "96x96" }] },
  { "name": "Nouvelle note", "url": "/mail?new=note", "icons": [{ "src": "/icons/shortcuts/note.png", "sizes": "96x96" }] },
  { "name": "Agenda", "url": "/agenda", "icons": [{ "src": "/icons/shortcuts/agenda.png", "sizes": "96x96" }] },
  { "name": "Todos", "url": "/todos", "icons": [{ "src": "/icons/shortcuts/todos.png", "sizes": "96x96" }] }
],
"share_target": {
  "action": "/share-target",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": { "title": "title", "text": "text", "url": "url", "files": [{ "name": "files", "accept": ["image/*"] }] }
}
```

Icônes : générer 4 PNG 96×96 (glyphe phosphor blanc sur `#1d2027`, coins arrondis) avec un script Node ponctuel **non commité** (sharp n'est pas une dépendance : utiliser `rsvg-convert` ou `magick` s'ils sont présents, sinon dessiner via Playwright `page.screenshot` d'un SVG).

- [ ] **Step 2: SW — share-target**

En tête du listener `fetch`, avant tout autre traitement :

```js
if (event.request.method === "POST" && new URL(event.request.url).pathname === "/share-target") {
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const files = [];
      for (const file of form.getAll("files")) {
        if (!(file instanceof File) || !file.type.startsWith("image/")) continue;
        const bytes = new Uint8Array(await file.arrayBuffer());
        let bin = "";
        for (const b of bytes) bin += String.fromCharCode(b);
        files.push({ name: file.name, type: file.type, dataUrl: `data:${file.type};base64,${btoa(bin)}` });
      }
      const shared = { title: text(form.get("title")), text: text(form.get("text")), url: text(form.get("url")), files };
      const cache = await caches.open("share-inbox");
      await cache.put("/share-target/pending", new Response(JSON.stringify(shared), { headers: { "Content-Type": "application/json" } }));
      return Response.redirect("/share?pending=1", 303);
    })(),
  );
  return;
}
```

`text` est déjà défini plus bas dans `sw.js` (`const text = …`) : le remonter au-dessus du listener `fetch`. Ne pas toucher à `CACHE_VERSION` : `share-inbox` n'est pas purgé par l'activation, vérifier que le nettoyage des vieux caches à l'`activate` épargne `share-inbox` (sinon l'ajouter à l'exclusion).

- [ ] **Step 3: Route `/share`**

`app/share/page.tsx` : au montage, lit `caches.open("share-inbox")` → `match("/share-target/pending")`, puis supprime l'entrée. Crée la note via `useCreateNote().createNote({ folder: "Inbox", title })`, avec `title = shared.title || shared.url || "Partage"`. Écrit ensuite le corps markdown (`text`, puis `url` en lien, puis les images) via la mutation d'update du corps utilisée par l'éditeur (chercher `entities.update` avec `body` dans `components/notes/hooks.ts`). Les images passent par le chemin de collage existant (`vault-file-adapter.ts`) : convertir `dataUrl` en `File` et appeler la même fonction d'écriture de pièce jointe que le collage. Enfin `router.replace(\`/notes/${id}?folder=Inbox\`)`. Si `!hasWorkerBackend()`, afficher « Ouvre un coffre pour recevoir des partages ». Pendant le traitement, afficher un `Spinner` HeroUI centré.

Ajouter la route dans `router.tsx` au même niveau que `/mail`.

- [ ] **Step 4: `/mail?compose=1` et `?new=note`**

À côté du deep-link `thread` (`app/mail/page.tsx:~685`) :

```tsx
const newInboxNote = useNewInboxNote();
useEffect(() => {
  const compose = searchParams.get("compose");
  const newNote = searchParams.get("new");
  if (!compose && !newNote) return;
  const next = new URLSearchParams(searchParams);
  next.delete("compose");
  next.delete("new");
  setSearchParams(next, { replace: true });
  if (newNote === "note") void newInboxNote();
  else if (connected) openCompose();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [searchParams, connected]);
```

- [ ] **Step 5: e2e**

Ajouter à `08-notifications-pwa.spec.ts` :

```ts
test("C : /mail?compose=1 ouvre la composition", async ({ page }) => {
  await bootCloud(page);
  await mockGoogleApis(page);
  await page.goto("/mail?compose=1");
  await expect(page.getByRole("dialog", { name: /nouveau message/i })).toBeVisible();
  await expect(page).toHaveURL(/\/mail$/);
});

test("C : un partage crée une note Inbox", async ({ page }) => {
  await bootCloud(page);
  await page.goto("/mail");
  await page.evaluate(async () => {
    const cache = await caches.open("share-inbox");
    await cache.put("/share-target/pending", new Response(JSON.stringify({ title: "Article partagé", text: "à lire", url: "https://example.com", files: [] })));
  });
  await page.goto("/share?pending=1");
  await expect(page).toHaveURL(/\/notes\//);
  await expect(page.getByText("Article partagé").first()).toBeVisible();
});
```

Ajuster le sélecteur du compose au nom accessible réel. `mockGoogleApis` : importer depuis `./helpers`. Le test de partage court-circuite le SW (le POST multipart n'est pas simulable sans PWA installée). C'est la route `/share` qui est vérifiée.

- [ ] **Step 6: Vérifier**

Run: `pnpm typecheck` → PASS. Run: `pnpm test:e2e -- 08-notifications-pwa` → PASS. `pnpm build` puis Chrome DevTools → Application → Manifest : raccourcis et share target listés sans erreur.

- [ ] **Step 7: Commit**

```bash
git add apps/web/public/manifest.json apps/web/public/icons/shortcuts apps/web/public/sw.js apps/web/src/app/share/page.tsx apps/web/src/router.tsx apps/web/src/app/mail/page.tsx tests/e2e/08-notifications-pwa.spec.ts
git commit -m "feat(pwa): raccourcis d'icône et partage vers une note Inbox"
```

---

### Task 5: Renouvellement du watch Gmail côté client (B)

Dépend de 2 (routes) et 3 (aucune interface, mais même zone de la page).

**Files:**
- Create: `apps/web/src/lib/mail-push-watch.ts`
- Modify: `apps/web/src/lib/push/push-client.ts` (`fetchPushConfig`)
- Modify: `apps/web/src/lib/push/PushScheduleRunner.tsx`

**Interfaces:**
- Consumes: `GET /api/push/key` → `{ publicKey, gmailTopic }` ; `POST /api/push/mail-watch` (Task 2) ; `googleRequest` (`lib/google-api.ts`) ; `hasGmailToken(clientId)` (`lib/gmail.ts`).
- Produces: `renewMailWatch(clientId: string, config?: OnlineSyncConfig): Promise<void>`.

- [ ] **Step 1: `fetchPushConfig`**

Dans `push-client.ts`, extraire l'appel `/api/push/key` de `subscribePush` :

```ts
export async function fetchPushConfig(config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<{ publicKey: string; gmailTopic: string }> {
  const res = await fetch(apiUrl(config, "/api/push/key", false));
  const body = res.ok ? ((await res.json().catch(() => null)) as { publicKey?: unknown; gmailTopic?: unknown } | null) : null;
  return {
    publicKey: typeof body?.publicKey === "string" ? body.publicKey : "",
    gmailTopic: typeof body?.gmailTopic === "string" ? body.gmailTopic : "",
  };
}
```

`subscribePush` l'utilise (`const { publicKey: key } = await fetchPushConfig(config)`).

- [ ] **Step 2: `mail-push-watch.ts`**

```ts
import { googleRequest } from "@/lib/google-api";
import { GMAIL_MODIFY_SCOPE, requestAccessToken } from "@/lib/google-drive";
import { hasGmailToken } from "@/lib/gmail";
import { loadOnlineSyncConfig, type OnlineSyncConfig } from "@/lib/online-sync/config-storage";
import { fetchPushConfig, pushAvailability } from "@/lib/push/push-client";

const RENEWED_KEY = "supernote.mailWatch.renewedAt";
// Gmail fait expirer un watch au bout de 7 jours.
const RENEW_EVERY_MS = 24 * 60 * 60_000;

export async function renewMailWatch(clientId: string, config: OnlineSyncConfig = loadOnlineSyncConfig()): Promise<void> {
  if (!clientId || pushAvailability(config) !== "ok" || Notification.permission !== "granted") return;
  // Jamais d'acquisition de jeton hors geste : GIS ouvrirait une popup.
  if (!hasGmailToken(clientId)) return;
  const last = Number(localStorage.getItem(RENEWED_KEY) ?? 0);
  if (Date.now() - last < RENEW_EVERY_MS) return;
  const { gmailTopic } = await fetchPushConfig(config);
  if (!gmailTopic) return;
  await googleRequest(clientId, GMAIL_MODIFY_SCOPE, "https://gmail.googleapis.com/gmail/v1/users/me/watch", {
    method: "POST",
    json: true,
    body: JSON.stringify({ topicName: gmailTopic, labelIds: ["INBOX"], labelFilterBehavior: "include" }),
  }, "Gmail watch");
  const accessToken = await requestAccessToken(clientId, { scope: GMAIL_MODIFY_SCOPE, prompt: "" });
  const base = config.serverUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/push/mail-watch?vault=${encodeURIComponent(config.vaultKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(config.token ? { "x-sync-token": config.token } : {}) },
    body: JSON.stringify({ accessToken }),
  });
  if (!res.ok) throw new Error(`mail-watch ${res.status}`);
  localStorage.setItem(RENEWED_KEY, String(Date.now()));
}
```

Vérifier que `hasGmailToken` teste bien un scope couvrant `gmail.modify`. Sinon utiliser `hasValidToken(clientId, GMAIL_MODIFY_SCOPE)` de `google-drive.ts`. `requestAccessToken` avec un jeton frais en cache ne déclenche aucune popup.

- [ ] **Step 3: Runner**

Dans `PushScheduleRunner.tsx`, dans l'effet principal, après `ensurePushSubscription` : `void renewMailWatch(settings.googleDrive.clientId.trim(), online?.config).catch((err: unknown) => console.warn("[push] watch Gmail", err));`, et le relancer aussi dans `onVisibility` quand la page redevient visible (le garde de 24 h évite les appels en trop). Ajouter `settings.googleDrive.clientId` aux dépendances.

- [ ] **Step 4: Vérifier**

Run: `pnpm typecheck` → PASS. En prod après les opérations manuelles : ouvrir `/mail`, puis dans DevTools → Network, voir `users/me/watch` en 200 puis `mail-watch` en 200. Envoyer un mail à soi-même, puis dans les logs Scalingo voir `[push] mail → N abonnement(s)`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/mail-push-watch.ts apps/web/src/lib/push/push-client.ts apps/web/src/lib/push/PushScheduleRunner.tsx
git commit -m "feat(push): renouvellement quotidien du watch Gmail"
```

---

### Task 6: SW — notification mail enrichie, actions, badge + `/mail?action=` (B, C)

Dépend de 3 (schéma `supernote-sw`) et 4 (`sw.js`, `app/mail/page.tsx`).

**Files:**
- Modify: `apps/web/public/sw.js` (listeners `push` et `notificationclick`)
- Modify: `apps/web/src/app/mail/page.tsx` (`?action=archive|read`)
- Test: `tests/e2e/08-notifications-pwa.spec.ts`

**Interfaces:**
- Consumes: IndexedDB `supernote-sw/kv` (`gmailToken`, `mailHistoryId`, `badgeCount`) ; payload `kind: "mail"` (Task 2).
- Produces: `notification.data = { url, threadId?, messageId?, kind: "mail" }` ; deep-link `/mail?thread=<id>&action=archive|read`.

- [ ] **Step 1: Helpers SW**

En tête de la section Web Push de `sw.js` :

```js
function kv(mode, fn) {
  return new Promise((resolve) => {
    const open = indexedDB.open("supernote-sw", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => resolve(undefined);
    open.onsuccess = () => {
      const db = open.result;
      const req = fn(db.transaction("kv", mode).objectStore("kv"));
      req.onsuccess = () => { resolve(req.result); db.close(); };
      req.onerror = () => { resolve(undefined); db.close(); };
    };
  });
}
const kvGet = (key) => kv("readonly", (s) => s.get(key));
const kvSet = (key, value) => kv("readwrite", (s) => s.put(value, key));

async function gmailToken() {
  const t = await kvGet("gmailToken");
  return t && typeof t.token === "string" && t.expiresAt > Date.now() + 60_000 ? t.token : "";
}

async function gmail(token, path, init = {}) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
  });
  if (!res.ok) throw new Error(`gmail ${res.status}`);
  return res.status === 204 ? null : res.json();
}

async function setBadge(n) {
  await kvSet("badgeCount", n);
  if ("setAppBadge" in self.navigator) await (n > 0 ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge()).catch(() => undefined);
}

const senderName = (from) => (from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1] ?? from).trim();
```

- [ ] **Step 2: Branche `kind === "mail"` dans `push`**

Dans le listener `push`, avant la construction de `payload` générique : si `data.kind === "mail"`, `event.waitUntil(showMail(data)); return;` avec :

```js
async function showMail(data) {
  const token = await gmailToken();
  if (!token) {
    await setBadge(((await kvGet("badgeCount")) || 0) + 1);
    return self.registration.showNotification("Du nouveau dans ta boîte", {
      tag: "mail-new", icon: "/icons/icon-192.png", data: { url: "/mail", kind: "mail" },
    });
  }
  try {
    const since = (await kvGet("mailHistoryId")) || text(data.historyId);
    const hist = await gmail(token, `history?startHistoryId=${encodeURIComponent(since)}&historyTypes=messageAdded&labelId=INBOX`);
    const added = (hist?.history ?? [])
      .flatMap((h) => h.messagesAdded ?? [])
      .map((m) => m.message)
      .filter((m) => m?.labelIds?.includes("INBOX"))
      .slice(0, 5);
    if (hist?.historyId) await kvSet("mailHistoryId", String(hist.historyId));
    const inbox = await gmail(token, "labels/INBOX");
    await setBadge(inbox?.threadsUnread ?? inbox?.messagesUnread ?? 0);
    if (added.length === 0) {
      // Archivage ou lecture : rien à dire, mais Safari exige une notification par push.
      await self.registration.showNotification("Supernote", { tag: "mail-sync", silent: true });
      const shown = await self.registration.getNotifications({ tag: "mail-sync" });
      shown.forEach((n) => n.close());
      return;
    }
    const metas = await Promise.all(
      added.map((m) => gmail(token, `messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`)),
    );
    const header = (m, name) => m.payload?.headers?.find((h) => h.name === name)?.value ?? "";
    const one = metas.length === 1 ? metas[0] : null;
    return self.registration.showNotification(
      one ? senderName(header(one, "From")) : `${metas.length} nouveaux mails`,
      {
        body: one ? header(one, "Subject") : metas.map((m) => senderName(header(m, "From"))).join(", "),
        tag: "mail-new",
        icon: "/icons/icon-192.png",
        data: { kind: "mail", url: one ? `/mail?thread=${encodeURIComponent(one.threadId)}` : "/mail", threadId: one?.threadId ?? "" },
        actions: one ? [{ action: "archive", title: "Archiver" }, { action: "read", title: "Lu" }] : [],
      },
    );
  } catch {
    return self.registration.showNotification("Du nouveau dans ta boîte", {
      tag: "mail-new", icon: "/icons/icon-192.png", data: { url: "/mail", kind: "mail" },
    });
  }
}
```

Relayer aussi `PUSH_RECEIVED` à la fenêtre visible, comme la branche existante.

- [ ] **Step 3: Actions dans `notificationclick`**

Avant la branche `join` :

```js
if ((event.action === "archive" || event.action === "read") && data.kind === "mail" && data.threadId) {
  const label = event.action === "archive" ? "INBOX" : "UNREAD";
  event.waitUntil(
    (async () => {
      const token = await gmailToken();
      if (token) {
        try {
          await gmail(token, `threads/${encodeURIComponent(data.threadId)}/modify`, {
            method: "POST",
            body: JSON.stringify({ removeLabelIds: [label] }),
          });
          const inbox = await gmail(token, "labels/INBOX");
          await setBadge(inbox?.threadsUnread ?? 0);
          return;
        } catch {
          /* repli : la page exécute via l'outbox */
        }
      }
      await self.clients.openWindow(`/mail?thread=${encodeURIComponent(data.threadId)}&action=${event.action}`);
    })(),
  );
  return;
}
```

- [ ] **Step 4: `/mail?action=` dans la page**

Étendre le deep-link `thread` existant (`app/mail/page.tsx:~685`) : lire `action`. Si `archive` ou `read`, **ne pas ouvrir le fil**. Appeler à la place le même chemin que l'archivage / le marquage lu de la liste (chercher le handler d'archivage qui appelle `mirrorApplyMutation` avec `removeLabelIds: [INBOX_LABEL]`, et celui du « lu » avec `UNREAD`). Retirer `thread` et `action` de l'URL. Réutiliser ces handlers tels quels : aucun nouvel appel Gmail direct.

- [ ] **Step 5: e2e**

Ajouter à `08-notifications-pwa.spec.ts` :

```ts
test("C : /mail?thread=X&action=archive archive sans ouvrir le fil", async ({ page }) => {
  await bootCloud(page);
  const gmail = await mockGoogleApis(page);
  await page.goto("/mail");
  const threadId = /* premier fil du mock */ gmail.threads[0].id;
  await page.goto(`/mail?thread=${threadId}&action=archive`);
  await expect(page).toHaveURL(/\/mail$/);
  await expect.poll(() => gmail.modifyCalls.some((c) => c.threadId === threadId && c.removeLabelIds.includes("INBOX"))).toBe(true);
});
```

Adapter à ce que `mockGoogleApis` expose réellement (fils du mock, journal des `modify`). S'il n'enregistre pas les appels `modify`, ajouter ce journal au helper.

Test SW (Chromium complet, même mécanique que `07-push.spec.ts` : `ServiceWorker.deliverPushMessage`) : pousser `{ kind: "mail", historyId: "1", title: "Nouveau mail" }` sans jeton en IndexedDB, puis vérifier via `registration.getNotifications()` qu'une notification « Du nouveau dans ta boîte » existe.

- [ ] **Step 6: Vérifier**

Run: `pnpm typecheck` → PASS. Run: `pnpm test:e2e -- 07-push 08-notifications-pwa` → PASS (07 ne doit pas régresser).

- [ ] **Step 7: Commit**

```bash
git add apps/web/public/sw.js apps/web/src/app/mail/page.tsx tests/e2e/08-notifications-pwa.spec.ts
git commit -m "feat(push): notification mail enrichie, actions Archiver/Lu et badge depuis le SW"
```

---

## Après intégration

- `pnpm typecheck` + `pnpm test:e2e` complets sur la branche intégrée.
- Carte du codebase : `communication.md` (routes push mail, base `supernote-sw`) et `tech-landscape.md` (variables `GMAIL_*`). Lancer `update-codebase-map`.
- Opérations manuelles GCP + Scalingo (spec, section « Opérations manuelles »), puis test réel sur téléphone.
