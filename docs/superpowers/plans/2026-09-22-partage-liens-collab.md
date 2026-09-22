# Partage par lien et co-édition temps réel — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** partager une note (lecture ou écriture, en direct avec curseurs) ou un fil d'email (lecture, figé) par des liens `/s/<slug>` publics ou à mot de passe, à durée limitée au choix.

**Architecture :** le serveur Node existant (`apps/web/server.mjs`) gagne une API de partage v2 (ressources, liens, jetons signés) et un serveur Yjs Hocuspocus 4 sur `wss /collab`, persistés dans le même Postgres. Le propriétaire co-édite depuis `NoteEditor` via `@hocuspocus/provider` + `y-indexeddb` ; les invités passent par une entrée Vite séparée `share.html`, sans coffre ni worker.

**Tech Stack :** Node 22 (`node:http`), better-sqlite3 / pg, `@hocuspocus/server` + `@hocuspocus/extension-database` 4.7, `crossws`, `yjs`, `@hocuspocus/provider` 4.7, `y-indexeddb`, BlockNote 0.50 (`collaboration`, `@blocknote/core/yjs`), React 19, HeroUI v3 via `@supernote/ui`, Playwright.

**Spec :** `docs/superpowers/specs/2026-09-22-partage-liens-collab-design.md` (lire en entier avant toute tâche).

## Global Constraints

- **Zéro test unitaire** : ne crée aucun `*.test.ts`, ne réintroduis pas vitest. Vérification = `pnpm typecheck` + e2e Playwright (`pnpm test:e2e`) + commandes de fumée indiquées (scripts jetables dans le scratchpad, jamais commités).
- `pnpm typecheck` doit passer à la fin de chaque tâche.
- Paquets `@supernote/*` consommés par leur `dist/` : après toute modification de `packages/*`, lancer `pnpm build:packages`.
- UI : `@supernote/ui` (HeroUI v3). Pas de `<button>`/`<input>` nus. Bouton icône = icône Phosphor + `Tooltip` de `@supernote/ui` + `aria-label`.
- Mobile dans le même mouvement : toute surface marche sous 768 px (`useIsMobile`), hit-targets ≥ 32 px, pas de débordement horizontal.
- Pas de toast pour un succès : retour porté par le bouton (`useActionFeedback` + `FeedbackIcon`, `apps/web/src/lib/action-feedback.tsx`).
- Commentaires : quasi aucun, en français, une ligne, seulement le POURQUOI non déductible. Aucun commentaire de narration.
- TypeScript strict, pas de `any`.
- Aucun formateur global (pas de `npx prettier` : la config trouvée n'est pas celle du dépôt et reformate tout).
- Arbre partagé : une autre session a des modifications non commitées (au moins `apps/web/src/components/todos/TodoMatrix.tsx`, `apps/web/src/lib/gmail.ts`, `apps/web/src/lib/mail-mirror.ts`). Une erreur de typecheck dans un fichier que la tâche ne touche pas n'est pas la tienne : la signaler, ne pas la corriger, ne pas stager ces fichiers.
- Commits conventionnels français (`feat(share): …`), terminés par les lignes d'attribution de la session. Ne stager **que** ses propres fichiers (l'arbre est partagé avec d'autres sessions : `git add <chemins>`, jamais `git add -A`).
- Valeurs fixées par la spec : slug 12 octets base64url, id de ressource 16 octets, clé propriétaire 32 octets ; jeton ≤ 12 h ; 10 échecs / 15 min ; WebSocket `maxPayload` 5 Mo ; image 10 Mo ; balayage d'expiration 60 s ; fragment Yjs `"document-store"`.

---

### Task 1 : extraire les mots de passe dans `password.mjs`

**Files :**
- Create : `apps/web/password.mjs`
- Modify : `apps/web/sync-backend.mjs:42-68` (imports, constantes, `hashPassword`, `verifyPassword`) et `:176-205` (`failures`, `clientIp`, `checkVaultPassword`)

**Interfaces :**
- Produces : `hashPassword(password: string): Promise<string>`, `verifyPassword(password: string, record: string): Promise<boolean>`, `clientIp(req): string`, `createPasswordChecker(): (scope: string, req, provided: string, record: string) => Promise<"ok" | "wrong" | "locked">`

- [ ] **Step 1 : créer `apps/web/password.mjs`**

```js
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;
const scryptAsync = promisify(scrypt);

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifyPassword(password, record) {
  const [saltHex, hashHex] = record.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

// Dernier saut de X-Forwarded-For : ajouté par le routeur, le client ne peut pas le falsifier.
export function clientIp(req) {
  const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hops.at(-1) || req.socket?.remoteAddress || "";
}

// ponytail: compteur en mémoire, par conteneur et remis à zéro au redémarrage ;
// passer par un store si l'app tourne un jour sur plusieurs conteneurs.
export function createPasswordChecker() {
  const failures = new Map();
  // "ok" | "wrong" | "locked" : après MAX_FAILED_ATTEMPTS échecs d'une même adresse sur
  // une même portée, plus aucune vérification jusqu'à LOCKOUT_MS après le premier échec.
  return async function check(scope, req, provided, record) {
    const key = `${scope}\0${clientIp(req)}`;
    const now = Date.now();
    const entry = failures.get(key);
    if (entry && now - entry.since > LOCKOUT_MS) failures.delete(key);
    else if (entry && entry.count >= MAX_FAILED_ATTEMPTS) return "locked";
    if (await verifyPassword(provided, record)) {
      failures.delete(key);
      return "ok";
    }
    const current = failures.get(key);
    if (current) current.count += 1;
    else failures.set(key, { count: 1, since: now });
    if (failures.size > 10_000) {
      for (const [k, v] of failures) if (now - v.since > LOCKOUT_MS) failures.delete(k);
    }
    return "wrong";
  };
}
```

- [ ] **Step 2 : brancher `sync-backend.mjs`**
  - Ajouter `import { hashPassword, verifyPassword, createPasswordChecker } from "./password.mjs";` après l'import de `sync-store.mjs`.
  - Supprimer `MAX_FAILED_ATTEMPTS`, `LOCKOUT_MS`, `scryptAsync`, `hashPassword`, `verifyPassword` (l.51-68), le `const failures = new Map();` et son commentaire `ponytail:` (l.176-178), et `clientIp` (l.180-184).
  - Remplacer le corps de `checkVaultPassword` (l.188-205) par :

```js
  const checkPassword = createPasswordChecker();

  async function checkVaultPassword(req, vault, provided, record) {
    return checkPassword(vault, req, provided, record);
  }
```
  - Nettoyer l'import `node:crypto` : garder seulement ce qui reste utilisé (`createHash` pour `sha256`, vérifier avec `grep -n "randomBytes\|scrypt\|timingSafeEqual" apps/web/sync-backend.mjs`). Supprimer `import { promisify }` s'il n'est plus utilisé.

- [ ] **Step 3 : vérifier**

Run : `cd apps/web && node --check password.mjs && node --check sync-backend.mjs && grep -n "clientIp\|verifyPassword\|MAX_FAILED" sync-backend.mjs`
Expected : aucune erreur de syntaxe ; `verifyPassword` n'apparaît plus que dans l'import s'il est encore utilisé ailleurs dans le fichier, sinon retiré de l'import.

Fumée (scratchpad, non commité) :
```bash
cd apps/web && rm -f /tmp/sn-t1.db && DATABASE_URL=file:/tmp/sn-t1.db PORT=3391 node server.mjs & sleep 2
curl -s -X POST localhost:3391/api/sync/join -H 'content-type: application/json' -d '{"vault":"t1","password":"motdepasse1"}'
for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:3391/api/sync/join -H 'content-type: application/json' -d '{"vault":"t1","password":"faux-faux-faux"}'; done; echo
kill %1
```
Expected : premier appel OK (salon revendiqué) ; les appels faux renvoient `401`/`403` puis `429` au 11ᵉ. (Si la route `/join` attend d'autres champs, lire `sync-backend.mjs` autour de `"/api/sync/join"` et adapter le corps.)

- [ ] **Step 4 : commit**

```bash
git add apps/web/password.mjs apps/web/sync-backend.mjs
git commit -m "refactor(sync): extrait scrypt et l'anti-force brute dans password.mjs"
```

---

### Task 2 : store de partage v2

**Files :**
- Rewrite : `apps/web/share-store.mjs`

**Interfaces :**
- Consumes : rien.
- Produces : `createShareStore(): Promise<ShareStore>` avec
  - `kind: "sqlite" | "postgres"`, `label: string`
  - `createResource({ id, kind, ownerKeyHash, title, snapshot }): Promise<void>`
  - `getResource(id): Promise<Resource | null>` — `Resource = { id, kind: "note" | "email", ownerKeyHash, title, snapshot: object | null, createdAt, updatedAt }`
  - `renameResource(id, title): Promise<boolean>`, `deleteResource(id): Promise<boolean>` (supprime aussi liens, doc, blobs)
  - `createLink({ slug, resourceId, mode, passwordHash, expiresAt, label }): Promise<void>`
  - `getLink(slug): Promise<Link | null>` — `Link = { slug, resourceId, mode: "read" | "write", passwordHash: string | null, expiresAt: number | null, label: string | null, createdAt, revokedAt: number | null }`
  - `listLinks(resourceId): Promise<Link[]>`, `updateLink(slug, patch: { passwordHash?, expiresAt?, label? }): Promise<boolean>`, `revokeLink(slug): Promise<boolean>`
  - `getDoc(resourceId): Promise<Uint8Array | null>`, `putDoc(resourceId, state: Uint8Array): Promise<void>`, `seedDoc(resourceId, state): Promise<boolean>` (false si déjà amorcé)
  - `putBlob(resourceId, path, bytes: Buffer): Promise<void>`, `getBlob(resourceId, path): Promise<Buffer | null>`
  - `ensureMeta(key, makeValue: () => string): Promise<string>`
  - `legacyBySlug(slug): Promise<{ title, html, updatedAt } | null>`

- [ ] **Step 1 : réécrire `apps/web/share-store.mjs`**

```js
/**
 * share-store — stockage du partage par lien (ressources, liens, états Yjs,
 * images publiées). Double moteur comme `sync-store.mjs` : SQLite pour les URL
 * `file:`, Postgres pour `postgres://` (durable sur Scalingo, dont le disque
 * est effacé à chaque déploiement).
 */

import { fileURLToPath } from "node:url";

function resolveSqlitePath() {
  if (process.env.SHARE_DB_PATH) return process.env.SHARE_DB_PATH;
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("file:")) {
    try {
      return url.includes("://") ? fileURLToPath(url) : url.slice("file:".length);
    } catch {
      return url.slice("file:".length);
    }
  }
  if (url && !url.includes("://")) return url;
  return "sync-data.db";
}

async function openSqlite() {
  const { default: Database } = await import("better-sqlite3");
  const path = resolveSqlitePath();
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  return {
    kind: "sqlite",
    label: path,
    bin: "BLOB",
    exec: async (sql) => void db.exec(sql),
    get: async (sql, params = []) => db.prepare(sql).get(...params) ?? null,
    all: async (sql, params = []) => db.prepare(sql).all(...params),
    run: async (sql, params = []) => db.prepare(sql).run(...params).changes,
  };
}

async function openPg(url) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  // Les requêtes sont écrites une fois avec `?` ; Postgres attend `$1…$n`.
  const query = (sql, params) => {
    let i = 0;
    return pool.query(sql.replace(/\?/g, () => `$${++i}`), params);
  };
  return {
    kind: "postgres",
    label: url.replace(/:\/\/[^@/]*@/, "://***@"),
    bin: "BYTEA",
    exec: async (sql) => void (await pool.query(sql)),
    get: async (sql, params = []) => (await query(sql, params)).rows[0] ?? null,
    all: async (sql, params = []) => (await query(sql, params)).rows,
    run: async (sql, params = []) => (await query(sql, params)).rowCount ?? 0,
  };
}

// Postgres replie les identifiants non quotés en minuscules : snake_case partout.
const schema = (bin) => `
  CREATE TABLE IF NOT EXISTS share_resource (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    owner_key_hash TEXT NOT NULL,
    title TEXT NOT NULL,
    snapshot TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS share_link (
    slug TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    password_hash TEXT,
    expires_at BIGINT,
    label TEXT,
    created_at BIGINT NOT NULL,
    revoked_at BIGINT
  );
  CREATE INDEX IF NOT EXISTS share_link_resource ON share_link (resource_id);
  CREATE TABLE IF NOT EXISTS collab_doc (
    resource_id TEXT PRIMARY KEY,
    state ${bin} NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS share_blob (
    resource_id TEXT NOT NULL,
    path TEXT NOT NULL,
    bytes ${bin} NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (resource_id, path)
  );
  CREATE TABLE IF NOT EXISTS share_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

// Table des instantanés HTML de la v1 : lue seulement, pour que les anciens liens vivent.
const LEGACY_SQLITE = `
  CREATE TABLE IF NOT EXISTS share (
    entityId TEXT PRIMARY KEY, slug TEXT NOT NULL, title TEXT NOT NULL, html TEXT NOT NULL,
    updatedAt INTEGER NOT NULL, createdAt INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS share_slug ON share (slug);
`;
const LEGACY_PG = `
  CREATE TABLE IF NOT EXISTS share (
    entityid TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, html TEXT NOT NULL,
    updatedat BIGINT NOT NULL, createdat BIGINT NOT NULL
  );
`;

const num = (v) => (v == null ? null : Number(v));

function toResource(r) {
  if (!r) return null;
  return {
    id: r.id,
    kind: r.kind,
    ownerKeyHash: r.owner_key_hash,
    title: r.title,
    snapshot: r.snapshot ? JSON.parse(r.snapshot) : null,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function toLink(r) {
  if (!r) return null;
  return {
    slug: r.slug,
    resourceId: r.resource_id,
    mode: r.mode,
    passwordHash: r.password_hash ?? null,
    expiresAt: num(r.expires_at),
    label: r.label ?? null,
    createdAt: num(r.created_at),
    revokedAt: num(r.revoked_at),
  };
}

const LINK_COLUMNS = [
  ["passwordHash", "password_hash"],
  ["expiresAt", "expires_at"],
  ["label", "label"],
];

export async function createShareStore() {
  const url = process.env.DATABASE_URL ?? "";
  const sql = /^postgres(ql)?:\/\//.test(url) ? await openPg(url) : await openSqlite();
  await sql.exec(schema(sql.bin));
  await sql.exec(sql.kind === "postgres" ? LEGACY_PG : LEGACY_SQLITE);

  return {
    kind: sql.kind,
    label: sql.label,

    async createResource({ id, kind, ownerKeyHash, title, snapshot }) {
      const now = Date.now();
      await sql.run(
        `INSERT INTO share_resource (id, kind, owner_key_hash, title, snapshot, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, kind, ownerKeyHash, title, snapshot == null ? null : JSON.stringify(snapshot), now, now],
      );
    },
    getResource: async (id) => toResource(await sql.get(`SELECT * FROM share_resource WHERE id = ?`, [id])),
    renameResource: async (id, title) =>
      (await sql.run(`UPDATE share_resource SET title = ?, updated_at = ? WHERE id = ?`, [title, Date.now(), id])) > 0,
    async deleteResource(id) {
      for (const table of ["share_link", "collab_doc", "share_blob"]) {
        await sql.run(`DELETE FROM ${table} WHERE resource_id = ?`, [id]);
      }
      return (await sql.run(`DELETE FROM share_resource WHERE id = ?`, [id])) > 0;
    },

    async createLink({ slug, resourceId, mode, passwordHash, expiresAt, label }) {
      await sql.run(
        `INSERT INTO share_link (slug, resource_id, mode, password_hash, expires_at, label, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        [slug, resourceId, mode, passwordHash ?? null, expiresAt ?? null, label ?? null, Date.now()],
      );
    },
    getLink: async (slug) => toLink(await sql.get(`SELECT * FROM share_link WHERE slug = ?`, [slug])),
    listLinks: async (resourceId) =>
      (await sql.all(`SELECT * FROM share_link WHERE resource_id = ? ORDER BY created_at`, [resourceId])).map(toLink),
    async updateLink(slug, patch) {
      const sets = [];
      const params = [];
      for (const [key, column] of LINK_COLUMNS) {
        if (key in patch) {
          sets.push(`${column} = ?`);
          params.push(patch[key] ?? null);
        }
      }
      if (sets.length === 0) return false;
      return (await sql.run(`UPDATE share_link SET ${sets.join(", ")} WHERE slug = ?`, [...params, slug])) > 0;
    },
    revokeLink: async (slug) =>
      (await sql.run(`UPDATE share_link SET revoked_at = ? WHERE slug = ? AND revoked_at IS NULL`, [Date.now(), slug])) > 0,

    async getDoc(resourceId) {
      const r = await sql.get(`SELECT state FROM collab_doc WHERE resource_id = ?`, [resourceId]);
      return r ? new Uint8Array(r.state) : null;
    },
    async putDoc(resourceId, state) {
      await sql.run(
        `INSERT INTO collab_doc (resource_id, state, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (resource_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
        [resourceId, Buffer.from(state), Date.now()],
      );
    },
    seedDoc: async (resourceId, state) =>
      (await sql.run(
        `INSERT INTO collab_doc (resource_id, state, updated_at) VALUES (?, ?, ?) ON CONFLICT (resource_id) DO NOTHING`,
        [resourceId, Buffer.from(state), Date.now()],
      )) > 0,

    async putBlob(resourceId, path, bytes) {
      await sql.run(
        `INSERT INTO share_blob (resource_id, path, bytes, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (resource_id, path) DO UPDATE SET bytes = excluded.bytes`,
        [resourceId, path, bytes, Date.now()],
      );
    },
    async getBlob(resourceId, path) {
      const r = await sql.get(`SELECT bytes FROM share_blob WHERE resource_id = ? AND path = ?`, [resourceId, path]);
      return r ? Buffer.from(r.bytes) : null;
    },

    async ensureMeta(key, makeValue) {
      await sql.run(`INSERT INTO share_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`, [key, makeValue()]);
      return (await sql.get(`SELECT value FROM share_meta WHERE key = ?`, [key])).value;
    },

    async legacyBySlug(slug) {
      const r = await sql.get(`SELECT * FROM share WHERE slug = ?`, [slug]);
      if (!r) return null;
      return { title: r.title, html: r.html, updatedAt: Number(r.updatedAt ?? r.updatedat) };
    },
  };
}
```

- [ ] **Step 2 : fumée du store (scratchpad, non commité)**

Créer `<scratchpad>/t2.mjs` :
```js
process.env.DATABASE_URL = "file:/tmp/sn-t2.db";
const { createShareStore } = await import("/home/ange/supernote/apps/web/share-store.mjs");
const s = await createShareStore();
await s.createResource({ id: "r1", kind: "note", ownerKeyHash: "h", title: "T", snapshot: null });
await s.createLink({ slug: "l1", resourceId: "r1", mode: "write", passwordHash: null, expiresAt: null, label: "Paul" });
console.log(await s.getLink("l1"), (await s.listLinks("r1")).length);
console.log(await s.seedDoc("r1", new Uint8Array([1, 2])), await s.seedDoc("r1", new Uint8Array([3])), await s.getDoc("r1"));
await s.updateLink("l1", { expiresAt: 5, label: null });
console.log(await s.getLink("l1"), await s.revokeLink("l1"), await s.revokeLink("l1"));
console.log(await s.ensureMeta("k", () => "a"), await s.ensureMeta("k", () => "b"));
console.log(await s.deleteResource("r1"), await s.getLink("l1"), await s.legacyBySlug("nope"));
```
Run : `rm -f /tmp/sn-t2.db* && cd apps/web && node <scratchpad>/t2.mjs`
Expected : lien `mode: "write"`, `1` ; `true false Uint8Array [1, 2]` ; lien avec `expiresAt: 5, label: null`, `true false` ; `a a` ; `true null null`.

- [ ] **Step 3 : commit**

```bash
git add apps/web/share-store.mjs
git commit -m "feat(share): store v2 (ressources, liens, états Yjs, images) sur SQLite et Postgres"
```

---

### Task 3 : API de partage v2, routage `/s/*`

**Files :**
- Rewrite : `apps/web/share-backend.mjs`
- Modify : `apps/web/server.mjs:146-170` (routage `/s/*` vers `share.html`)
- Modify : `apps/web/vite.config.ts:75-101` (`shareDevServer` : réécriture `/s/*` → `/share.html`)
- Modify : `apps/web/public/sw.js:99` (exclure `/s/`)

**Interfaces :**
- Consumes : Task 1 (`hashPassword`, `createPasswordChecker`), Task 2 (store).
- Produces :
  - `createShareBackend(): Promise<{ enabled: boolean; handle(req, res): Promise<boolean>; handleUpgrade?(req, socket, head): void }>` (`handleUpgrade` arrive en Task 4)
  - Routes HTTP exactes de la spec (section « API serveur »), avec deux précisions : `meta` ne renvoie **pas** `resourceId` ; `unlock` renvoie `{ accessToken, resourceId, kind, mode }`.
  - Jeton : `"<slug>.<exp>.<pv>.<sig>"`, `pv` = 8 premiers caractères base64url de SHA-256(`passwordHash ?? ""`) (changer le mot de passe invalide les jetons émis), `sig` = HMAC-SHA256 base64url du préfixe.
  - `GET /s/<slug>` : instantané v1 si le slug est dans la table `share` historique, sinon `handle` renvoie `false` et l'appelant sert `share.html`.

- [ ] **Step 1 : réécrire `apps/web/share-backend.mjs`**

```js
/**
 * share-backend — partage par lien v2 (spec 2026-09-22-partage-liens-collab).
 *
 * Monté par `server.mjs` et le middleware de dev seulement si `DATABASE_URL`
 * est défini. Propriétaire : en-tête `x-share-owner` (clé de 32 octets dont
 * seul le SHA-256 est stocké). Invité : jeton HMAC obtenu par `unlock`, en
 * `Authorization: Bearer`, revérifié à chaque appel contre l'état du lien.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createShareStore } from "./share-store.mjs";
import { createPasswordChecker, hashPassword } from "./password.mjs";

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_BLOB_BYTES = 10 * 1024 * 1024;
const MAX_DOC_BYTES = 5 * 1024 * 1024;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 6;
const SWEEP_MS = 60_000;

const IMAGE_TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", avif: "image/avif", svg: "image/svg+xml",
};

const newId = (bytes) => randomBytes(bytes).toString("base64url");
const sha256hex = (s) => createHash("sha256").update(s).digest("hex");

function sameString(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function linkState(link) {
  if (!link) return "missing";
  if (link.revokedAt) return "revoked";
  if (link.expiresAt != null && link.expiresAt <= Date.now()) return "expired";
  return "ok";
}

function publicLink(link) {
  return {
    slug: link.slug,
    mode: link.mode,
    hasPassword: !!link.passwordHash,
    expiresAt: link.expiresAt,
    label: link.label,
    createdAt: link.createdAt,
    revokedAt: link.revokedAt,
  };
}

function cleanSnapshot(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.messages) || raw.messages.length > 200) return null;
  const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    subject: str(raw.subject, 500),
    messages: raw.messages.map((m) => ({
      from: str(m?.from, 500),
      to: str(m?.to, 2000),
      date: str(m?.date, 40),
      bodyText: str(m?.bodyText, 200_000),
    })),
  };
}

// `null` = retirer ; `undefined` = ne pas toucher ; sinon un instant futur.
function parseExpiry(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return typeof v === "number" && Number.isFinite(v) && v > Date.now() ? v : NaN;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function legacyPage({ title, html, updatedAt }) {
  const safeTitle = escapeHtml(title || "Note partagée");
  const date = new Date(updatedAt).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${safeTitle}</title>
<style>
  :root { color-scheme: light dark; --fg: #1a1a1a; --muted: #6b6b6b; --bg: #fff; --border: #e5e5e5; --code-bg: #f4f4f5; }
  @media (prefers-color-scheme: dark) { :root { --fg: #e8e8e8; --muted: #9a9a9a; --bg: #16161a; --border: #2a2a30; --code-bg: #1e1e24; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.65 -apple-system, "Inter", ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 720px; margin: 0 auto; padding: 56px 24px 80px; }
  h1.sn-share-title { font-size: 28px; font-weight: 700; margin: 0 0 4px; }
  .sn-share-meta { color: var(--muted); font-size: 13px; margin: 0 0 40px; }
  img { max-width: 100%; border-radius: 6px; }
  pre { background: var(--code-bg); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.92em; }
  th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
</style>
</head>
<body>
<main>
  <h1 class="sn-share-title">${safeTitle}</h1>
  <p class="sn-share-meta">Mis à jour le ${escapeHtml(date)}</p>
  <article>${html}</article>
</main>
</body>
</html>`;
}

export async function createShareBackend() {
  if (!process.env.DATABASE_URL) return { enabled: false, handle: async () => false };

  const store = await createShareStore();
  const checkPassword = createPasswordChecker();
  const secret = process.env.SHARE_SECRET || (await store.ensureMeta("signing-secret", () => newId(32)));
  const hmac = (payload) => createHmac("sha256", secret).update(payload).digest("base64url");
  const passwordVersion = (link) => createHash("sha256").update(link.passwordHash ?? "").digest("base64url").slice(0, 8);

  console.log(`[share] partage par lien ACTIF (${store.kind} : ${store.label})`);

  function signToken(link) {
    const exp = Math.min(link.expiresAt ?? Number.MAX_SAFE_INTEGER, Date.now() + TOKEN_TTL_MS);
    const payload = `${link.slug}.${exp}.${passwordVersion(link)}`;
    return `${payload}.${hmac(payload)}`;
  }

  async function linkFromToken(token) {
    const parts = String(token ?? "").split(".");
    if (parts.length !== 4) return null;
    const [slug, exp, pv, sig] = parts;
    if (!sameString(sig, hmac(`${slug}.${exp}.${pv}`)) || Number(exp) <= Date.now()) return null;
    const link = await store.getLink(slug);
    if (linkState(link) !== "ok" || passwordVersion(link) !== pv) return null;
    return link;
  }

  const ownerMatches = (key, resource) => !!key && !!resource && sameString(sha256hex(key), resource.ownerKeyHash);

  // Branché en Task 4 (collab-server.mjs) ; sans lui, rien à couper.
  let collab = { closeLink() {}, closeResource() {}, sweep: async () => {} };

  function send(res, status, body, headers = {}) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    });
    res.end(JSON.stringify(body));
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > limit) {
          reject(Object.assign(new Error("payload too large"), { status: 413 }));
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
    const buf = await readBody(req, MAX_JSON_BYTES);
    try {
      return buf.length ? JSON.parse(buf.toString("utf8")) : {};
    } catch {
      throw Object.assign(new Error("invalid json"), { status: 400 });
    }
  }

  async function ownedResource(req, id) {
    const resource = await store.getResource(id);
    if (!resource) throw Object.assign(new Error("not found"), { status: 404 });
    if (!ownerMatches(req.headers["x-share-owner"], resource)) throw Object.assign(new Error("forbidden"), { status: 403 });
    return resource;
  }

  async function ownedLink(req, slug) {
    const link = await store.getLink(slug);
    if (!link) throw Object.assign(new Error("not found"), { status: 404 });
    const resource = await ownedResource(req, link.resourceId);
    return { link, resource };
  }

  async function accessLink(req, slug) {
    const bearer = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    const link = await linkFromToken(bearer);
    if (!link || link.slug !== slug) throw Object.assign(new Error("unauthorized"), { status: 401 });
    return link;
  }

  async function passwordHashFrom(value) {
    if (value == null || value === "") return null;
    if (typeof value !== "string" || value.length < MIN_PASSWORD_LENGTH || value.length > 200) {
      throw Object.assign(new Error(`password must be ${MIN_PASSWORD_LENGTH}-200 chars`), { status: 400 });
    }
    return hashPassword(value);
  }

  async function authenticateCollab(resourceId, token) {
    const resource = await store.getResource(resourceId);
    if (!resource || resource.kind !== "note") throw new Error("unknown document");
    if (String(token).startsWith("owner:")) {
      if (ownerMatches(String(token).slice(6), resource)) return { slug: null, readOnly: false };
      throw new Error("forbidden");
    }
    const link = await linkFromToken(token);
    if (!link || link.resourceId !== resourceId) throw new Error("forbidden");
    return { slug: link.slug, readOnly: link.mode !== "write" };
  }

  const routes = [
    ["GET", /^\/api\/share\/_info$/, async (_req, res) => send(res, 200, { enabled: true })],

    ["POST", /^\/api\/share\/resources$/, async (req, res) => {
      const body = await readJson(req);
      const kind = body.kind === "email" ? "email" : body.kind === "note" ? "note" : null;
      if (!kind) return send(res, 400, { error: "kind must be note or email" });
      const snapshot = kind === "email" ? cleanSnapshot(body.snapshot) : null;
      if (kind === "email" && !snapshot) return send(res, 400, { error: "invalid snapshot" });
      const id = newId(16);
      const ownerKey = newId(32);
      const title = typeof body.title === "string" ? body.title.slice(0, 300) : "";
      await store.createResource({ id, kind, ownerKeyHash: sha256hex(ownerKey), title, snapshot });
      send(res, 201, { id, ownerKey });
    }],

    ["PATCH", /^\/api\/share\/resources\/([\w-]+)$/, async (req, res, [id]) => {
      await ownedResource(req, id);
      const body = await readJson(req);
      if (typeof body.title !== "string") return send(res, 400, { error: "missing title" });
      await store.renameResource(id, body.title.slice(0, 300));
      send(res, 200, { ok: true });
    }],

    ["DELETE", /^\/api\/share\/resources\/([\w-]+)$/, async (req, res, [id]) => {
      await ownedResource(req, id);
      await store.deleteResource(id);
      collab.closeResource(id);
      send(res, 200, { ok: true });
    }],

    ["PUT", /^\/api\/share\/resources\/([\w-]+)\/doc$/, async (req, res, [id]) => {
      const resource = await ownedResource(req, id);
      if (resource.kind !== "note") return send(res, 400, { error: "not a note" });
      const bytes = await readBody(req, MAX_DOC_BYTES);
      const seeded = await store.seedDoc(id, bytes);
      send(res, seeded ? 201 : 409, seeded ? { ok: true } : { error: "already seeded" });
    }],

    ["GET", /^\/api\/share\/resources\/([\w-]+)\/links$/, async (req, res, [id]) => {
      await ownedResource(req, id);
      send(res, 200, { links: (await store.listLinks(id)).map(publicLink) });
    }],

    ["POST", /^\/api\/share\/resources\/([\w-]+)\/links$/, async (req, res, [id]) => {
      const resource = await ownedResource(req, id);
      const body = await readJson(req);
      const mode = body.mode === "write" ? "write" : "read";
      if (mode === "write" && resource.kind !== "note") return send(res, 400, { error: "write links are notes-only" });
      const expiresAt = parseExpiry(body.expiresAt ?? null);
      if (Number.isNaN(expiresAt)) return send(res, 400, { error: "expiresAt must be in the future" });
      const link = {
        slug: newId(12),
        resourceId: id,
        mode,
        passwordHash: await passwordHashFrom(body.password),
        expiresAt,
        label: typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : null,
      };
      await store.createLink(link);
      send(res, 201, { link: publicLink(await store.getLink(link.slug)) });
    }],

    ["PUT", /^\/api\/share\/resources\/([\w-]+)\/blob$/, async (req, res, [id], url) => {
      const resource = await ownedResource(req, id);
      const path = url.searchParams.get("path") ?? "";
      if (resource.kind !== "note" || !path || path.length > 500) return send(res, 400, { error: "invalid path" });
      await store.putBlob(id, path, await readBody(req, MAX_BLOB_BYTES));
      send(res, 200, { ok: true });
    }],

    ["PATCH", /^\/api\/share\/links\/([\w-]+)$/, async (req, res, [slug]) => {
      const { link } = await ownedLink(req, slug);
      const body = await readJson(req);
      const patch = {};
      if ("password" in body) patch.passwordHash = await passwordHashFrom(body.password);
      if ("expiresAt" in body) {
        const expiresAt = parseExpiry(body.expiresAt);
        if (Number.isNaN(expiresAt)) return send(res, 400, { error: "expiresAt must be in the future" });
        patch.expiresAt = expiresAt;
      }
      if ("label" in body) patch.label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : null;
      await store.updateLink(slug, patch);
      if ("passwordHash" in patch || "expiresAt" in patch) collab.closeLink(link.resourceId, slug);
      send(res, 200, { link: publicLink(await store.getLink(slug)) });
    }],

    ["DELETE", /^\/api\/share\/links\/([\w-]+)$/, async (req, res, [slug]) => {
      const { link } = await ownedLink(req, slug);
      await store.revokeLink(slug);
      collab.closeLink(link.resourceId, slug);
      send(res, 200, { ok: true });
    }],

    ["GET", /^\/api\/share\/links\/([\w-]+)\/meta$/, async (_req, res, [slug]) => {
      const link = await store.getLink(slug);
      const state = linkState(link);
      if (state === "missing") return send(res, 404, { reason: "missing" });
      if (state !== "ok") return send(res, 410, { reason: state });
      const resource = await store.getResource(link.resourceId);
      if (!resource) return send(res, 404, { reason: "missing" });
      send(res, 200, { kind: resource.kind, mode: link.mode, title: resource.title, needsPassword: !!link.passwordHash });
    }],

    ["POST", /^\/api\/share\/links\/([\w-]+)\/unlock$/, async (req, res, [slug]) => {
      const link = await store.getLink(slug);
      const state = linkState(link);
      if (state === "missing") return send(res, 404, { reason: "missing" });
      if (state !== "ok") return send(res, 410, { reason: state });
      if (link.passwordHash) {
        const body = await readJson(req);
        const provided = typeof body.password === "string" ? body.password : "";
        const verdict = provided ? await checkPassword(`share:${slug}`, req, provided, link.passwordHash) : "wrong";
        if (verdict === "locked") return send(res, 429, { reason: "locked" });
        if (verdict !== "ok") return send(res, 401, { reason: "wrong" });
      }
      const resource = await store.getResource(link.resourceId);
      if (!resource) return send(res, 404, { reason: "missing" });
      send(res, 200, { accessToken: signToken(link), resourceId: resource.id, kind: resource.kind, mode: link.mode });
    }],

    ["GET", /^\/api\/share\/links\/([\w-]+)\/content$/, async (req, res, [slug]) => {
      const link = await accessLink(req, slug);
      const resource = await store.getResource(link.resourceId);
      if (!resource || resource.kind !== "email") return send(res, 404, { reason: "missing" });
      send(res, 200, { title: resource.title, snapshot: resource.snapshot });
    }],

    ["GET", /^\/api\/share\/links\/([\w-]+)\/blob$/, async (req, res, [slug], url) => {
      const link = await accessLink(req, slug);
      const path = url.searchParams.get("path") ?? "";
      const bytes = path ? await store.getBlob(link.resourceId, path) : null;
      if (!bytes) return send(res, 404, { reason: "missing" });
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      res.writeHead(200, {
        "Content-Type": IMAGE_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        // Un SVG ouvert directement ne doit rien exécuter sur l'origine de l'app.
        "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      });
      res.end(bytes);
    }],
  ];

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    if (req.method === "GET" && path.startsWith("/s/")) {
      const legacy = await store.legacyBySlug(path.slice(3));
      if (!legacy) return false;
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; frame-ancestors 'none'",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      });
      res.end(legacyPage(legacy));
      return true;
    }

    if (!path.startsWith("/api/share/")) return false;
    for (const [method, re, fn] of routes) {
      const match = req.method === method ? path.match(re) : null;
      if (!match) continue;
      try {
        await fn(req, res, match.slice(1), url);
      } catch (err) {
        const status = err?.status ?? 500;
        if (status === 500) console.error("[share]", err);
        if (!res.headersSent) send(res, status, { error: status === 500 ? "internal error" : err.message });
      }
      return true;
    }
    send(res, 404, { error: "not found" });
    return true;
  }

  return {
    enabled: true,
    handle,
    // Task 4 remplace ces deux membres.
    attachCollab: (c) => {
      collab = c;
      setInterval(() => void collab.sweep(async (slug) => linkState(await store.getLink(slug)) === "ok"), SWEEP_MS).unref();
    },
    authenticateCollab,
    store,
  };
}
```

- [ ] **Step 2 : `server.mjs` sert `share.html` pour `/s/*`**

Dans `server.mjs`, juste après le bloc share (l.146-153) et avant `const url = new URL(...)`, remplacer :
```js
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    let pathname = decodeURIComponent(url.pathname);
```
par :
```js
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    // Lien de partage v2 : l'entrée invitée, sans coffre ni worker.
    let pathname = url.pathname.startsWith("/s/") ? "/share.html" : decodeURIComponent(url.pathname);
```

- [ ] **Step 3 : `vite.config.ts` réécrit `/s/*` en dev**

Dans `shareDevServer()` (l.84-92), remplacer le `.then((handled) => { if (!handled) next(); })` du middleware par :
```ts
          .then((handled) => {
            if (handled) return;
            const r = req as { url?: string };
            if (r.url?.startsWith("/s/")) r.url = "/share.html";
            next();
          })
```
(le filtre d'entrée `/api/share/` + `/s/` reste identique).

- [ ] **Step 4 : `sw.js` n'intercepte pas `/s/`**

`apps/web/public/sw.js:99` devient :
```js
  if (url.pathname.startsWith("/api/") || url.pathname === "/admin" || url.pathname.startsWith("/s/")) return;
```

- [ ] **Step 5 : fumée de l'API (scratchpad)**

```bash
cd apps/web && rm -f /tmp/sn-t3.db* && DATABASE_URL=file:/tmp/sn-t3.db PORT=3392 node server.mjs & sleep 2
B=localhost:3392/api/share
R=$(curl -s -X POST $B/resources -H 'content-type: application/json' -d '{"kind":"email","title":"Fil","snapshot":{"subject":"S","messages":[{"from":"a","to":"b","date":"2026-09-22","bodyText":"<b>x</b>"}]}}'); echo $R
ID=$(echo $R | node -pe 'JSON.parse(require("fs").readFileSync(0)).id'); KEY=$(echo $R | node -pe 'JSON.parse(require("fs").readFileSync(0)).ownerKey')
curl -s -X POST $B/resources/$ID/links -H "x-share-owner: $KEY" -H 'content-type: application/json' -d '{"mode":"write"}'; echo
L=$(curl -s -X POST $B/resources/$ID/links -H "x-share-owner: $KEY" -H 'content-type: application/json' -d '{"mode":"read","password":"secret1"}'); echo $L
SLUG=$(echo $L | node -pe 'JSON.parse(require("fs").readFileSync(0)).link.slug')
curl -s $B/links/$SLUG/meta; echo
curl -s -X POST $B/links/$SLUG/unlock -H 'content-type: application/json' -d '{"password":"faux"}'; echo
T=$(curl -s -X POST $B/links/$SLUG/unlock -H 'content-type: application/json' -d '{"password":"secret1"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
curl -s $B/links/$SLUG/content -H "authorization: Bearer $T"; echo
curl -s -X PATCH $B/links/$SLUG -H "x-share-owner: $KEY" -H 'content-type: application/json' -d '{"password":"autre12"}' > /dev/null
curl -s -o /dev/null -w "%{http_code}\n" $B/links/$SLUG/content -H "authorization: Bearer $T"
curl -s -X DELETE $B/links/$SLUG -H "x-share-owner: nope" ; echo
curl -s -X DELETE $B/links/$SLUG -H "x-share-owner: $KEY"; echo; curl -s $B/links/$SLUG/meta; echo
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" localhost:3392/s/$SLUG
kill %1
```
Expected, dans l'ordre : `{id, ownerKey}` ; `400 write links are notes-only` ; lien lecture avec `hasPassword: true` ; `{"kind":"email","mode":"read","title":"Fil","needsPassword":true}` ; `{"reason":"wrong"}` ; `{title, snapshot}` avec `"<b>x</b>"` en texte ; `401` (mot de passe changé → jeton invalide) ; `{"error":"forbidden"}` ; `{"ok":true}` puis `{"reason":"revoked"}` ; `/s/<slug>` → `404 text/plain` si `dist/share.html` n'existe pas encore (normal avant Task 6 et un build), `200 text/html` après.

- [ ] **Step 6 : typecheck + commit**

Run : `pnpm typecheck` → 15/15.
```bash
git add apps/web/share-backend.mjs apps/web/server.mjs apps/web/vite.config.ts apps/web/public/sw.js
git commit -m "feat(share): API v2 (propriétaire, invité, jetons signés, mots de passe), /s/* vers share.html"
```

---

### Task 4 : serveur Yjs Hocuspocus sur `/collab`

**Files :**
- Create : `apps/web/collab-server.mjs`
- Modify : `apps/web/share-backend.mjs` (brancher collab, exposer `handleUpgrade`)
- Modify : `apps/web/server.mjs` (handler `upgrade`)
- Modify : `apps/web/vite.config.ts` (`shareDevServer` : `upgrade` en dev)
- Modify : `apps/web/package.json` (dépendances)

**Interfaces :**
- Consumes : Task 3 (`authenticateCollab(resourceId, token): Promise<{ slug: string | null; readOnly: boolean }>`, `store.getDoc/putDoc`, `attachCollab`).
- Produces : `createCollabServer({ store, authenticate }): { handleUpgrade(req, socket, head): void; closeLink(resourceId, slug): void; closeResource(resourceId): void; sweep(isValid: (slug) => Promise<boolean>): Promise<void> }` ; le backend expose `handleUpgrade`.

- [ ] **Step 1 : installer**

Run : `pnpm --filter @supernote/web add @hocuspocus/server@4.7.0 @hocuspocus/extension-database@4.7.0 @hocuspocus/provider@4.7.0 crossws y-indexeddb`
Puis : `cd apps/web && node -e "import('crossws/adapters/node').then(m => console.log(typeof m.default))"` → `function`. Si l'import échoue sur `srvx` manquant, ajouter `srvx` avec la version demandée par `npm view crossws peerDependencies`.
Vérifier `pnpm-workspace.yaml` `allowBuilds:` : si `pnpm install` signale un nouveau paquet à script de build non listé, l'ajouter à `false` (piège Scalingo).

- [ ] **Step 2 : lire les types installés**

Run : `grep -n "class Connection\|close(\|context\|readOnly" apps/web/node_modules/@hocuspocus/server/dist/*.d.ts | head -40` et `grep -n "connections" apps/web/node_modules/@hocuspocus/server/dist/*.d.ts | head`.
Confirmer : `Document.connections` est une `Map` dont les **clés** sont des `Connection` (avec `.context` et `.close(event?)`), `hocuspocus.documents: Map<string, Document>`, `onAuthenticate` reçoit `{ documentName, token, connectionConfig }`. Si un nom diffère, adapter le Step 3 en conséquence (même logique).

- [ ] **Step 3 : créer `apps/web/collab-server.mjs`**

```js
/**
 * collab-server — serveur Yjs (Hocuspocus 4) pour la co-édition des notes
 * partagées, greffé sur le `upgrade` du serveur HTTP existant via crossws.
 * Un document = une ressource de partage (`documentName` = id de ressource).
 */

import { Hocuspocus } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import crossws from "crossws/adapters/node";

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;

// ponytail: état des documents en mémoire d'un seul conteneur ;
// plusieurs conteneurs exigent @hocuspocus/extension-redis.
export function createCollabServer({ store, authenticate }) {
  const hocuspocus = new Hocuspocus({
    extensions: [
      new Database({
        fetch: ({ documentName }) => store.getDoc(documentName),
        store: ({ documentName, state }) => store.putDoc(documentName, state),
      }),
    ],
    async onAuthenticate({ documentName, token, connectionConfig }) {
      const access = await authenticate(documentName, token);
      if (access.readOnly) connectionConfig.readOnly = true;
      return { slug: access.slug };
    },
  });

  const ws = crossws({
    // Refusé avant parsing : un invité ne pousse pas un document démesuré.
    serverOptions: { maxPayload: MAX_PAYLOAD_BYTES },
    hooks: {
      open(peer) {
        peer.hocuspocus = hocuspocus.handleConnection(peer.websocket, peer.request, {});
      },
      message(peer, message) {
        peer.hocuspocus?.handleMessage(message.uint8Array());
      },
      close(peer, event) {
        peer.hocuspocus?.handleClose({ code: event.code, reason: event.reason });
      },
      error(_peer, error) {
        console.error("[collab]", error);
      },
    },
  });

  function connectionsOf(resourceId) {
    return [...(hocuspocus.documents.get(resourceId)?.connections.keys() ?? [])];
  }

  return {
    handleUpgrade: (req, socket, head) => ws.handleUpgrade(req, socket, head),
    closeLink(resourceId, slug) {
      for (const c of connectionsOf(resourceId)) if (c.context?.slug === slug) c.close();
    },
    closeResource(resourceId) {
      for (const c of connectionsOf(resourceId)) c.close();
    },
    async sweep(isValid) {
      for (const [resourceId] of hocuspocus.documents) {
        for (const c of connectionsOf(resourceId)) {
          const slug = c.context?.slug;
          if (slug && !(await isValid(slug))) c.close();
        }
      }
    },
  };
}
```
Si l'option `serverOptions.maxPayload` n'existe pas dans l'adaptateur `crossws` installé (vérifier `grep -n "serverOptions\|maxPayload" apps/web/node_modules/crossws/dist/adapters/node.d.*`), la retirer et poser la limite dans `hooks.message` : `if (message.rawData.byteLength > MAX_PAYLOAD_BYTES) return peer.close(1009, "too big");`.

- [ ] **Step 4 : brancher dans `share-backend.mjs`**

Remplacer, en fin de `createShareBackend`, le `return { enabled: true, handle, attachCollab: …, authenticateCollab, store };` par :
```js
  const { createCollabServer } = await import("./collab-server.mjs");
  collab = createCollabServer({ store, authenticate: authenticateCollab });
  setInterval(() => void collab.sweep(async (slug) => linkState(await store.getLink(slug)) === "ok"), SWEEP_MS).unref();

  return { enabled: true, handle, handleUpgrade: collab.handleUpgrade };
```
et remplacer le commentaire `// Branché en Task 4 …` au-dessus de `let collab = …` par : `// Remplacé par le serveur Yjs une fois créé (fin de fonction).`

- [ ] **Step 5 : `upgrade` dans `server.mjs`**

Après la déclaration `const server = createServer(...)` (avant `server.listen`), ajouter :
```js
server.on("upgrade", (req, socket, head) => {
  if (shareBackend.handleUpgrade && (req.url ?? "").split("?")[0] === "/collab") {
    shareBackend.handleUpgrade(req, socket, head);
    return;
  }
  socket.destroy();
});
```

- [ ] **Step 6 : `upgrade` en dev (`vite.config.ts`)**

Dans `shareDevServer()`, élargir le type du paramètre de `configureServer` :
```ts
    async configureServer(server: {
      middlewares: { use: (fn: (req: unknown, res: unknown, next: () => void) => void) => void };
      httpServer: import("node:http").Server | null;
    }) {
```
et, après la création du backend (et le `if (!backend.enabled) return;` existant s'il y en a un), ajouter :
```ts
      // Le serveur HMR de Vite partage ce `upgrade` : ne toucher qu'à /collab.
      server.httpServer?.on("upgrade", (req, socket, head) => {
        if (req.url?.split("?")[0] === "/collab") backend.handleUpgrade?.(req, socket, head);
      });
```

- [ ] **Step 6 bis : une seule copie d'`Awareness`**

Dans `apps/web/vite.config.ts`, `resolve.dedupe` (l.~152, qui contient déjà `"yjs"` et `"y-prosemirror"`) : ajouter `"y-protocols"` et `"lib0"`. Le provider Hocuspocus et le plugin de curseurs de y-prosemirror doivent partager la même classe `Awareness` ; deux copies donnent des `instanceof` faux et des curseurs muets.

- [ ] **Step 7 : fumée Yjs (scratchpad)**

`<scratchpad>/t4.mjs` (lancé depuis `apps/web` pour résoudre les paquets) :
```js
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
const B = "http://localhost:3393/api/share";
const j = (r) => r.json();
const { id, ownerKey } = await fetch(`${B}/resources`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "note", title: "N" }) }).then(j);
const mk = (mode) => fetch(`${B}/resources/${id}/links`, { method: "POST", headers: { "content-type": "application/json", "x-share-owner": ownerKey }, body: JSON.stringify({ mode }) }).then(j);
const readLink = (await mk("read")).link, writeLink = (await mk("write")).link;
const tok = (slug) => fetch(`${B}/links/${slug}/unlock`, { method: "POST" }).then(j).then((r) => r.accessToken);
const connect = (token) => new Promise((resolve) => {
  const doc = new Y.Doc();
  const p = new HocuspocusProvider({ url: "ws://localhost:3393/collab", name: id, document: doc, token, onSynced: () => resolve({ doc, p }) });
});
const owner = await connect(`owner:${ownerKey}`);
const reader = await connect(await tok(readLink.slug));
const writer = await connect(await tok(writeLink.slug));
writer.doc.getText("t").insert(0, "écrit par l'invité");
reader.doc.getText("t").insert(0, "INTERDIT ");
await new Promise((r) => setTimeout(r, 1500));
console.log("owner voit :", owner.doc.getText("t").toString());
await fetch(`${B}/links/${writeLink.slug}`, { method: "DELETE", headers: { "x-share-owner": ownerKey } });
await new Promise((r) => setTimeout(r, 1500));
console.log("writer statut après révocation :", writer.p.status ?? writer.p.configuration?.websocketProvider?.status);
process.exit(0);
```
Run : `cd apps/web && rm -f /tmp/sn-t4.db* && (DATABASE_URL=file:/tmp/sn-t4.db PORT=3393 node server.mjs &) && sleep 2 && node <scratchpad>/t4.mjs; pkill -f "PORT=3393" ; pkill -f "sn-t4.db"`
Expected : `owner voit : écrit par l'invité` (sans `INTERDIT`, lecture seule imposée côté serveur) ; le writer n'est plus authentifié après révocation (statut déconnecté ou `onAuthenticationFailed` à la reconnexion).

- [ ] **Step 8 : typecheck + commit**

Run : `pnpm typecheck` → 15/15.
```bash
git add apps/web/collab-server.mjs apps/web/share-backend.mjs apps/web/server.mjs apps/web/vite.config.ts apps/web/package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(share): serveur Yjs Hocuspocus sur /collab, lecture seule et révocation imposées côté serveur"
```

---

### Task 5 : `@supernote/editor` — prop `collaboration` et amorçage Yjs

**Files :**
- Create : `packages/editor/src/collab.ts`
- Modify : `packages/editor/src/types.ts:82-188` (prop `collaboration`)
- Modify : `packages/editor/src/SupernoteEditor.tsx:138-147,169-196,239-258`
- Modify : `packages/editor/src/index.ts` (exports)
- Modify : `packages/editor/package.json` (`yjs`)

**Interfaces :**
- Produces :
  - `COLLAB_FRAGMENT = "document-store"`
  - `markdownToYUpdate(markdown: string): Uint8Array`
  - `type EditorCollaboration` (options BlockNote `collaboration` : `{ fragment, user: { name, color }, provider?: { awareness? }, showCursorLabels? … }`)
  - `SupernoteEditorProps.collaboration?: EditorCollaboration`

- [ ] **Step 1 : dépendance**

Run : `pnpm --filter @supernote/editor add yjs@^13.6.30`

- [ ] **Step 2 : `packages/editor/src/collab.ts`**

```ts
import { BlockNoteEditor } from "@blocknote/core";
import { blocksToYDoc } from "@blocknote/core/yjs";
import * as Y from "yjs";
import { supernoteSchema } from "./schema.js";
import { markdownToBlocks } from "./serialization/index.js";

export const COLLAB_FRAGMENT = "document-store";

/** État Yjs initial d'une note partagée, construit depuis son markdown. */
export function markdownToYUpdate(markdown: string): Uint8Array {
  const editor = BlockNoteEditor.create({ schema: supernoteSchema });
  const blocks = markdownToBlocks(markdown);
  const doc = blocksToYDoc(editor, blocks.length ? blocks : [{ type: "paragraph" }], COLLAB_FRAGMENT);
  return Y.encodeStateAsUpdate(doc);
}
```
(Chemins d'import alignés sur `src/export/exportHtml.ts`, qui fait déjà `../schema.js` et `../serialization/index.js` depuis un sous-dossier.)

- [ ] **Step 3 : type et prop**

En tête de `packages/editor/src/types.ts`, ajouter :
```ts
import type { BlockNoteEditorOptions, BlockSchema, InlineContentSchema, StyleSchema } from "@blocknote/core";

/** Co-édition Yjs : fragment partagé, provider (awareness des curseurs) et identité affichée. */
export type EditorCollaboration = NonNullable<
  BlockNoteEditorOptions<BlockSchema, InlineContentSchema, StyleSchema>["collaboration"]
>;
```
et dans `SupernoteEditorProps` :
```ts
  /** Co-édition : le document vient de Yjs, `initialMarkdown` est ignoré. Lu au montage seulement. */
  collaboration?: EditorCollaboration;
```

- [ ] **Step 4 : `SupernoteEditor.tsx`**
  - Déstructurer `collaboration` avec les autres props.
  - Dans les options de `useCreateBlockNote` (l.169-196) : remplacer `initialContent: initialBlocks,` par
```ts
      initialContent: collaboration ? undefined : initialBlocks,
      ...(collaboration ? { collaboration } : {}),
```
  - Dans l'effet qui ajoute un paragraphe après `databaseView` / `googleSheet` / `gmailMessage` (l.239-258), première ligne du callback d'effet :
```ts
    // En co-édition, chaque client l'ajouterait : doublons.
    if (collaboration) return;
```
  (et ajouter `collaboration` au tableau de dépendances de cet effet s'il en a un).
  - Si TypeScript refuse l'objet `collaboration` dans les options typées par le schéma Supernote, le caster via `as unknown as NonNullable<Parameters<typeof useCreateBlockNote>[0]>["collaboration"]` **avec** un commentaire d'une ligne expliquant l'écart de génériques.

- [ ] **Step 5 : exports**

Dans `packages/editor/src/index.ts` :
```ts
export { COLLAB_FRAGMENT, markdownToYUpdate } from "./collab.js";
export type { EditorCollaboration } from "./types.js";
```

- [ ] **Step 6 : build + typecheck + fumée**

Run : `pnpm build:packages && pnpm typecheck` → OK.
Fumée navigateur-agnostique impossible (BlockNote headless exige un DOM) : la vérification réelle de l'amorçage se fait en Task 9 / e2e Task 10.

- [ ] **Step 7 : commit**

```bash
git add packages/editor/src/collab.ts packages/editor/src/types.ts packages/editor/src/SupernoteEditor.tsx packages/editor/src/index.ts packages/editor/package.json pnpm-lock.yaml
git commit -m "feat(editor): co-édition Yjs (prop collaboration) et amorçage markdown → Yjs"
```

---

### Task 6 : entrée invitée `share.html`

**Files :**
- Create : `apps/web/share.html`
- Create : `apps/web/src/share/main.tsx`, `apps/web/src/share/ShareApp.tsx`, `apps/web/src/share/guest-api.ts`, `apps/web/src/share/GuestNote.tsx`, `apps/web/src/share/GuestEmail.tsx`
- Create : `apps/web/src/lib/share/types.ts` (types partagés propriétaire / invité)
- Create : `apps/web/src/lib/share/collab.ts` (URL WebSocket, couleur, événement)
- Modify : `apps/web/vite.config.ts:249` (`build.rollupOptions.input`)

**Interfaces :**
- Consumes : Task 3 (routes invité), Task 4 (`/collab`), Task 5 (`COLLAB_FRAGMENT`, prop `collaboration`).
- Produces :
  - `lib/share/types.ts` : `ShareKind = "note" | "email"`, `ShareMode = "read" | "write"`, `EmailSnapshot = { subject: string; messages: { from: string; to: string; date: string; bodyText: string }[] }`
  - `lib/share/collab.ts` : `collabUrl(): string`, `colorFor(name: string): string`, `NOTE_SHARE_EVENT = "supernote:note-share"`

- [ ] **Step 1 : `apps/web/src/lib/share/types.ts` et `collab.ts`**

```ts
// types.ts
export type ShareKind = "note" | "email";
export type ShareMode = "read" | "write";

export interface EmailSnapshot {
  subject: string;
  messages: { from: string; to: string; date: string; bodyText: string }[];
}
```
```ts
// collab.ts
export const NOTE_SHARE_EVENT = "supernote:note-share";

export function collabUrl(): string {
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/collab`;
}

const CURSOR_COLORS = ["#2f62d9", "#c2410c", "#15803d", "#a21caf", "#b45309", "#0e7490", "#be123c", "#4d7c0f"];

export function colorFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return CURSOR_COLORS[Math.abs(h) % CURSOR_COLORS.length]!;
}
```

- [ ] **Step 2 : `apps/web/share.html`**

```html
<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Partage · Supernote</title>
    <link rel="icon" type="image/png" href="/favicon.png?v=2" />
    <script>
      (function () {
        try {
          var stored = localStorage.getItem("supernote-theme");
          var theme = stored || "light";
          if (theme === "system") {
            theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
          }
          document.documentElement.classList.add(theme === "dark" ? "dark" : "light");
          document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
        } catch (_e) {}
      })();
    </script>
  </head>
  <body class="bg-[var(--surface-0)] text-[var(--text-primary)] antialiased">
    <div id="root"></div>
    <script type="module" src="/src/share/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3 : deuxième entrée Vite**

Dans `vite.config.ts`, `build.rollupOptions` (l.249), ajouter :
```ts
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        share: fileURLToPath(new URL("./share.html", import.meta.url)),
      },
```
(importer `fileURLToPath` depuis `node:url` en tête du fichier s'il n'y est pas).

- [ ] **Step 4 : `src/share/guest-api.ts`**

```ts
import type { EmailSnapshot, ShareKind, ShareMode } from "@/lib/share/types";

export interface LinkMeta { kind: ShareKind; mode: ShareMode; title: string; needsPassword: boolean }
export type Closed = "expired" | "revoked" | "missing";
export interface Access { accessToken: string; resourceId: string; kind: ShareKind; mode: ShareMode }

const base = (slug: string) => `/api/share/links/${encodeURIComponent(slug)}`;
const tokenKey = (slug: string) => `supernote.share.token.${slug}`;

export async function fetchMeta(slug: string): Promise<LinkMeta | Closed> {
  const res = await fetch(`${base(slug)}/meta`);
  if (res.ok) return res.json() as Promise<LinkMeta>;
  const body = (await res.json().catch(() => ({}))) as { reason?: Closed };
  return body.reason ?? "missing";
}

export async function unlock(slug: string, password?: string): Promise<Access | "wrong" | "locked" | Closed> {
  const res = await fetch(`${base(slug)}/unlock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(password ? { password } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as Access & { reason?: "wrong" | "locked" | Closed };
  if (!res.ok) return body.reason ?? "missing";
  try {
    sessionStorage.setItem(tokenKey(slug), JSON.stringify(body));
  } catch {
    /* session privée : on redemandera le mot de passe */
  }
  return body;
}

export function cachedAccess(slug: string): Access | null {
  try {
    const raw = sessionStorage.getItem(tokenKey(slug));
    return raw ? (JSON.parse(raw) as Access) : null;
  } catch {
    return null;
  }
}

export function forgetAccess(slug: string): void {
  try {
    sessionStorage.removeItem(tokenKey(slug));
  } catch {
    /* rien à oublier */
  }
}

export async function fetchEmail(slug: string, token: string): Promise<EmailSnapshot | null> {
  const res = await fetch(`${base(slug)}/content`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return ((await res.json()) as { snapshot: EmailSnapshot }).snapshot;
}

export async function fetchBlobUrl(slug: string, token: string, path: string): Promise<string> {
  const res = await fetch(`${base(slug)}/blob?path=${encodeURIComponent(path)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`image ${res.status}`);
  return URL.createObjectURL(await res.blob());
}
```

- [ ] **Step 5 : `src/share/main.tsx`**

```tsx
import "../globals.css";
import { createRoot } from "react-dom/client";
import { ThemeProvider, ToastProvider } from "@supernote/ui";
import { ShareApp } from "./ShareApp";

createRoot(document.getElementById("root")!).render(
  <ThemeProvider defaultTheme="light" storageKey="supernote-theme">
    <ToastProvider>
      <ShareApp slug={decodeURIComponent(window.location.pathname.replace(/^\/s\//, "").split("/")[0] ?? "")} />
    </ToastProvider>
  </ThemeProvider>,
);
```
(Vérifier les props exactes de `ThemeProvider` dans `apps/web/src/RootLayout.tsx:39` et les recopier.)

- [ ] **Step 6 : `src/share/ShareApp.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { Button, Input, Spinner } from "@supernote/ui";
import { LockSimple } from "@phosphor-icons/react";
import { cachedAccess, fetchMeta, forgetAccess, unlock, type Access, type Closed, type LinkMeta } from "./guest-api";
import { GuestNote } from "./GuestNote";
import { GuestEmail } from "./GuestEmail";

type View =
  | { kind: "loading" }
  | { kind: "closed"; reason: Closed | "lost" }
  | { kind: "password"; meta: LinkMeta; error: string | null }
  | { kind: "open"; meta: LinkMeta; access: Access };

const CLOSED_TEXT: Record<Closed | "lost", string> = {
  expired: "Ce lien a expiré.",
  revoked: "Ce lien a été retiré.",
  missing: "Ce lien n'existe pas.",
  lost: "Accès retiré : ce lien a été modifié ou révoqué.",
};

export function ShareApp({ slug }: { slug: string }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const meta = await fetchMeta(slug);
      if (typeof meta === "string") return setView({ kind: "closed", reason: meta });
      document.title = meta.title || "Partage · Supernote";
      const cached = cachedAccess(slug);
      if (cached) return setView({ kind: "open", meta, access: cached });
      if (meta.needsPassword) return setView({ kind: "password", meta, error: null });
      const access = await unlock(slug);
      setView(typeof access === "string" ? { kind: "closed", reason: access === "wrong" || access === "locked" ? "missing" : access } : { kind: "open", meta, access });
    })();
  }, [slug]);

  const submitPassword = async (meta: LinkMeta) => {
    setBusy(true);
    const access = await unlock(slug, password);
    setBusy(false);
    if (access === "wrong") return setView({ kind: "password", meta, error: "Mot de passe incorrect." });
    if (access === "locked") return setView({ kind: "password", meta, error: "Trop d'essais. Réessaie dans 15 minutes." });
    if (typeof access === "string") return setView({ kind: "closed", reason: access });
    setView({ kind: "open", meta, access });
  };

  // Stable : GuestNote recrée sa connexion Yjs si cette fonction change.
  const lose = useCallback(() => {
    forgetAccess(slug);
    setView({ kind: "closed", reason: "lost" });
  }, [slug]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-6 md:px-10 md:py-12">
      {view.kind === "loading" && (
        <div className="flex flex-1 items-center justify-center"><Spinner /></div>
      )}
      {view.kind === "closed" && (
        <p className="m-auto text-center text-[var(--text-secondary)]">{CLOSED_TEXT[view.reason]}</p>
      )}
      {view.kind === "password" && (
        <form
          className="m-auto flex w-full max-w-sm flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submitPassword(view.meta);
          }}
        >
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <LockSimple size={18} aria-hidden /> {view.meta.title || "Partage protégé"}
          </h1>
          <label htmlFor="share-password" className="text-sm text-[var(--text-secondary)]">Mot de passe</label>
          <Input id="share-password" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          {view.error && <p role="alert" className="text-sm text-[var(--danger)]">{view.error}</p>}
          <Button type="submit" variant="primary" isDisabled={busy || !password}>Ouvrir</Button>
        </form>
      )}
      {view.kind === "open" && view.access.kind === "note" && (
        <GuestNote slug={slug} title={view.meta.title} access={view.access} onLost={lose} />
      )}
      {view.kind === "open" && view.access.kind === "email" && (
        <GuestEmail slug={slug} access={view.access} onLost={lose} />
      )}
    </main>
  );
}
```
(Vérifier que `Spinner` est exporté par `@supernote/ui` ; sinon l'importer de `@heroui/react` comme `EmailThreadView.tsx:5`. Vérifier le nom du token de couleur d'erreur dans `globals.css` — `--danger` ou équivalent — et l'utiliser.)

- [ ] **Step 7 : `src/share/GuestEmail.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { EmailSnapshot } from "@/lib/share/types";
import { fetchEmail, type Access } from "./guest-api";

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export function GuestEmail({ slug, access, onLost }: { slug: string; access: Access; onLost: () => void }) {
  const [snapshot, setSnapshot] = useState<EmailSnapshot | null>(null);

  useEffect(() => {
    void fetchEmail(slug, access.accessToken).then((s) => (s ? setSnapshot(s) : onLost()));
  }, [slug, access.accessToken, onLost]);

  if (!snapshot) return null;
  return (
    <article className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold [text-wrap:balance]">{snapshot.subject || "(sans objet)"}</h1>
      {snapshot.messages.map((m, i) => (
        <section key={i} className="flex flex-col gap-2 border-t border-[var(--border-subtle)] pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className="font-medium">{m.from}</span>
            <time className="text-[var(--text-muted)]">{m.date ? dateFmt.format(new Date(m.date)) : ""}</time>
          </div>
          {m.to && <p className="text-xs text-[var(--text-muted)]">À : {m.to}</p>}
          <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.bodyText}</p>
        </section>
      ))}
    </article>
  );
}
```

- [ ] **Step 8 : `src/share/GuestNote.tsx`**

```tsx
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { Button, Input, Spinner } from "@supernote/ui";
import { COLLAB_FRAGMENT, SupernoteEditor } from "@supernote/editor";
import { collabUrl, colorFor } from "@/lib/share/collab";
import { fetchBlobUrl, fetchMeta, type Access } from "./guest-api";

const NAME_KEY = "supernote.share.guestName";

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function Unavailable() {
  return (
    <div className="rounded-md border border-dashed border-[var(--border-subtle)] px-3 py-2 text-sm text-[var(--text-muted)]">
      Contenu lié au coffre, non disponible
    </div>
  );
}

export function GuestNote({ slug, title, access, onLost }: { slug: string; title: string; access: Access; onLost: () => void }) {
  const writable = access.mode === "write";
  const [name, setName] = useState(readName);
  const [joined, setJoined] = useState(!writable || !!readName());
  const [synced, setSynced] = useState(false);

  const session = useMemo(() => {
    if (!joined) return null;
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: access.resourceId,
      document: doc,
      token: access.accessToken,
      onSynced: () => setSynced(true),
      onAuthenticationFailed: () => onLost(),
      // Une coupure serveur (révocation, expiration) peut ne pas relancer d'authentification :
      // on revérifie le lien à chaque déconnexion.
      onDisconnect: () => {
        void fetchMeta(slug).then((meta) => {
          if (typeof meta === "string") onLost();
        });
      },
    });
    return { doc, provider };
  }, [joined, slug, access.resourceId, access.accessToken, onLost]);

  useEffect(() => () => session?.provider.destroy(), [session]);

  // Un lecteur voit les curseurs des autres sans diffuser le sien.
  useEffect(() => {
    if (session && synced && !writable) session.provider.awareness?.setLocalState(null);
  }, [session, synced, writable]);

  const files = useMemo(
    () => ({
      upload: () => Promise.reject(new Error("L'ajout d'images est réservé au propriétaire.")),
      resolveUrl: (path: string) => fetchBlobUrl(slug, access.accessToken, path).catch(() => path),
    }),
    [slug, access.accessToken],
  );

  if (!joined) {
    return (
      <form
        className="m-auto flex w-full max-w-sm flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            localStorage.setItem(NAME_KEY, name.trim());
          } catch {
            /* le nom sera redemandé */
          }
          setJoined(true);
        }}
      >
        <h1 className="text-lg font-semibold">{title || "Note partagée"}</h1>
        <label htmlFor="guest-name" className="text-sm text-[var(--text-secondary)]">Ton nom</label>
        <Input id="guest-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <Button type="submit" variant="primary" isDisabled={!name.trim()}>Rejoindre</Button>
      </form>
    );
  }

  if (!session || !synced) return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;

  // Les liens internes (mention, wikilink) mèneraient vers l'app du propriétaire.
  const blockInternalLinks = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a[href^="/"]')) e.preventDefault();
  };

  const userName = writable ? name.trim() : "Lecteur";
  return (
    <div className="flex flex-col gap-4" onClickCapture={blockInternalLinks}>
      <h1 className="text-2xl font-semibold [text-wrap:balance]">{title || "Note partagée"}</h1>
      <SupernoteEditor
        readOnly={!writable}
        collaboration={{
          fragment: session.doc.getXmlFragment(COLLAB_FRAGMENT),
          provider: session.provider,
          user: { name: userName, color: colorFor(userName) },
        }}
        renderDatabaseView={Unavailable}
        renderFormula={Unavailable}
        files={files}
      />
    </div>
  );
}
```
Si `provider: session.provider` ne satisfait pas le type `EditorCollaboration["provider"]` (écart de version `y-protocols`), passer `{ awareness: session.provider.awareness ?? undefined }`.

- [ ] **Step 9 : typecheck + build + vérif manuelle**

Run : `pnpm typecheck && pnpm --filter @supernote/web build` → `dist/share.html` existe.
Fumée : `cd apps/web && rm -f /tmp/sn-t6.db* && DATABASE_URL=file:/tmp/sn-t6.db PORT=3394 node server.mjs &`, créer un email + lien lecture par les `curl` de la Task 3 (Step 5), ouvrir `http://localhost:3394/s/<slug>` dans Chrome (desktop puis émulation 390 px) : le fil s'affiche, `<b>x</b>` en texte brut ; sur un lien protégé, le formulaire de mot de passe ; sur un lien révoqué, « Ce lien a été retiré. ».

- [ ] **Step 10 : commit**

```bash
git add apps/web/share.html apps/web/src/share apps/web/src/lib/share/types.ts apps/web/src/lib/share/collab.ts apps/web/vite.config.ts
git commit -m "feat(share): page invitée (mot de passe, note en direct, fil d'email, liens fermés)"
```

---

### Task 7 : client propriétaire (API et partages d'email)

**Files :**
- Rewrite : `apps/web/src/lib/share/shareApi.ts`
- Create : `apps/web/src/lib/share/emailShares.ts`

**Interfaces :**
- Consumes : Task 3 (routes propriétaire), Task 6 (`lib/share/types.ts`).
- Produces :
  - `OwnedShare = { resourceId: string; ownerKey: string }`
  - `ShareLink = { slug: string; mode: ShareMode; hasPassword: boolean; expiresAt: number | null; label: string | null; createdAt: number; revokedAt: number | null }`
  - `class ShareGoneError extends Error` (ressource supprimée ailleurs : 403/404)
  - `shareBackendEnabled(): Promise<boolean>`
  - `createShareResource(kind: ShareKind, title: string, snapshot?: EmailSnapshot): Promise<OwnedShare>`
  - `seedShareDoc(share: OwnedShare, update: Uint8Array): Promise<void>`
  - `deleteShareResource(share: OwnedShare): Promise<void>`
  - `renameShareResource(share: OwnedShare, title: string): Promise<void>`
  - `listShareLinks(share: OwnedShare): Promise<ShareLink[]>`
  - `createShareLink(share: OwnedShare, opts: { mode: ShareMode; password?: string; expiresAt: number | null; label?: string }): Promise<ShareLink>`
  - `updateShareLink(share: OwnedShare, slug: string, patch: { password?: string | null; expiresAt?: number | null; label?: string | null }): Promise<ShareLink>`
  - `revokeShareLink(share: OwnedShare, slug: string): Promise<void>`
  - `publishShareBlob(share: OwnedShare, path: string, blob: Blob): Promise<void>`
  - `shareUrl(slug: string): string`
  - `emailShares.ts` : `getEmailShare(accountId, threadId): OwnedShare | null`, `setEmailShare(accountId, threadId, share: OwnedShare | null): void`, `emailSnapshot(thread: EmailThread): EmailSnapshot`

- [ ] **Step 1 : `shareApi.ts`**

```ts
import type { EmailSnapshot, ShareKind, ShareMode } from "./types";

export interface OwnedShare { resourceId: string; ownerKey: string }
export interface ShareLink {
  slug: string;
  mode: ShareMode;
  hasPassword: boolean;
  expiresAt: number | null;
  label: string | null;
  createdAt: number;
  revokedAt: number | null;
}

export class ShareGoneError extends Error {}

async function call<T>(path: string, init: RequestInit, share?: OwnedShare): Promise<T> {
  const headers = new Headers(init.headers);
  if (share) headers.set("x-share-owner", share.ownerKey);
  if (typeof init.body === "string") headers.set("content-type", "application/json");
  const res = await fetch(`/api/share${path}`, { ...init, headers });
  if (res.status === 403 || res.status === 404) throw new ShareGoneError("Ce partage n'existe plus.");
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Partage : erreur ${res.status}`);
  }
  return res.json() as Promise<T>;
}

let enabled: Promise<boolean> | null = null;
export function shareBackendEnabled(): Promise<boolean> {
  enabled ??= fetch("/api/share/_info").then((r) => r.ok).catch(() => false);
  return enabled;
}

export async function createShareResource(kind: ShareKind, title: string, snapshot?: EmailSnapshot): Promise<OwnedShare> {
  const r = await call<{ id: string; ownerKey: string }>("/resources", {
    method: "POST",
    body: JSON.stringify({ kind, title, snapshot }),
  });
  return { resourceId: r.id, ownerKey: r.ownerKey };
}

export async function seedShareDoc(share: OwnedShare, update: Uint8Array): Promise<void> {
  await call(`/resources/${share.resourceId}/doc`, { method: "PUT", body: update }, share).catch((err: unknown) => {
    // 409 : un autre appareil a déjà amorcé ce document, on le rejoint tel quel.
    if (!(err instanceof Error && err.message.includes("already seeded"))) throw err;
  });
}

export async function deleteShareResource(share: OwnedShare): Promise<void> {
  await call(`/resources/${share.resourceId}`, { method: "DELETE" }, share).catch((err: unknown) => {
    if (!(err instanceof ShareGoneError)) throw err;
  });
}

export async function renameShareResource(share: OwnedShare, title: string): Promise<void> {
  await call(`/resources/${share.resourceId}`, { method: "PATCH", body: JSON.stringify({ title }) }, share);
}

export async function listShareLinks(share: OwnedShare): Promise<ShareLink[]> {
  return (await call<{ links: ShareLink[] }>(`/resources/${share.resourceId}/links`, { method: "GET" }, share)).links;
}

export async function createShareLink(
  share: OwnedShare,
  opts: { mode: ShareMode; password?: string; expiresAt: number | null; label?: string },
): Promise<ShareLink> {
  return (await call<{ link: ShareLink }>(`/resources/${share.resourceId}/links`, { method: "POST", body: JSON.stringify(opts) }, share)).link;
}

export async function updateShareLink(
  share: OwnedShare,
  slug: string,
  patch: { password?: string | null; expiresAt?: number | null; label?: string | null },
): Promise<ShareLink> {
  return (await call<{ link: ShareLink }>(`/links/${slug}`, { method: "PATCH", body: JSON.stringify(patch) }, share)).link;
}

export async function revokeShareLink(share: OwnedShare, slug: string): Promise<void> {
  await call(`/links/${slug}`, { method: "DELETE" }, share);
}

export async function publishShareBlob(share: OwnedShare, path: string, blob: Blob): Promise<void> {
  await call(`/resources/${share.resourceId}/blob?path=${encodeURIComponent(path)}`, { method: "PUT", body: blob }, share);
}

export function shareUrl(slug: string): string {
  return `${window.location.origin}/s/${slug}`;
}
```
Note : `seedShareDoc` renvoie 409 avec `{ error: "already seeded" }` ; `call` lève `Error("already seeded")`, intercepté ci-dessus.

- [ ] **Step 2 : `emailShares.ts`**

```ts
import type { EmailThread } from "@/lib/gmail";
import type { OwnedShare } from "./shareApi";
import type { EmailSnapshot } from "./types";

const KEY = "supernote.share.email";

function readAll(): Record<string, OwnedShare> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, OwnedShare>;
  } catch {
    return {};
  }
}

export function getEmailShare(accountId: string, threadId: string): OwnedShare | null {
  return readAll()[`${accountId}:${threadId}`] ?? null;
}

export function setEmailShare(accountId: string, threadId: string, share: OwnedShare | null): void {
  const all = readAll();
  if (share) all[`${accountId}:${threadId}`] = share;
  else delete all[`${accountId}:${threadId}`];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* stockage plein ou bloqué : le partage reste gérable tant que l'onglet vit */
  }
}

const address = (a: { name: string; email: string }) => (a.name ? `${a.name} <${a.email}>` : a.email);

export function emailSnapshot(thread: EmailThread): EmailSnapshot {
  return {
    subject: thread.messages[0]?.subject ?? "",
    messages: thread.messages.map((m) => ({
      from: address(m.from),
      to: m.to.map(address).join(", "),
      date: m.date,
      bodyText: m.bodyText,
    })),
  };
}
```

- [ ] **Step 3 : typecheck (le vieux `ShareNotePanel` importe encore l'ancienne API : il casse, c'est attendu et réglé en Task 9).**

Run : `pnpm typecheck`
Expected : erreurs **uniquement** dans `components/notes/ShareNotePanel.tsx` (imports `getShareStatus`, `publishShare`, `unpublishShare`, `shareBackendInfo` disparus). Pour garder chaque commit vert, supprimer dès maintenant `ShareNotePanel.tsx` et `lib/share/exportNoteHtml.ts` et retirer l'import + le rendu `<ShareNotePanel … />` de `NoteEditor.tsx:64,2028` ; le bouton de remplacement arrive en Task 9.
Puis : `grep -rn "markdownToHtmlLossy" apps packages --include=*.ts --include=*.tsx | grep -v "packages/editor/src"` → si vide, retirer l'export `markdownToHtmlLossy` de `packages/editor/src/index.ts`, supprimer `packages/editor/src/export/exportHtml.ts`, `pnpm build:packages`.
Run : `pnpm typecheck` → 15/15.

- [ ] **Step 4 : commit**

```bash
git add apps/web/src/lib/share/shareApi.ts apps/web/src/lib/share/emailShares.ts apps/web/src/components/notes/NoteEditor.tsx
git rm apps/web/src/components/notes/ShareNotePanel.tsx apps/web/src/lib/share/exportNoteHtml.ts
# si retiré : git rm packages/editor/src/export/exportHtml.ts && git add packages/editor/src/index.ts
git commit -m "feat(share): client propriétaire v2, retire le partage par instantané HTML"
```

---

### Task 8 : `ShareDialog` et partage d'un fil d'email

**Files :**
- Create : `apps/web/src/components/share/ShareDialog.tsx`
- Modify : `apps/web/src/components/mail/EmailThreadView.tsx` (état, entrée du menu « Plus », rendu du dialogue)

**Interfaces :**
- Consumes : Task 7.
- Produces : `ShareDialog(props: { isOpen: boolean; onClose: () => void; kind: ShareKind; title: string; owned: OwnedShare | null; onStart: () => Promise<OwnedShare>; onStop: () => Promise<void>; onGone: () => void; note?: string })`

- [ ] **Step 1 : `components/share/ShareDialog.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, LockSimple, Trash } from "@phosphor-icons/react";
import { Badge, Button, Input, Modal, Switch, Tooltip } from "@supernote/ui";
import { MobileSheet } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useActionFeedback, FeedbackIcon } from "@/lib/action-feedback";
import { useConfirm } from "@/lib/confirm";
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  shareUrl,
  ShareGoneError,
  type OwnedShare,
  type ShareLink,
} from "@/lib/share/shareApi";
import type { ShareKind, ShareMode } from "@/lib/share/types";

const HOUR = 3_600_000;
const DURATIONS: { id: string; label: string; ms: number | null }[] = [
  { id: "none", label: "Sans limite", ms: null },
  { id: "1h", label: "1 h", ms: HOUR },
  { id: "24h", label: "24 h", ms: 24 * HOUR },
  { id: "7d", label: "7 j", ms: 7 * 24 * HOUR },
  { id: "30d", label: "30 j", ms: 30 * 24 * HOUR },
  { id: "date", label: "Date…", ms: null },
];

const whenFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

function expiryText(link: ShareLink): string {
  if (link.expiresAt == null) return "Sans limite";
  return link.expiresAt <= Date.now() ? "Expiré" : `Jusqu'au ${whenFmt.format(link.expiresAt)}`;
}

function LinkRow({ link, onRevoke }: { link: ShareLink; onRevoke: () => Promise<void> }) {
  const copyFb = useActionFeedback();
  const revokeFb = useActionFeedback();
  const url = shareUrl(link.slug);
  return (
    <li className="flex items-center gap-2 border-b border-[var(--border-subtle)] py-2 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <Badge>{link.mode === "write" ? "Écriture" : "Lecture"}</Badge>
          {link.hasPassword && <LockSimple size={14} aria-label="Protégé par mot de passe" />}
          <span className="text-[var(--text-muted)]">{expiryText(link)}</span>
          {link.label && <span className="truncate">· {link.label}</span>}
        </div>
        <span data-testid="share-link-url" className="truncate font-mono text-xs text-[var(--text-muted)]">{url}</span>
      </div>
      <Tooltip content={copyFb.state === "success" ? "Copié" : (copyFb.error ?? "Copier le lien")}>
        <Button variant="ghost" size="icon" aria-label="Copier le lien" className="h-9 w-9" onPress={() => void copyFb.run(() => navigator.clipboard.writeText(url))}>
          <FeedbackIcon state={copyFb.state} error={copyFb.error} idle={<Copy size={16} />} />
        </Button>
      </Tooltip>
      <Tooltip content={revokeFb.error ?? "Retirer ce lien"}>
        <Button variant="ghost" size="icon" aria-label="Retirer ce lien" className="h-9 w-9" onPress={() => void revokeFb.run(onRevoke)}>
          <FeedbackIcon state={revokeFb.state} error={revokeFb.error} idle={<Trash size={16} />} />
        </Button>
      </Tooltip>
    </li>
  );
}

export interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  kind: ShareKind;
  title: string;
  owned: OwnedShare | null;
  onStart: () => Promise<OwnedShare>;
  onStop: () => Promise<void>;
  onGone: () => void;
  /** Avertissement propre au type de ressource (ex. clé stockée dans la note). */
  note?: string;
}

export function ShareDialog({ isOpen, onClose, kind, title, owned, onStart, onStop, onGone, note }: ShareDialogProps) {
  const isMobile = useIsMobile();
  const confirm = useConfirm();
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [mode, setMode] = useState<ShareMode>("read");
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState("");
  const [duration, setDuration] = useState("none");
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const createFb = useActionFeedback();
  const stopFb = useActionFeedback();

  const guard = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        if (err instanceof ShareGoneError) onGone();
        throw err;
      }
    },
    [onGone],
  );

  useEffect(() => {
    if (!isOpen || !owned) return setLinks([]);
    void guard(() => listShareLinks(owned)).then(setLinks, () => setLinks([]));
  }, [isOpen, owned, guard]);

  const expiresAt = (): number | null => {
    if (duration === "date") return date ? new Date(date).getTime() : null;
    const ms = DURATIONS.find((d) => d.id === duration)?.ms;
    return ms == null ? null : Date.now() + ms;
  };

  const create = () =>
    createFb.run(async () => {
      const share = owned ?? (await onStart());
      const link = await guard(() =>
        createShareLink(share, {
          mode: kind === "email" ? "read" : mode,
          password: protect ? password : undefined,
          expiresAt: expiresAt(),
          label: label.trim() || undefined,
        }),
      );
      setLinks((prev) => [...prev, link]);
      setPassword("");
      setLabel("");
    });

  const stop = async () => {
    const ok = await confirm({
      title: "Arrêter le partage ?",
      body: "Tous les liens cessent de fonctionner et les personnes connectées sont déconnectées.",
      confirmLabel: "Arrêter le partage",
      variant: "danger",
    });
    if (ok) await stopFb.run(onStop);
  };

  const active = links.filter((l) => !l.revokedAt);
  const canCreate = !(protect && password.length < 6) && !(duration === "date" && !date);

  const body = (
    <div className="flex flex-col gap-5">
      {active.length > 0 && (
        <ul className="flex flex-col">
          {active.map((link) => (
            <LinkRow
              key={link.slug}
              link={link}
              onRevoke={async () => {
                await guard(() => revokeShareLink(owned!, link.slug));
                setLinks((prev) => prev.filter((l) => l.slug !== link.slug));
              }}
            />
          ))}
        </ul>
      )}

      <section className="flex flex-col gap-3" aria-label="Nouveau lien">
        <h3 className="text-sm font-semibold">Nouveau lien</h3>
        {kind === "note" && (
          <div className="flex gap-1" role="group" aria-label="Droits">
            {(["read", "write"] as const).map((m) => (
              <Button key={m} size="sm" variant={mode === m ? "primary" : "ghost"} aria-pressed={mode === m} onPress={() => setMode(m)}>
                {m === "read" ? "Lecture" : "Écriture"}
              </Button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="share-protect" className="text-sm">Protéger par mot de passe</label>
          <Switch id="share-protect" isSelected={protect} onChange={(sel) => setProtect(Boolean(sel))} aria-label="Protéger par mot de passe" />
        </div>
        {protect && (
          <Input type="password" aria-label="Mot de passe du lien" placeholder="6 caractères minimum" value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
        <div className="flex flex-wrap gap-1" role="group" aria-label="Durée">
          {DURATIONS.map((d) => (
            <Button key={d.id} size="sm" variant={duration === d.id ? "primary" : "ghost"} aria-pressed={duration === d.id} onPress={() => setDuration(d.id)}>
              {d.label}
            </Button>
          ))}
        </div>
        {duration === "date" && (
          <Input type="datetime-local" aria-label="Date d'expiration" value={date} onChange={(e) => setDate(e.target.value)} />
        )}
        <Input aria-label="Libellé (facultatif)" placeholder="Libellé, ex. pour Paul" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
        <Button variant="primary" isDisabled={!canCreate || createFb.isPending} onPress={() => void create()}>
          <FeedbackIcon state={createFb.state} error={createFb.error} idle={null} />
          Créer le lien
        </Button>
        {createFb.error && <p role="alert" className="text-sm text-[var(--danger)]">{createFb.error}</p>}
      </section>

      {note && <p className="text-xs text-[var(--text-muted)]">{note}</p>}

      {owned && (
        <Button variant="ghost" className="self-start text-[var(--danger)]" onPress={() => void stop()}>
          <FeedbackIcon state={stopFb.state} error={stopFb.error} idle={null} />
          Arrêter le partage
        </Button>
      )}
    </div>
  );

  const heading = `Partager « ${title || (kind === "note" ? "Sans titre" : "(sans objet)")} »`;
  if (isMobile) {
    return (
      <MobileSheet isOpen={isOpen} onClose={onClose} title={heading} size="lg">
        <div className="px-4 pb-6">{body}</div>
      </MobileSheet>
    );
  }
  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} title={heading} size="md">
      {body}
    </Modal>
  );
}
```
Vérifications en écrivant : variantes de `Button` de `@supernote/ui` (`primary`, `ghost`, taille `icon`, déjà utilisées dans `TopBar.tsx`) ; `Badge` sans prop obligatoire ; nom du token de couleur d'erreur (`--danger` ou celui de `globals.css`) ; `FeedbackIcon` accepte `idle={null}` (sinon passer un fragment vide).

- [ ] **Step 2 : brancher dans `EmailThreadView.tsx`**
  - Imports : `ShareNetwork` depuis `@phosphor-icons/react` (liste l.4), `import { ShareDialog } from "@/components/share/ShareDialog";`, `import { createShareResource, deleteShareResource, shareBackendEnabled, type OwnedShare } from "@/lib/share/shareApi";`, `import { emailSnapshot, getEmailShare, setEmailShare } from "@/lib/share/emailShares";`.
  - Après `const [moreOpen, setMoreOpen] = useState(false);` (l.249) :
```tsx
  const shareAccount = selfEmail || settings.gmail.connectedEmail;
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEnabled, setShareEnabled] = useState(false);
  const [emailShare, setEmailShareState] = useState<OwnedShare | null>(null);
  useEffect(() => {
    void shareBackendEnabled().then(setShareEnabled);
  }, []);
  useEffect(() => {
    setEmailShareState(shareAccount ? getEmailShare(shareAccount, thread.id) : null);
  }, [shareAccount, thread.id]);
  const rememberEmailShare = (share: OwnedShare | null) => {
    setEmailShare(shareAccount, thread.id, share);
    setEmailShareState(share);
  };
```
  - Dans le menu « Plus », après l'entrée « Transférer » (chercher `Transférer` dans le JSX du Popover), ajouter :
```tsx
{shareEnabled && shareAccount && (
  <Button
    variant="ghost"
    className={MENU_ROW}
    aria-label="Partager par lien"
    onPress={() => {
      setMoreOpen(false);
      setShareOpen(true);
    }}
  >
    <ShareNetwork size={16} />
    <span>Partager par lien</span>
  </Button>
)}
```
  - À côté de `<EnrichContactFromEmail … />` (l.~1156, hors du Popover) :
```tsx
{!embedded && (
  <ShareDialog
    isOpen={shareOpen}
    onClose={() => setShareOpen(false)}
    kind="email"
    title={subject ?? ""}
    owned={emailShare}
    onStart={async () => {
      const share = await createShareResource("email", subject ?? "", emailSnapshot(thread));
      rememberEmailShare(share);
      return share;
    }}
    onStop={async () => {
      if (emailShare) await deleteShareResource(emailShare);
      rememberEmailShare(null);
      setShareOpen(false);
    }}
    onGone={() => rememberEmailShare(null)}
    note="Le fil est publié tel qu'il est maintenant, sans pièces jointes. Les réponses suivantes n'y apparaîtront pas."
  />
)}
```
  (`subject` est défini l.863 ; si le rendu du dialogue est placé avant, utiliser `thread.messages[0]?.subject`.)
  - Mobile : le menu « Plus » est la même barre d'actions sous 768 px (sticky en haut), rien d'autre à publier.

- [ ] **Step 3 : typecheck + vérif manuelle**

Run : `pnpm typecheck` → 15/15.
`pnpm dev` (avec `DATABASE_URL` dans `apps/web/.env.local`), ouvrir un fil, « Plus » → « Partager par lien » → « Créer le lien », copier, ouvrir en navigation privée : le fil s'affiche. Retirer le lien → « Ce lien a été retiré. ». Tester aussi en `?mobile=1`.

- [ ] **Step 4 : commit**

```bash
git add apps/web/src/components/share/ShareDialog.tsx apps/web/src/components/mail/EmailThreadView.tsx
git commit -m "feat(share): dialogue de partage, partage d'un fil d'email par lien"
```

---

### Task 9 : co-édition des notes côté propriétaire

**Files :**
- Create : `apps/web/src/components/notes/useNoteCollab.ts`
- Create : `apps/web/src/lib/share/noteImages.ts`
- Modify : `apps/web/src/components/notes/NoteEditor.tsx` (état de partage, mode co-édition, bouton, dialogue, présence, images)
- Modify : `apps/web/src/app/notes/[id]/page.tsx:557-577` (action mobile « Partager »)

**Interfaces :**
- Consumes : Tasks 5, 6 (`collabUrl`, `colorFor`, `NOTE_SHARE_EVENT`), 7, 8.
- Produces :
  - `useNoteCollab(share: { id: string; key: string } | null, user: { name: string; color: string }, onGone: () => void): { status: "off" | "connecting" | "offline" | "ready"; collaboration?: EditorCollaboration; peers: { name: string; color: string }[] }`
  - `publishNoteImages(share: OwnedShare, markdown: string, resolveUrl: (path: string) => Promise<string>, done: Set<string>): Promise<void>`

- [ ] **Step 1 : `lib/share/noteImages.ts`**

```ts
import { publishShareBlob, type OwnedShare } from "./shareApi";

const IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g;

/** Publie les images de coffre de la note pas encore envoyées (`done` est muté). */
export async function publishNoteImages(
  share: OwnedShare,
  markdown: string,
  resolveUrl: (path: string) => Promise<string>,
  done: Set<string>,
): Promise<void> {
  for (const [, path] of markdown.matchAll(IMAGE_RE)) {
    if (!path || done.has(path) || /^(https?|data|blob):/.test(path)) continue;
    const url = await resolveUrl(path);
    if (!url.startsWith("blob:")) continue;
    const blob = await (await fetch(url)).blob();
    if (blob.size > 10 * 1024 * 1024) continue;
    await publishShareBlob(share, path, blob);
    done.add(path);
  }
}
```

- [ ] **Step 2 : `components/notes/useNoteCollab.ts`**

```ts
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import { COLLAB_FRAGMENT, type EditorCollaboration } from "@supernote/editor";
import { collabUrl } from "@/lib/share/collab";

export interface Peer { name: string; color: string }
export interface NoteCollab {
  status: "off" | "connecting" | "offline" | "ready";
  collaboration?: EditorCollaboration;
  peers: Peer[];
}

const OFFLINE_GRACE_MS = 3000;

export function useNoteCollab(
  share: { id: string; key: string } | null,
  user: Peer,
  onGone: () => void,
): NoteCollab {
  const [state, setState] = useState<NoteCollab>({ status: "off", peers: [] });
  const onGoneRef = useRef(onGone);
  onGoneRef.current = onGone;
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    if (!share) {
      setState({ status: "off", peers: [] });
      return undefined;
    }
    setState({ status: "connecting", peers: [] });
    const doc = new Y.Doc();
    const local = new IndexeddbPersistence(`supernote-collab-${share.id}`, doc);
    const provider = new HocuspocusProvider({
      url: collabUrl(),
      name: share.id,
      document: doc,
      token: `owner:${share.key}`,
      onAuthenticationFailed: () => onGoneRef.current(),
    });
    const fragment = doc.getXmlFragment(COLLAB_FRAGMENT);
    let ready = false;
    const markReady = () => {
      if (ready) return;
      ready = true;
      setState((s) => ({ ...s, status: "ready", collaboration: { fragment, provider, user: userRef.current } }));
    };
    provider.on("synced", markReady);
    // Hors ligne : on édite la copie locale, fusionnée (CRDT) à la reconnexion.
    const timer = window.setTimeout(() => {
      void local.whenSynced.then(() => {
        if (fragment.length > 0) markReady();
        else if (!ready) setState((s) => ({ ...s, status: "offline" }));
      });
    }, OFFLINE_GRACE_MS);

    const awareness = provider.awareness;
    const onAwareness = () => {
      if (!awareness) return;
      const peers: Peer[] = [];
      awareness.getStates().forEach((s, clientId) => {
        const u = (s as { user?: Peer }).user;
        if (clientId !== awareness.clientID && u?.name) peers.push(u);
      });
      setState((st) => ({ ...st, peers }));
    };
    awareness?.on("change", onAwareness);

    return () => {
      window.clearTimeout(timer);
      awareness?.off("change", onAwareness);
      provider.destroy();
      void local.destroy();
      doc.destroy();
    };
  }, [share?.id, share?.key]);

  return state;
}
```
Si `provider: provider` ne satisfait pas `EditorCollaboration["provider"]`, passer `{ awareness: provider.awareness ?? undefined }` (même remarque qu'en Task 6).

- [ ] **Step 3 : état de partage dans `NoteEditor.tsx`**

Repères (lire les zones avant d'éditer) : init des champs l.259-261, réinit sur changement de note l.696-722, handler d'icône l.303-316 (modèle de mutation `entities.update`), effet de remontage sur body externe l.730-756, `handleManualSave` l.1313-1331, `fileAdapter` l.1248-1255, rendu de l'éditeur l.2148-2179, rangée méta l.1908-2080.

  - Imports : `ShareNetwork` (Phosphor), `ShareDialog`, `useNoteCollab`, `publishNoteImages`, `NOTE_SHARE_EVENT` + `colorFor` (`@/lib/share/collab`), `createShareResource`, `deleteShareResource`, `seedShareDoc`, `shareBackendEnabled` (`@/lib/share/shareApi`), `markdownToYUpdate` (`@supernote/editor`), `useSettings` si pas déjà importé.
  - État, à côté de `icon`/`cover` (l.259-261) :
```tsx
  const readShare = (fields: Record<string, unknown> | undefined) => {
    const id = typeof fields?.["shareId"] === "string" ? fields["shareId"] : "";
    const key = typeof fields?.["shareKey"] === "string" ? fields["shareKey"] : "";
    return id && key ? { id, key } : null;
  };
  const [share, setShare] = useState(() => readShare(note.fields));
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEnabled, setShareEnabled] = useState(false);
```
  et dans l'effet de réinitialisation sur `note.id` (l.696-722) : `setShare(readShare(note.fields));`.
  - Identité et hook :
```tsx
  const ownerName = settings.gmail.connectedEmail.split("@")[0] || "Propriétaire";
  const handleShareGone = useCallback(() => {
    setShare(null);
    void trpcVanillaClient.entities.update.mutate({ id: note.id, fields: { shareId: "", shareKey: "" } });
  }, [note.id]);
  const collab = useNoteCollab(share, { name: ownerName, color: colorFor(ownerName) }, handleShareGone);
  useEffect(() => {
    void shareBackendEnabled().then(setShareEnabled);
  }, []);
  useEffect(() => {
    // Plusieurs NoteEditor peuvent être montés (colonnes empilées) : seul le bon s'ouvre.
    const open = (e: Event) => {
      if ((e as CustomEvent<{ noteId: string }>).detail?.noteId === note.id) setShareOpen(true);
    };
    window.addEventListener(NOTE_SHARE_EVENT, open);
    return () => window.removeEventListener(NOTE_SHARE_EVENT, open);
  }, [note.id]);
```
  - Effet de remontage sur body externe (l.730-756) : première ligne du callback `if (share) return;` (et `share` dans ses dépendances) — en co-édition, Yjs fait foi.
  - Démarrer / arrêter :
```tsx
  const startShare = async () => {
    const owned = await createShareResource("note", title);
    await seedShareDoc(owned, markdownToYUpdate(bodyRef.current));
    await publishNoteImages(owned, bodyRef.current, fileAdapter.resolveUrl, publishedImagesRef.current);
    await trpcVanillaClient.entities.update.mutate({
      id: note.id,
      fields: { shareId: owned.resourceId, shareKey: owned.ownerKey },
    });
    setShare({ id: owned.resourceId, key: owned.ownerKey });
    return owned;
  };
  const stopShare = async () => {
    // Le markdown à jour est écrit avant de quitter la co-édition.
    await handleManualSave();
    if (share) await deleteShareResource({ resourceId: share.id, ownerKey: share.key });
    await trpcVanillaClient.entities.update.mutate({ id: note.id, fields: { shareId: "", shareKey: "" } });
    // Le cache tRPC n'est pas encore rafraîchi : l'éditeur normal repart du contenu courant.
    setPendingBody(bodyRef.current);
    setShare(null);
    setShareOpen(false);
  };
```
  (`setPendingBody` est le setter de l'état `pendingBody` déjà passé en `initialMarkdown={pendingBody ?? note.body}` — vérifier son nom exact dans le fichier ; `handleManualSave` doit être déclaré avant ou être appelé via une ref si l'ordre des déclarations l'impose ; `publishedImagesRef = useRef(new Set<string>())`, remis à `new Set()` au changement de note.)
  - Images ajoutées pendant le partage : dans `handleEditorChange` (l.1257-1268), après `triggerAutoSave(md, title)` :
```tsx
    if (share) {
      window.clearTimeout(imagesTimerRef.current);
      imagesTimerRef.current = window.setTimeout(() => {
        void publishNoteImages({ resourceId: share.id, ownerKey: share.key }, md, fileAdapter.resolveUrl, publishedImagesRef.current).catch(() => {});
      }, 2000);
    }
```
  (`imagesTimerRef = useRef<number>()`.)
  - Titre suivi par la page invitée : effet sur `[share, title]`, débouncé 1 s, qui appelle `renameShareResource({ resourceId: share.id, ownerKey: share.key }, title).catch(() => {})` quand `share` est non nul (import depuis `@/lib/share/shareApi`).

- [ ] **Step 4 : rendu de l'éditeur en co-édition (l.2148-2179)**

Envelopper le `<SupernoteEditor … />` existant :
```tsx
{share && collab.status !== "ready" ? (
  <p className="py-6 text-sm text-[var(--text-muted)]">
    {collab.status === "offline"
      ? "Hors ligne : la note partagée s'ouvrira à la reconnexion."
      : "Connexion au partage…"}
  </p>
) : (
  <SupernoteEditor
    key={share ? `${note.id}:collab:${share.id}` : `${note.id}:${externalBodyVersion}:${bindingsKey}`}
    collaboration={share ? collab.collaboration : undefined}
    /* …props existantes inchangées… */
  />
)}
```

- [ ] **Step 5 : bouton, présence, dialogue**
  - **Hors de la rangée méta repliable** (elle est repliée par défaut via `metaOpen`, l.1908 : un bouton dedans est invisible). Placer le bouton et la présence dans une même ligne toujours visible, juste sous le titre de la note (bloc « hero », l.1844-1906), visible aussi sur mobile. L'ancien emplacement (l.2028) reste vide. Bouton :
```tsx
{shareEnabled && (
  <Tooltip content={share ? "Partagée · gérer les liens" : "Partager"}>
    <Button
      variant="ghost"
      size="icon"
      aria-label="Partager"
      className="h-8 w-8"
      style={{ color: share ? "var(--accent)" : "var(--text-muted)" }}
      onPress={() => setShareOpen(true)}
    >
      <ShareNetwork size={15} />
    </Button>
  </Tooltip>
)}
```
  - Présence, dans la même ligne que le bouton :
```tsx
{collab.peers.length > 0 && (
  <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-muted)]" aria-label="Personnes connectées">
    {collab.peers.map((p, i) => (
      <span key={`${p.name}-${i}`} className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
        {p.name}
      </span>
    ))}
  </div>
)}
```
  - Dialogue, en fin de rendu :
```tsx
<ShareDialog
  isOpen={shareOpen}
  onClose={() => setShareOpen(false)}
  kind="note"
  title={title}
  owned={share ? { resourceId: share.id, ownerKey: share.key } : null}
  onStart={startShare}
  onStop={stopShare}
  onGone={handleShareGone}
  note="La clé de gestion du partage est enregistrée dans la note : un coffre git publié en public l'expose. Tant que la note est partagée, une modification du fichier .md hors de Supernote est écrasée."
/>
```

- [ ] **Step 6 : action mobile (`app/notes/[id]/page.tsx:557-577`)**

Ajouter à la liste passée à `useMobileHeaderActions` :
```tsx
{
  id: "share-note",
  icon: ShareNetwork,
  label: "Partager",
  onPress: () => window.dispatchEvent(new CustomEvent(NOTE_SHARE_EVENT, { detail: { noteId: params.id } })),
},
```
(imports `ShareNetwork` et `NOTE_SHARE_EVENT` ; `params.id` est l'identifiant de note déjà utilisé par la page pour `useNote(params.id)`).

- [ ] **Step 7 : typecheck + vérif manuelle à deux navigateurs**

Run : `pnpm typecheck` → 15/15.
`pnpm dev` : ouvrir une note → Partager → Écriture → Créer le lien → ouvrir le lien en navigation privée, saisir « Paul », taper : le texte et le curseur « Paul » apparaissent chez le propriétaire, le `.md` se met à jour (recharger la note). Fermer l'onglet propriétaire, taper chez l'invité, rouvrir la note : les modifications y sont. « Arrêter le partage » : l'invité voit « Accès retiré », la note repasse en mode normal avec le dernier contenu. Refaire en `?mobile=1` (action « Partager » de la top bar).

- [ ] **Step 8 : commit**

```bash
git add apps/web/src/components/notes/useNoteCollab.ts apps/web/src/lib/share/noteImages.ts apps/web/src/components/notes/NoteEditor.tsx "apps/web/src/app/notes/[id]/page.tsx"
git commit -m "feat(share): co-édition des notes partagées, présence et publication des images"
```

---

### Task 10 : e2e `07-share.spec.ts`

**Files :**
- Create : `tests/e2e/07-share.spec.ts`
- Modify : `playwright.config.ts:24-29` (`env` du `webServer`)
- Modify : `tests/e2e/helpers.ts` (exporter `withInbox` et `openNewNote`)
- Modify : `tests/e2e/06-mail.spec.ts` (importer `withInbox` depuis `helpers.ts`)
- Modify : `.gitignore` si `apps/web/e2e-share.db*` n'est pas déjà ignoré

**Interfaces :**
- Consumes : tout ce qui précède.

- [ ] **Step 1 : base e2e déterministe**

`playwright.config.ts`, dans `webServer` :
```ts
    env: { DATABASE_URL: "file:./e2e-share.db" },
```
Run : `git check-ignore apps/web/e2e-share.db || echo "à ignorer"` ; si « à ignorer », ajouter `apps/web/e2e-share.db*` à `.gitignore`.

- [ ] **Step 2 : helpers**
  - Déplacer `MESSAGE` et `withInbox` de `tests/e2e/06-mail.spec.ts:7-41` vers `tests/e2e/helpers.ts` (exportés), et les importer dans `06-mail.spec.ts`.
  - Lire `tests/e2e/02-write-note.spec.ts` et en extraire le parcours « créer une note et taper dedans » dans `export async function openNewNote(page: Page, title: string): Promise<void>` (boot `bootCloud(page)`, création, titre rempli, éditeur prêt).

- [ ] **Step 3 : `tests/e2e/07-share.spec.ts`**

```ts
import { expect, test, type Browser, type Page } from "@playwright/test";
import { openNewNote, withInbox } from "./helpers";

async function createLink(owner: Page, opts: { write?: boolean; password?: string } = {}): Promise<string> {
  await owner.getByRole("button", { name: "Partager" }).first().click();
  if (opts.write) await owner.getByRole("button", { name: "Écriture" }).click();
  if (opts.password) {
    await owner.getByLabel("Protéger par mot de passe").click();
    await owner.getByLabel("Mot de passe du lien").fill(opts.password);
  }
  await owner.getByRole("button", { name: "Créer le lien" }).click();
  const url = (await owner.getByTestId("share-link-url").last().textContent())!.trim();
  await owner.keyboard.press("Escape");
  return url;
}

async function guestPage(browser: Browser, url: string, viewport?: { width: number; height: number }): Promise<Page> {
  const ctx = await browser.newContext(viewport ? { viewport, isMobile: true, hasTouch: true } : {});
  const page = await ctx.newPage();
  await page.goto(url);
  return page;
}

test.describe("07 — partage", () => {
  test("lien écriture : l'invité tape, le propriétaire voit texte et curseur", async ({ page: owner, browser }) => {
    await openNewNote(owner, "Note partagée e2e");
    const url = await createLink(owner, { write: true });
    const guest = await guestPage(browser, url);
    await guest.getByLabel("Ton nom").fill("Paul");
    await guest.getByRole("button", { name: "Rejoindre" }).click();
    await guest.locator(".bn-editor").first().click();
    await guest.keyboard.type("Bonjour depuis l'invité");
    await expect(owner.locator(".bn-editor").first()).toContainText("Bonjour depuis l'invité");
    await expect(owner.getByLabel("Personnes connectées")).toContainText("Paul");
  });

  test("lien lecture : l'invité voit le texte sans pouvoir éditer", async ({ page: owner, browser }) => {
    await openNewNote(owner, "Note lecture e2e");
    await owner.locator(".bn-editor").first().click();
    await owner.keyboard.type("Texte du propriétaire");
    const url = await createLink(owner);
    const guest = await guestPage(browser, url);
    await expect(guest.locator(".bn-editor").first()).toContainText("Texte du propriétaire");
    await expect(guest.locator('.bn-editor[contenteditable="true"]')).toHaveCount(0);
  });

  test("mot de passe : refus puis accès", async ({ page: owner, browser }) => {
    await openNewNote(owner, "Note protégée e2e");
    const url = await createLink(owner, { password: "secret-e2e" });
    const guest = await guestPage(browser, url);
    await guest.getByLabel("Mot de passe").fill("faux-mot");
    await guest.getByRole("button", { name: "Ouvrir" }).click();
    await expect(guest.getByRole("alert")).toContainText("Mot de passe incorrect");
    await guest.getByLabel("Mot de passe").fill("secret-e2e");
    await guest.getByRole("button", { name: "Ouvrir" }).click();
    await expect(guest.locator(".bn-editor").first()).toBeVisible();
  });

  test("lien expiré et lien révoqué", async ({ page, request }) => {
    const res = await (await request.post("/api/share/resources", {
      data: { kind: "email", title: "Fil", snapshot: { subject: "S", messages: [{ from: "a", to: "b", date: "", bodyText: "x" }] } },
    })).json() as { id: string; ownerKey: string };
    const headers = { "x-share-owner": res.ownerKey };
    const mk = async (data: object) =>
      ((await (await request.post(`/api/share/resources/${res.id}/links`, { headers, data })).json()) as { link: { slug: string } }).link.slug;
    const expiring = await mk({ mode: "read", expiresAt: Date.now() + 1500 });
    const revoked = await mk({ mode: "read" });
    await request.delete(`/api/share/links/${revoked}`, { headers });
    await page.waitForTimeout(2000);
    await page.goto(`/s/${expiring}`);
    await expect(page.getByText("Ce lien a expiré.")).toBeVisible();
    await page.goto(`/s/${revoked}`);
    await expect(page.getByText("Ce lien a été retiré.")).toBeVisible();
  });

  test("révocation : l'invité connecté est coupé", async ({ page: owner, browser }) => {
    await openNewNote(owner, "Note révoquée e2e");
    const url = await createLink(owner, { write: true });
    const guest = await guestPage(browser, url);
    await guest.getByLabel("Ton nom").fill("Léa");
    await guest.getByRole("button", { name: "Rejoindre" }).click();
    await expect(guest.locator(".bn-editor").first()).toBeVisible();
    await owner.getByRole("button", { name: "Partager" }).first().click();
    await owner.getByRole("button", { name: "Retirer ce lien" }).last().click();
    await expect(guest.getByText("Accès retiré")).toBeVisible({ timeout: 15_000 });
  });

  test("email : le fil partagé s'affiche en texte, sans HTML interprété", async ({ page, browser, request }) => {
    const res = await (await request.post("/api/share/resources", {
      data: { kind: "email", title: "Fil", snapshot: { subject: "Sujet e2e", messages: [{ from: "Alice", to: "Bob", date: "2026-09-22T10:00:00Z", bodyText: "<b>gras</b>" }] } },
    })).json() as { id: string; ownerKey: string };
    const link = ((await (await request.post(`/api/share/resources/${res.id}/links`, {
      headers: { "x-share-owner": res.ownerKey }, data: { mode: "read" },
    })).json()) as { link: { slug: string } }).link.slug;
    const guest = await guestPage(browser, `/s/${link}`);
    await expect(guest.getByRole("heading", { name: "Sujet e2e" })).toBeVisible();
    await expect(guest.getByText("<b>gras</b>")).toBeVisible();
    await expect(guest.locator("article b")).toHaveCount(0);

    await withInbox(page);
    await page.goto("/mail");
    await page.getByText("Compte rendu réunion").first().click();
    await page.getByRole("button", { name: "Plus d'actions" }).click();
    await page.getByRole("button", { name: "Partager par lien" }).click();
    await page.getByRole("button", { name: "Créer le lien" }).click();
    await expect(page.getByTestId("share-link-url")).toHaveCount(1);
  });

  test("mobile : page invitée sans débordement horizontal", async ({ page: owner, browser }) => {
    await openNewNote(owner, "Note mobile e2e");
    const url = await createLink(owner);
    const guest = await guestPage(browser, url, { width: 390, height: 844 });
    await expect(guest.locator(".bn-editor").first()).toBeVisible();
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
```
Le `guestPage` d'un chemin relatif (`/s/…`) s'appuie sur `baseURL` du contexte : `browser.newContext()` ne l'hérite pas, passer `baseURL: "http://localhost:3277"` dans `newContext` si `goto` échoue sur une URL relative.

- [ ] **Step 4 : lancer**

Run : `rm -f apps/web/e2e-share.db* && pnpm test:e2e tests/e2e/07-share.spec.ts tests/e2e/06-mail.spec.ts`
Expected : 7 + 4 tests verts. En cas d'échec, lire la trace (`tests/e2e/results`), corriger le code (pas le test, sauf sélecteur erroné vérifié à la main).

- [ ] **Step 5 : suite complète + commit**

Run : `pnpm typecheck && pnpm test:e2e` → tout vert.
```bash
git add tests/e2e/07-share.spec.ts tests/e2e/helpers.ts tests/e2e/06-mail.spec.ts playwright.config.ts .gitignore
git commit -m "test(e2e): partage par lien et co-édition à deux navigateurs"
```

---

### Task 11 : carte du code et mise en prod

**Files :**
- Modify : `.claude/.codebase-info/communication.md`, `architecture.md`, `patterns.md` (via la skill `codebase-mapper:update-codebase-map`)

- [ ] **Step 1 : carte**

Invoquer `codebase-mapper:update-codebase-map` : nouveau canal WebSocket `/collab`, API `/api/share/*` v2, entrée `share.html`, `password.mjs` partagé, et correction de `patterns.md` (le zod IPC ne s'exécute pas sur `entities.*` côté worker : aucune clé retirée à l'exécution, seul `FieldValueSchema` contraint au typage).

- [ ] **Step 2 : vérifier la prod après accord explicite d'Amaury pour déployer**

Avant : `git log --oneline scalingo/main..HEAD` (tout ce qui part). Poser `SHARE_SECRET` : `scalingo --app supernote env-set SHARE_SECRET=$(openssl rand -hex 32)`. Déployer : `git push scalingo main`, puis `scalingo --app supernote deployments`.
Fumée prod : `curl -s https://supernote.osc-fr1.scalingo.io/api/share/_info` → `{"enabled":true}` ; créer une note partagée depuis l'app et ouvrir le lien sur un téléphone : curseurs visibles des deux côtés (WebSocket traversant le routeur Scalingo).

- [ ] **Step 3 : commit de la carte**

```bash
git add .claude/.codebase-info
git commit -m "docs(map): partage par lien, serveur Yjs /collab, entrée invitée"
```
