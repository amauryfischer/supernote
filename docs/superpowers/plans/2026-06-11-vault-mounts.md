# Montages de vaults (« vault-ception ») — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connecter d'autres vaults cloud (clé de salon) comme sous-dossiers spéciaux dans le vault courant, avec fusion bidirectionnelle des entités (contacts, habitudes, todos, bases) et résolution récursive gardée contre les boucles.

**Architecture:** Une colonne de provenance `sourceVaultId` (locale, jamais transportée dans l'op-log) marque les entités répliquées depuis un salon monté. Un `MountSyncManager` côté main-thread découvre les entités `vault_mount`, résout récursivement (gardes visited/profondeur/budget), et fait tourner un `OnlineSyncClient` par salon monté qui écrit dans la DB du père via `sync.applyOps` (préfixe de chemin `@mounts/<slug>/`, jamais de fichier). Le routage des écritures locales vers le bon salon se fait par la provenance portée sur `ENTITY_CHANGE`. Invariant central : **une entité de provenance X ne part jamais vers un salon ≠ X.**

**Tech Stack:** TypeScript strict, sql.js/sqlite-wasm (worker), tRPC + zod (`packages/ipc`), React + HeroUI v3, vitest. Réutilise `OnlineSyncClient` (`apps/web/src/lib/online-sync/client.ts`) et `cloudVaultId` (`config-storage.ts`).

**Spec source:** `docs/superpowers/specs/2026-06-11-vault-mounts-design.md`

**Commande de test:** `pnpm --filter @supernote/web test -- <chemin>` (vitest run). Typecheck: `pnpm typecheck` (depuis la racine).

---

## Phase 1 — Fondations : room-id partagé, colonne de provenance, gardes worker

### Task 1 : Extraire `cloudRoomSlug` / `cloudVaultId` dans un module partagé

**Files:**
- Create: `apps/web/src/lib/online-sync/room-id.ts`
- Create: `apps/web/src/lib/online-sync/room-id.test.ts`
- Modify: `apps/web/src/lib/online-sync/config-storage.ts` (déplacer `cloudVaultId`/`normalizeServerUrl`, ré-exporter)
- Modify: `apps/web/src/lib/pwa/PwaVaultSetup.tsx` (importer `cloudRoomSlug` du nouveau module, supprimer la copie locale)

- [ ] **Step 1: Test qui échoue**

```ts
// apps/web/src/lib/online-sync/room-id.test.ts
import { describe, it, expect } from "vitest";
import { cloudVaultId, cloudRoomSlug, MOUNT_PATH_PREFIX } from "./room-id";

describe("room-id", () => {
  it("cloudVaultId normalise serveur + clé (casse, trailing slash)", () => {
    expect(cloudVaultId("https://x.com/", "Amaury")).toBe("cloud:https://x.com|amaury");
    expect(cloudVaultId("", "  Salon B ")).toBe("cloud:|salon b");
  });

  it("cloudRoomSlug est déterministe et sans caractères de chemin interdits", () => {
    const a = cloudRoomSlug("cloud:|amaury");
    expect(a).toBe(cloudRoomSlug("cloud:|amaury"));
    expect(a).not.toMatch(/[^a-zA-Z0-9._-]/);
  });

  it("cloudRoomSlug évite les collisions après sanitation", () => {
    expect(cloudRoomSlug("cloud:|a/b")).not.toBe(cloudRoomSlug("cloud:|a-b"));
  });

  it("MOUNT_PATH_PREFIX construit/déconstruit un chemin monté", () => {
    const slug = cloudRoomSlug("cloud:|amaury");
    const p = `${MOUNT_PATH_PREFIX}/${slug}/Notes/contact.md`;
    expect(p.startsWith(`${MOUNT_PATH_PREFIX}/`)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — échoue (module absent)**

Run: `pnpm --filter @supernote/web test -- src/lib/online-sync/room-id.test.ts`
Expected: FAIL `Cannot find module './room-id'`.

- [ ] **Step 3: Implémentation**

```ts
// apps/web/src/lib/online-sync/room-id.ts
/**
 * Identité canonique d'un salon cloud + slug de répertoire OPFS, partagés
 * entre le boot du coffre cloud (PwaVaultSetup) et le moteur de montage.
 */

/** Préfixe de chemin virtuel des entités montées dans le vault père. */
export const MOUNT_PATH_PREFIX = "@mounts";

/** Serveur canonique : trim, sans slash final. */
export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Clé de salon canonique : trim + minuscules (cf. normalizeVaultKey). */
export function normalizeVaultKey(key: string): string {
  return key.trim().toLowerCase();
}

/** Identité stable d'un salon : `cloud:<server>|<key>`. */
export function cloudVaultId(serverUrl: string, vaultKey: string): string {
  return `cloud:${normalizeServerUrl(serverUrl)}|${normalizeVaultKey(vaultKey)}`;
}

/** Nom de dossier OPFS déterministe et sûr pour un id de salon. */
export function cloudRoomSlug(cloudId: string): string {
  let h = 5381;
  for (let i = 0; i < cloudId.length; i++) {
    h = ((h << 5) + h + cloudId.charCodeAt(i)) >>> 0;
  }
  const readable = cloudId
    .replace(/^cloud:/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 40);
  return `${readable || "room"}-${h.toString(36)}`;
}

/** Préfixe un chemin d'entité par son salon de provenance. */
export function prefixMountPath(cloudId: string, filePath: string): string {
  return `${MOUNT_PATH_PREFIX}/${cloudRoomSlug(cloudId)}/${filePath}`;
}

/** Retire le préfixe `@mounts/<slug>/` ; renvoie le chemin d'origine ou null. */
export function stripMountPath(cloudId: string, filePath: string): string | null {
  const pfx = `${MOUNT_PATH_PREFIX}/${cloudRoomSlug(cloudId)}/`;
  return filePath.startsWith(pfx) ? filePath.slice(pfx.length) : null;
}
```

- [ ] **Step 4: Run — passe**

Run: `pnpm --filter @supernote/web test -- src/lib/online-sync/room-id.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Rebrancher config-storage + PwaVaultSetup sur le module**

Dans `config-storage.ts` : supprimer les définitions locales de `normalizeServerUrl`, `normalizeVaultKey`, `cloudVaultId` et les ré-exporter depuis `./room-id` :

```ts
// config-storage.ts — remplacer les définitions par :
export { normalizeServerUrl, normalizeVaultKey, cloudVaultId } from "./room-id";
```

Dans `PwaVaultSetup.tsx` : remplacer la fonction locale `cloudRoomSlug` par un import `import { cloudRoomSlug } from "@/lib/online-sync/room-id";` et supprimer la définition locale.

- [ ] **Step 6: Run typecheck + tests sync**

Run: `pnpm typecheck && pnpm --filter @supernote/web test -- src/lib/online-sync`
Expected: typecheck OK, tous les tests online-sync PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/online-sync/room-id.ts apps/web/src/lib/online-sync/room-id.test.ts apps/web/src/lib/online-sync/config-storage.ts apps/web/src/lib/pwa/PwaVaultSetup.tsx
git commit -m "refactor(sync): module room-id partagé (slug/cloudVaultId/prefix mount)"
```

---

### Task 2 : Colonne `sourceVaultId` + index (migration worker idempotente)

**Files:**
- Modify: `apps/web/src/lib/vault-worker/db-schema.ts` (colonne dans `SCHEMA_SQL_BASE` entity + index)
- Modify: `apps/web/src/lib/vault-worker/worker.ts:165-187` (ajouter une migration ALTER TABLE pour les DB existantes)

- [ ] **Step 1: Ajouter la colonne au schéma de base**

Dans `db-schema.ts`, table `entity` (après `"lastEditedBy" TEXT,` ligne ~59) :

```sql
    "lastEditedBy" TEXT,
    "sourceVaultId" TEXT,
```

Et après le bloc `CREATE TABLE ... entity (...)`, ajouter dans la section index de `SCHEMA_SQL_BASE` :

```sql
CREATE INDEX IF NOT EXISTS "idx_entity_source" ON "entity" ("sourceVaultId");
```

- [ ] **Step 2: Migration ALTER pour les DB déjà créées**

Dans `worker.ts`, juste après le bloc de migration des colonnes `view` (après ligne ~187, avant `database.run(SCHEMA_SQL)` ligne ~190) :

```ts
  // Migration : ajoute entity.sourceVaultId (provenance des entités montées)
  // aux DB créées avant la feature « montages de vaults ». Idempotent.
  try {
    const cols = database.exec(`PRAGMA table_info("entity")`);
    const names: string[] =
      cols.length > 0 ? cols[0]!.values.map((row) => row[1] as string) : [];
    if (!names.includes("sourceVaultId")) {
      database.run(`ALTER TABLE "entity" ADD COLUMN "sourceVaultId" TEXT;`);
    }
  } catch (e) {
    console.warn("[vault-worker] entity.sourceVaultId migration failed (non-fatal)", e);
  }
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: OK (pas de changement de type public).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/vault-worker/db-schema.ts apps/web/src/lib/vault-worker/worker.ts
git commit -m "feat(sync): colonne entity.sourceVaultId + migration idempotente"
```

---

### Task 3 : Helpers worker purs pour la provenance (testables en isolation)

**Files:**
- Create: `apps/web/src/lib/vault-worker/mount-provenance.ts`
- Create: `apps/web/src/lib/vault-worker/mount-provenance.test.ts`

Ces helpers encapsulent la logique testable que `syncApplyOps` câblera ensuite : décider provenance/préfixe selon le contexte d'appel, et la garde de collision cross-provenance.

- [ ] **Step 1: Test qui échoue**

```ts
// apps/web/src/lib/vault-worker/mount-provenance.test.ts
import { describe, it, expect } from "vitest";
import {
  resolveMountWrite,
  crossProvenanceCollision,
} from "./mount-provenance";

describe("mount-provenance", () => {
  it("applyOps natif (pas de sourceVaultId) : pas de préfixe, provenance null", () => {
    const r = resolveMountWrite("Notes/a.md", undefined);
    expect(r).toEqual({ filePath: "Notes/a.md", sourceVaultId: null });
  });

  it("applyOps monté : préfixe @mounts/<slug>/ + provenance posée", () => {
    const r = resolveMountWrite("Notes/a.md", "cloud:|amaury");
    expect(r.sourceVaultId).toBe("cloud:|amaury");
    expect(r.filePath).toMatch(/^@mounts\/.+\/Notes\/a\.md$/);
  });

  it("collision cross-provenance détectée (id existant d'une autre source)", () => {
    expect(crossProvenanceCollision({ existingSource: null }, "cloud:|amaury")).toBe(true);
    expect(crossProvenanceCollision({ existingSource: "cloud:|b" }, "cloud:|amaury")).toBe(true);
  });

  it("même provenance : pas de collision (mise à jour normale)", () => {
    expect(crossProvenanceCollision({ existingSource: "cloud:|amaury" }, "cloud:|amaury")).toBe(false);
    expect(crossProvenanceCollision({ existingSource: null }, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — échoue**

Run: `pnpm --filter @supernote/web test -- src/lib/vault-worker/mount-provenance.test.ts`
Expected: FAIL `Cannot find module './mount-provenance'`.

- [ ] **Step 3: Implémentation**

```ts
// apps/web/src/lib/vault-worker/mount-provenance.ts
/**
 * Logique pure de provenance pour `sync.applyOps`. Garde l'invariant :
 * une entité d'une provenance ne peut jamais écraser une entité d'une autre
 * provenance (y compris native = null).
 */
import { prefixMountPath } from "@/lib/online-sync/room-id";

export interface MountWrite {
  /** Chemin à stocker en DB (préfixé si l'op vient d'un salon monté). */
  filePath: string;
  /** Provenance à poser sur la ligne (null = native du père). */
  sourceVaultId: string | null;
}

/**
 * Décide le chemin stocké + la provenance d'une op `applyOps`.
 * `sourceVaultId` undefined/null = client du père (entité native).
 */
export function resolveMountWrite(
  filePath: string,
  sourceVaultId: string | null | undefined,
): MountWrite {
  if (!sourceVaultId) return { filePath, sourceVaultId: null };
  return { filePath: prefixMountPath(sourceVaultId, filePath), sourceVaultId };
}

/**
 * Vrai si une op de provenance `incoming` tente d'écrire sur un id déjà
 * détenu par une AUTRE provenance — on skippe alors plutôt que d'écraser.
 */
export function crossProvenanceCollision(
  existing: { existingSource: string | null },
  incoming: string | null,
): boolean {
  return existing.existingSource !== incoming;
}
```

- [ ] **Step 4: Run — passe**

Run: `pnpm --filter @supernote/web test -- src/lib/vault-worker/mount-provenance.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/vault-worker/mount-provenance.ts apps/web/src/lib/vault-worker/mount-provenance.test.ts
git commit -m "feat(sync): helpers purs de provenance (préfixe + garde cross-provenance)"
```

---

### Task 4 : Câbler les gardes dans le worker-router (snapshot, applyOps, sweep)

**Files:**
- Modify: `apps/web/src/lib/vault-worker/worker-router.ts` (syncSnapshot ~3331, syncApplyOps ~3366-3499, sweep ~3020, dispatch ~3570 + nouvelle proc `syncPurgeMounted`)

- [ ] **Step 1: syncSnapshot — exclure les entités montées**

Ligne ~3331, ajouter la clause WHERE :

```ts
        WHERE e.vaultId = ? AND e.sourceVaultId IS NULL`,
```

- [ ] **Step 2: sweep phantom — ignorer les entités montées (sans fichier)**

Ligne ~3020, restreindre la sélection du sweep :

```ts
      const allRowsForSweep = rows(
        db.exec(
          `SELECT id, filePath, fields FROM entity WHERE vaultId = ? AND sourceVaultId IS NULL`,
          [vaultId],
        ),
      );
```

- [ ] **Step 3: syncApplyOps — accepter `sourceVaultId`, préfixer, ne pas écrire de fichier, garder l'invariant**

En tête de `syncApplyOps` (ligne ~3367), lire le champ optionnel :

```ts
  const syncApplyOps = async (input: unknown): Promise<unknown> => {
    const { ops, sourceVaultId } = (input as {
      ops?: SyncOp[];
      sourceVaultId?: string;
    }) ?? {};
    const provenance = sourceVaultId ?? null;
```

Importer les helpers en tête de fichier :

```ts
import { resolveMountWrite, crossProvenanceCollision } from "./mount-provenance";
```

Remplacer la lecture `existing` (ligne ~3372) pour inclure la provenance :

```ts
        const existing = row(db.exec(
          `SELECT id, filePath, updatedAt, sourceVaultId FROM entity WHERE id = ?`,
          [op.entityId],
        ));
```

Après le calcul LWW et AVANT le `pathOwner` (vers ligne ~3417), ajouter la garde cross-provenance :

```ts
        if (
          existing &&
          crossProvenanceCollision(
            { existingSource: (existing["sourceVaultId"] as string | null) ?? null },
            provenance,
          )
        ) {
          console.warn(
            `[sync.applyOps] skip ${op.entityId}: cross-provenance (local=${existing["sourceVaultId"]}, op=${provenance})`,
          );
          skipped++;
          continue;
        }
```

Calculer le chemin stocké à partir de la provenance (remplacer l'usage direct de `payload.filePath` pour le stockage). Juste avant le bloc `if (isMarkdownPath(...))` (ligne ~3439) :

```ts
        const { filePath: storedPath } = resolveMountWrite(payload.filePath, provenance);
```

Le `pathOwner` (collision unique vaultId+filePath) doit utiliser `storedPath` :

```ts
        const pathOwner = row(db.exec(
          `SELECT id FROM entity WHERE vaultId = ? AND filePath = ? LIMIT 1`,
          [vaultId, storedPath],
        ));
```

Écriture fichier UNIQUEMENT pour les entités natives (provenance null) :

```ts
        if (provenance === null && isMarkdownPath(payload.filePath)) {
          const frontmatter: Record<string, unknown> = {
            id: op.entityId,
            type: typeRow["name"],
            ...fields,
          };
          const content = serializeFrontmatter(frontmatter, payload.body ?? "");
          await writeVaultFile(vaultHandle, payload.filePath.split("/"), content);
          hash = await hashContent(content);
        }
```

Création de type à la volée (remplacer le `skip` du type inconnu, ligne ~3411). Au lieu de skipper, créer un type minimal non-système :

```ts
        let typeRow = row(db.exec(`SELECT name FROM entity_type WHERE id = ?`, [payload.typeId]));
        if (!typeRow) {
          const nowIso = now();
          db.run(
            `INSERT OR IGNORE INTO entity_type (id, vaultId, name, plural, fields, isSystem, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, '[]', 0, ?, ?)`,
            [payload.typeId, vaultId, payload.typeName || payload.typeId,
             payload.typeName || payload.typeId, nowIso, nowIso],
          );
          typeRow = { name: payload.typeName || payload.typeId };
        }
```

Les deux branches INSERT/UPDATE de l'entité doivent stocker `storedPath` ET `sourceVaultId`. UPDATE (ligne ~3451) :

```ts
          db.run(
            `UPDATE entity SET typeId = ?, filePath = ?, fields = ?, body = ?, fileHash = ?, sourceVaultId = ?, createdAt = ?, updatedAt = ? WHERE id = ?`,
            [payload.typeId, storedPath, JSON.stringify(fields), payload.body ?? "",
             hash, provenance, payload.createdAt, payload.updatedAt, op.entityId],
          );
```

INSERT (ligne ~3465) :

```ts
          db.run(
            `INSERT INTO entity (id, vaultId, typeId, filePath, fields, body, fileHash, sourceVaultId, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [op.entityId, vaultId, payload.typeId, storedPath, JSON.stringify(fields),
             payload.body ?? "", hash, provenance, payload.createdAt, payload.updatedAt],
          );
```

Le `ftsAdd` (ligne ~3484) utilise `storedPath` pour le champ `path` :

```ts
          path: derivePath(storedPath),
```

- [ ] **Step 4: Nouvelle procédure `syncPurgeMounted` + dispatch**

Après `syncApplyOps` (vers ligne ~3500), ajouter :

```ts
  /** Supprime toutes les entités d'une provenance donnée (démontage). */
  const syncPurgeMounted = async (input: unknown): Promise<unknown> => {
    const { sourceVaultId } = (input as { sourceVaultId?: string }) ?? {};
    if (!sourceVaultId) return { removed: 0 };
    const victims = rows(db.exec(
      `SELECT id FROM entity WHERE vaultId = ? AND sourceVaultId = ?`,
      [vaultId, sourceVaultId],
    ));
    for (const v of victims) {
      const id = v["id"] as string;
      db.run(`DELETE FROM entity WHERE id = ?`, [id]);
      ftsRemove(db, id);
    }
    return { removed: victims.length };
  };
```

Dans la table de dispatch (vers ligne ~3570, à côté de `syncApplyOps`) :

```ts
    syncPurgeMounted,
```

Et l'entrée de routage tRPC correspondante (cherche comment `sync.applyOps` est mappé dans ce fichier ; ajouter `"sync.purgeMounted": syncPurgeMounted` au même endroit que `"sync.applyOps": syncApplyOps`).

- [ ] **Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/vault-worker/worker-router.ts
git commit -m "feat(sync): gardes provenance worker (snapshot/sweep/applyOps/purgeMounted)"
```

---

## Phase 2 — Contrat IPC

### Task 5 : Étendre le schéma sync (applyOps + purgeMounted)

**Files:**
- Modify: `apps/web/src/../packages/ipc/src/schemas/sync.ts`
- Modify: `packages/ipc/src/router/sync.router.ts`

- [ ] **Step 1: Étendre `ApplyOpsInput` + ajouter `PurgeMountedInput/Output`**

Dans `packages/ipc/src/schemas/sync.ts`, remplacer `ApplyOpsInput` (ligne ~40) et ajouter en fin de fichier :

```ts
export const ApplyOpsInput = z.object({
  ops: z.array(EntityOpSchema),
  /** Provenance : présent quand l'appel vient d'un salon monté. */
  sourceVaultId: z.string().optional(),
});
export type ApplyOpsInput = z.infer<typeof ApplyOpsInput>;

// ── sync.purgeMounted ──────────────────────────────────────────────────────────

export const PurgeMountedInput = z.object({ sourceVaultId: z.string() });
export type PurgeMountedInput = z.infer<typeof PurgeMountedInput>;

export const PurgeMountedOutput = z.object({
  removed: z.number().int().nonnegative(),
});
export type PurgeMountedOutput = z.infer<typeof PurgeMountedOutput>;
```

- [ ] **Step 2: Ajouter la procédure au routeur**

Dans `packages/ipc/src/router/sync.router.ts`, après `applyOps` :

```ts
  purgeMounted: publicProcedure
    .input(PurgeMountedInput)
    .output(PurgeMountedOutput)
    .mutation(() => {
      throw notImplemented("sync.purgeMounted");
    }),
```

Mettre à jour les imports zod du fichier (`PurgeMountedInput`, `PurgeMountedOutput`).

- [ ] **Step 3: Run typecheck (build ipc)**

Run: `pnpm typecheck`
Expected: OK. Si `packages/ipc` a un build séparé, lancer `pnpm --filter @supernote/ipc build`.

- [ ] **Step 4: Commit**

```bash
git add packages/ipc/src/schemas/sync.ts packages/ipc/src/router/sync.router.ts
git commit -m "feat(ipc): applyOps.sourceVaultId + sync.purgeMounted"
```

---

### Task 6 : Porter `sourceVaultId` sur `ENTITY_CHANGE`

**Files:**
- Modify: `apps/web/src/lib/vault-worker/worker.ts:316-364` (emitEntityChange signe la provenance)
- Modify: `apps/web/src/lib/vault-worker/worker.ts:919-943` (les hooks passent la provenance lue sur la ligne)

- [ ] **Step 1: emitEntityChange porte la provenance au niveau message**

Modifier la signature et le `postMessage` (deux branches) pour inclure `sourceVaultId` AU NIVEAU DU MESSAGE (pas dans l'EntityOp, qui reste figé) :

```ts
function emitEntityChange(
  kind: "upsert" | "delete",
  entity: unknown,
  entityId?: string,
  sourceVaultId: string | null = null,
): void {
  try {
    const ts = Date.now();
    if (kind === "delete") {
      if (!entityId) return;
      self.postMessage({
        type: "ENTITY_CHANGE",
        sourceVaultId,
        op: { opId: genOpId(), clientId: "", kind: "delete", entityId, ts },
      });
      return;
    }
    // ... (corps inchangé) ...
    self.postMessage({
      type: "ENTITY_CHANGE",
      sourceVaultId,
      op: { /* inchangé */ },
    });
  } catch (err) {
    console.warn("[sync] emitEntityChange failed", err);
  }
}
```

- [ ] **Step 2: Les hooks lisent et propagent la provenance**

Aux trois sites (lignes ~926, ~935, ~942), passer la provenance de l'entité mutée. Les hooks `onEntityCreated/Updated/Deleted` reçoivent l'entité ; lire `entity.sourceVaultId` (déjà sélectionnée par la requête de chargement de l'entité — vérifier que la requête SELECT du hook inclut bien `sourceVaultId`, sinon l'ajouter). Exemple pour upsert :

```ts
      emitEntityChange("upsert", entity, undefined,
        (entity as { sourceVaultId?: string | null }).sourceVaultId ?? null);
```

Pour delete (l'entité n'existe plus) : lire la provenance AVANT suppression et la passer :

```ts
      emitEntityChange("delete", null, id, deletedSourceVaultId);
```

(où `deletedSourceVaultId` est lu juste avant le `DELETE`).

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/vault-worker/worker.ts
git commit -m "feat(sync): ENTITY_CHANGE porte sourceVaultId pour le routage"
```

---

## Phase 3 — Type système `vault_mount`

### Task 7 : Seeder le type `vault_mount`

**Files:**
- Modify: `apps/web/src/lib/vault-worker/seed-default-types.ts:305-379`

- [ ] **Step 1: Ajouter le type aux défauts**

Dans `DEFAULT_ENTITY_TYPES` (ligne ~305), ajouter une entrée. Respecter la shape existante des autres entrées (lire une entrée voisine, ex. `routine`, pour copier exactement la forme : `id`, `name`, `plural`, `icon`, `fields`, etc.) :

```ts
  {
    id: "vault_mount",
    name: "vault_mount",
    plural: "vault_mounts",
    icon: "Plugs",
    color: "#8b5cf6",
    fields: [
      { id: "serverUrl", name: "serverUrl", type: "text" },
      { id: "vaultKey", name: "vaultKey", type: "text" },
      { id: "token", name: "token", type: "text" },
      { id: "label", name: "label", type: "text" },
    ],
  },
```

(Adapter la forme exacte de `fields` à celle utilisée par les autres types système du fichier — lire avant d'écrire.)

- [ ] **Step 2: Run typecheck + tests worker existants**

Run: `pnpm typecheck && pnpm --filter @supernote/web test -- src/lib/vault-worker`
Expected: OK.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/vault-worker/seed-default-types.ts
git commit -m "feat(sync): type système vault_mount"
```

---

## Phase 4 — Moteur de montage (résolution + sync)

### Task 8 : Résolution transitive gardée (pur, testable)

**Files:**
- Create: `apps/web/src/lib/online-sync/mounts/resolve-mounts.ts`
- Create: `apps/web/src/lib/online-sync/mounts/resolve-mounts.test.ts`

- [ ] **Step 1: Test qui échoue**

```ts
// apps/web/src/lib/online-sync/mounts/resolve-mounts.test.ts
import { describe, it, expect } from "vitest";
import { resolveMounts, type MountNode } from "./resolve-mounts";

// fetcher mock : id de salon → liste des montages déclarés dans ce salon
function fetcherFrom(graph: Record<string, MountNode[]>) {
  return async (cloudId: string): Promise<MountNode[]> => graph[cloudId] ?? [];
}

const M = (serverUrl: string, vaultKey: string, label = vaultKey): MountNode => ({
  serverUrl, vaultKey, token: "", label,
});

describe("resolveMounts", () => {
  it("résout un montage direct", async () => {
    const r = await resolveMounts([M("", "b")], { fetch: fetcherFrom({}), selfId: "cloud:|a" });
    expect(r.map((m) => m.cloudId)).toEqual(["cloud:|b"]);
  });

  it("résout récursivement (A→B→C)", async () => {
    const r = await resolveMounts([M("", "b")], {
      fetch: fetcherFrom({ "cloud:|b": [M("", "c")] }), selfId: "cloud:|a",
    });
    expect(r.map((m) => m.cloudId).sort()).toEqual(["cloud:|b", "cloud:|c"]);
  });

  it("coupe les boucles A→B→A", async () => {
    const r = await resolveMounts([M("", "b")], {
      fetch: fetcherFrom({ "cloud:|b": [M("", "a")] }), selfId: "cloud:|a",
    });
    expect(r.map((m) => m.cloudId)).toEqual(["cloud:|b"]);
  });

  it("dédoublonne un diamant A→B→D + A→C→D", async () => {
    const r = await resolveMounts([M("", "b"), M("", "c")], {
      fetch: fetcherFrom({ "cloud:|b": [M("", "d")], "cloud:|c": [M("", "d")] }),
      selfId: "cloud:|a",
    });
    expect(r.map((m) => m.cloudId).sort()).toEqual(["cloud:|b", "cloud:|c", "cloud:|d"]);
  });

  it("skip le salon du père lui-même", async () => {
    const r = await resolveMounts([M("", "a")], { fetch: fetcherFrom({}), selfId: "cloud:|a" });
    expect(r).toEqual([]);
  });

  it("borne la profondeur à 4", async () => {
    const chain: Record<string, MountNode[]> = {
      "cloud:|1": [M("", "2")], "cloud:|2": [M("", "3")],
      "cloud:|3": [M("", "4")], "cloud:|4": [M("", "5")],
      "cloud:|5": [M("", "6")],
    };
    const r = await resolveMounts([M("", "1")], { fetch: fetcherFrom(chain), selfId: "cloud:|a" });
    expect(r.map((m) => m.cloudId)).not.toContain("cloud:|6");
  });

  it("borne le nombre de montages à 16", async () => {
    const many = Array.from({ length: 20 }, (_, i) => M("", `m${i}`));
    const r = await resolveMounts(many, { fetch: fetcherFrom({}), selfId: "cloud:|a" });
    expect(r.length).toBeLessThanOrEqual(16);
  });
});
```

- [ ] **Step 2: Run — échoue**

Run: `pnpm --filter @supernote/web test -- src/lib/online-sync/mounts/resolve-mounts.test.ts`
Expected: FAIL `Cannot find module './resolve-mounts'`.

- [ ] **Step 3: Implémentation**

```ts
// apps/web/src/lib/online-sync/mounts/resolve-mounts.ts
import { cloudVaultId } from "../room-id";

export interface MountNode {
  serverUrl: string;
  vaultKey: string;
  token: string;
  label: string;
}

export interface ResolvedMount extends MountNode {
  cloudId: string;
}

export interface ResolveOptions {
  /** Renvoie les montages déclarés DANS un salon donné (pour la récursion). */
  fetch: (cloudId: string) => Promise<MountNode[]>;
  /** Salon du père (si le père est lui-même cloud) — jamais re-monté. */
  selfId: string | null;
  maxDepth?: number;
  maxMounts?: number;
}

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_MOUNTS = 16;

/**
 * Résout l'ensemble transitif des salons à monter à partir des montages
 * directs du père. Gardes : visited (boucles + diamants), profondeur,
 * skip-self, budget de montages.
 */
export async function resolveMounts(
  direct: MountNode[],
  opts: ResolveOptions,
): Promise<ResolvedMount[]> {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxMounts = opts.maxMounts ?? DEFAULT_MAX_MOUNTS;
  const visited = new Set<string>();
  if (opts.selfId) visited.add(opts.selfId);
  const out: ResolvedMount[] = [];

  type Frame = { node: MountNode; depth: number };
  const queue: Frame[] = direct.map((node) => ({ node, depth: 1 }));

  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    const cloudId = cloudVaultId(node.serverUrl, node.vaultKey);
    if (visited.has(cloudId)) continue;
    visited.add(cloudId);
    if (out.length >= maxMounts) {
      console.warn(`[mounts] budget de ${maxMounts} montages atteint — ${cloudId} ignoré`);
      continue;
    }
    out.push({ ...node, cloudId });
    if (depth >= maxDepth) continue;
    let children: MountNode[] = [];
    try {
      children = await opts.fetch(cloudId);
    } catch (err) {
      console.warn(`[mounts] résolution récursive échouée pour ${cloudId}`, err);
    }
    for (const child of children) queue.push({ node: child, depth: depth + 1 });
  }
  return out;
}
```

- [ ] **Step 4: Run — passe**

Run: `pnpm --filter @supernote/web test -- src/lib/online-sync/mounts/resolve-mounts.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/online-sync/mounts/resolve-mounts.ts apps/web/src/lib/online-sync/mounts/resolve-mounts.test.ts
git commit -m "feat(mounts): résolution transitive gardée (boucles/profondeur/budget)"
```

---

### Task 9 : Curseurs de montage (localStorage, par père×montage)

**Files:**
- Create: `apps/web/src/lib/online-sync/mounts/mount-cursors.ts`
- Create: `apps/web/src/lib/online-sync/mounts/mount-cursors.test.ts`

- [ ] **Step 1: Test qui échoue**

```ts
// apps/web/src/lib/online-sync/mounts/mount-cursors.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { loadMountCursor, saveMountCursor } from "./mount-cursors";

beforeEach(() => localStorage.clear());

describe("mount-cursors", () => {
  it("défaut = seq 0, epoch vide", () => {
    expect(loadMountCursor("parent1", "cloud:|b")).toEqual({ lastSeq: 0, epoch: "" });
  });

  it("persiste par (parent, montage)", () => {
    saveMountCursor("parent1", "cloud:|b", { lastSeq: 12, epoch: "e1" });
    expect(loadMountCursor("parent1", "cloud:|b")).toEqual({ lastSeq: 12, epoch: "e1" });
    // parent différent → isolé
    expect(loadMountCursor("parent2", "cloud:|b")).toEqual({ lastSeq: 0, epoch: "" });
  });
});
```

- [ ] **Step 2: Run — échoue**

Run: `pnpm --filter @supernote/web test -- src/lib/online-sync/mounts/mount-cursors.test.ts`
Expected: FAIL module absent.

- [ ] **Step 3: Implémentation**

```ts
// apps/web/src/lib/online-sync/mounts/mount-cursors.ts
export interface MountCursor {
  lastSeq: number;
  epoch: string;
}

const DEFAULT: MountCursor = { lastSeq: 0, epoch: "" };

function key(parentVaultId: string, mountId: string): string {
  return `supernote.onlineSync.mountCursors.${parentVaultId}.${mountId}`;
}

export function loadMountCursor(parentVaultId: string, mountId: string): MountCursor {
  if (typeof localStorage === "undefined") return { ...DEFAULT };
  try {
    const raw = localStorage.getItem(key(parentVaultId, mountId));
    if (!raw) return { ...DEFAULT };
    const p = JSON.parse(raw) as Partial<MountCursor>;
    return {
      lastSeq: typeof p.lastSeq === "number" ? p.lastSeq : 0,
      epoch: typeof p.epoch === "string" ? p.epoch : "",
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveMountCursor(parentVaultId: string, mountId: string, cursor: MountCursor): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key(parentVaultId, mountId), JSON.stringify(cursor));
  } catch {
    /* quota — non fatal */
  }
}

export function clearMountCursor(parentVaultId: string, mountId: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key(parentVaultId, mountId));
  } catch {
    /* non fatal */
  }
}
```

- [ ] **Step 4: Run — passe**

Run: `pnpm --filter @supernote/web test -- src/lib/online-sync/mounts/mount-cursors.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/online-sync/mounts/mount-cursors.ts apps/web/src/lib/online-sync/mounts/mount-cursors.test.ts
git commit -m "feat(mounts): curseurs de montage persistés par père×montage"
```

---

### Task 10 : MountSyncManager (un client par montage, routage, démontage)

**Files:**
- Create: `apps/web/src/lib/online-sync/mounts/MountSyncManager.ts`
- Create: `apps/web/src/lib/online-sync/mounts/MountSyncManager.test.ts`

Le manager est une classe transport-agnostique : on lui injecte `applyOps`, `purgeMounted`, `getDirectMounts`, et une fabrique de clients (pour mocker en test). Logique testable : démarrage → un client par montage résolu ; routage d'un `ENTITY_CHANGE` par provenance (dé-préfixage) ; démontage → stop + purge.

- [ ] **Step 1: Test qui échoue**

```ts
// apps/web/src/lib/online-sync/mounts/MountSyncManager.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MountSyncManager } from "./MountSyncManager";
import type { MountNode } from "./resolve-mounts";

beforeEach(() => localStorage.clear());

const M = (vaultKey: string): MountNode => ({ serverUrl: "", vaultKey, token: "", label: vaultKey });

function makeDeps(direct: MountNode[]) {
  const started: string[] = [];
  const stopped: string[] = [];
  const pushed: Array<{ mountId: string; filePath: string }> = [];
  const purged: string[] = [];
  return {
    started, stopped, pushed, purged,
    deps: {
      parentVaultId: "parent1",
      selfId: null as string | null,
      getDirectMounts: async () => direct,
      getMountsIn: async () => [] as MountNode[],
      applyOps: vi.fn(async () => {}),
      purgeMounted: async (sourceVaultId: string) => { purged.push(sourceVaultId); },
      makeClient: (cloudId: string) => ({
        start: async () => { started.push(cloudId); },
        stop: () => { stopped.push(cloudId); },
        enqueue: (ops: Array<{ filePath: string }>) =>
          ops.forEach((o) => pushed.push({ mountId: cloudId, filePath: o.filePath })),
      }),
    },
  };
}

describe("MountSyncManager", () => {
  it("démarre un client par montage résolu", async () => {
    const { started, deps } = makeDeps([M("b"), M("c")]);
    const mgr = new MountSyncManager(deps);
    await mgr.start();
    expect(started.sort()).toEqual(["cloud:|b", "cloud:|c"]);
  });

  it("route un ENTITY_CHANGE vers le client de sa provenance, dé-préfixé", async () => {
    const { pushed, deps } = makeDeps([M("b")]);
    const mgr = new MountSyncManager(deps);
    await mgr.start();
    const { prefixMountPath } = await import("../room-id");
    mgr.onEntityChange({
      sourceVaultId: "cloud:|b",
      op: { opId: "1", clientId: "", kind: "upsert", entityId: "x", ts: 1,
            payload: { id: "x", typeId: "note", typeName: "note",
              filePath: prefixMountPath("cloud:|b", "Notes/a.md"),
              fields: {}, body: "", tags: [], createdAt: "", updatedAt: "" } },
    });
    expect(pushed).toEqual([{ mountId: "cloud:|b", filePath: "Notes/a.md" }]);
  });

  it("ignore un ENTITY_CHANGE natif (sourceVaultId null)", async () => {
    const { pushed, deps } = makeDeps([M("b")]);
    const mgr = new MountSyncManager(deps);
    await mgr.start();
    mgr.onEntityChange({
      sourceVaultId: null,
      op: { opId: "1", clientId: "", kind: "upsert", entityId: "x", ts: 1,
            payload: { id: "x", typeId: "note", typeName: "note", filePath: "Notes/a.md",
              fields: {}, body: "", tags: [], createdAt: "", updatedAt: "" } },
    });
    expect(pushed).toEqual([]);
  });

  it("démontage : stop le client retiré + purge sa provenance", async () => {
    const deps0 = makeDeps([M("b"), M("c")]);
    const mgr = new MountSyncManager(deps0.deps);
    await mgr.start();
    // b retiré des montages directs → resync
    deps0.deps.getDirectMounts = async () => [M("c")];
    await mgr.refresh();
    expect(deps0.stopped).toContain("cloud:|b");
    expect(deps0.purged).toContain("cloud:|b");
  });
});
```

- [ ] **Step 2: Run — échoue**

Run: `pnpm --filter @supernote/web test -- src/lib/online-sync/mounts/MountSyncManager.test.ts`
Expected: FAIL module absent.

- [ ] **Step 3: Implémentation**

```ts
// apps/web/src/lib/online-sync/mounts/MountSyncManager.ts
import type { EntityOp } from "@supernote/sync";
import { resolveMounts, type MountNode } from "./resolve-mounts";
import { stripMountPath } from "../room-id";

/** Sous-ensemble du contrat OnlineSyncClient utilisé par un montage. */
export interface MountClient {
  start: () => Promise<void>;
  stop: () => void;
  enqueue: (ops: EntityOp[]) => void;
}

export interface MountSyncDeps {
  parentVaultId: string;
  /** Salon du père si lui-même cloud (jamais re-monté), sinon null. */
  selfId: string | null;
  /** Montages directs déclarés dans le père (entités vault_mount natives). */
  getDirectMounts: () => Promise<MountNode[]>;
  /** Montages déclarés DANS un salon (pour la résolution transitive). */
  getMountsIn: (cloudId: string) => Promise<MountNode[]>;
  /** Applique des ops dans le père sous une provenance. */
  applyOps: (ops: EntityOp[], sourceVaultId: string) => Promise<void>;
  /** Supprime les entités d'une provenance (démontage). */
  purgeMounted: (sourceVaultId: string) => Promise<void>;
  /** Fabrique un client de sync pour un salon monté. */
  makeClient: (cloudId: string, node: MountNode) => MountClient;
}

export class MountSyncManager {
  private readonly deps: MountSyncDeps;
  private clients = new Map<string, MountClient>();

  constructor(deps: MountSyncDeps) {
    this.deps = deps;
  }

  async start(): Promise<void> {
    await this.refresh();
  }

  /** Re-résout les montages et réconcilie les clients (ajout/retrait). */
  async refresh(): Promise<void> {
    const direct = await this.deps.getDirectMounts();
    const resolved = await resolveMounts(direct, {
      fetch: this.deps.getMountsIn,
      selfId: this.deps.selfId,
    });
    const wanted = new Set(resolved.map((m) => m.cloudId));

    // Démonter ce qui n'est plus voulu.
    for (const [cloudId, client] of this.clients) {
      if (!wanted.has(cloudId)) {
        client.stop();
        this.clients.delete(cloudId);
        await this.deps.purgeMounted(cloudId);
      }
    }
    // Monter les nouveaux.
    for (const m of resolved) {
      if (this.clients.has(m.cloudId)) continue;
      const client = this.deps.makeClient(m.cloudId, m);
      this.clients.set(m.cloudId, client);
      await client.start();
    }
  }

  /** Route une mutation locale vers le client de sa provenance. */
  onEntityChange(msg: { sourceVaultId: string | null; op: EntityOp }): void {
    const src = msg.sourceVaultId;
    if (!src) return; // entité native → gérée par le client du père
    const client = this.clients.get(src);
    if (!client) return;
    // Dé-préfixer le filePath avant de pousser vers le salon d'origine.
    const op = msg.op;
    if (op.payload) {
      const bare = stripMountPath(src, op.payload.filePath);
      if (bare !== null) {
        op.payload = { ...op.payload, filePath: bare };
      }
    }
    client.enqueue([op]);
  }

  stop(): void {
    for (const client of this.clients.values()) client.stop();
    this.clients.clear();
  }
}
```

- [ ] **Step 4: Run — passe**

Run: `pnpm --filter @supernote/web test -- src/lib/online-sync/mounts/MountSyncManager.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/online-sync/mounts/MountSyncManager.ts apps/web/src/lib/online-sync/mounts/MountSyncManager.test.ts
git commit -m "feat(mounts): MountSyncManager (clients par salon, routage, démontage)"
```

---

### Task 11 : Provider React qui câble le manager au runtime

**Files:**
- Create: `apps/web/src/lib/online-sync/mounts/MountSyncProvider.tsx`
- Modify: là où `OnlineSyncProvider` est monté dans l'arbre (chercher `<OnlineSyncProvider`), monter `<MountSyncProvider>` à côté/dessous.

- [ ] **Step 1: Implémentation du provider**

```tsx
// apps/web/src/lib/online-sync/mounts/MountSyncProvider.tsx
"use client";

import { useEffect, useRef } from "react";
import type { EntityOp } from "@supernote/sync";
import { useVault } from "@/lib/pwa/PwaVaultSetup";
import { onWorkerMessage } from "@/lib/trpc/browser-link";
import { trpcVanillaClient, isCloudVaultActive } from "@/lib/trpc/client";
import {
  loadOnlineSyncConfig,
  getOrCreateClientId,
} from "../config-storage";
import { cloudVaultId } from "../room-id";
import { OnlineSyncClient } from "../client";
import { loadMountCursor, saveMountCursor, clearMountCursor } from "./mount-cursors";
import { loadPendingOps, savePendingOps } from "../pendingStore";
import { MountSyncManager, type MountClient } from "./MountSyncManager";
import type { MountNode } from "./resolve-mounts";

/** Lit les entités vault_mount d'un vault (le père ou un salon distant). */
async function listMountEntities(): Promise<MountNode[]> {
  try {
    const res = (await trpcVanillaClient.entities.list.query({ type: "vault_mount" })) as {
      entities?: Array<{ fields?: Record<string, unknown> }>;
    };
    return (res.entities ?? []).map((e) => ({
      serverUrl: String(e.fields?.["serverUrl"] ?? ""),
      vaultKey: String(e.fields?.["vaultKey"] ?? ""),
      token: String(e.fields?.["token"] ?? ""),
      label: String(e.fields?.["label"] ?? e.fields?.["vaultKey"] ?? ""),
    })).filter((m) => m.vaultKey);
  } catch {
    return [];
  }
}

export function MountSyncProvider({ children }: { children: React.ReactNode }) {
  const vault = useVault();
  const managerRef = useRef<MountSyncManager | null>(null);

  useEffect(() => {
    managerRef.current?.stop();
    managerRef.current = null;
    if (vault?.state !== "ready") return;

    const parentVaultId = vault.activeVaultId ?? "local";
    const selfId = isCloudVaultActive()
      ? (() => { const c = loadOnlineSyncConfig(); return cloudVaultId(c.serverUrl, c.vaultKey); })()
      : null;
    const clientId = getOrCreateClientId();

    const makeClient = (cloudId: string, node: MountNode): MountClient => {
      const cur = loadMountCursor(parentVaultId, cloudId);
      return new OnlineSyncClient({
        serverUrl: node.serverUrl,
        vaultKey: node.vaultKey,
        token: node.token,
        clientId,
        initialSeq: cur.lastSeq,
        seeded: true, // un montage ne seed JAMAIS son père dans le salon
        epoch: cur.epoch,
        applyOps: async (ops: EntityOp[]) => {
          await trpcVanillaClient.sync.applyOps.mutate({ ops, sourceVaultId: cloudId });
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("supernote:index-progress",
              { detail: { indexed: ops.length, total: ops.length } }));
          }
        },
        getSnapshot: async () => { throw new Error("mount never seeds"); },
        onSeq: (seq) => saveMountCursor(parentVaultId, cloudId,
          { ...loadMountCursor(parentVaultId, cloudId), lastSeq: seq }),
        onSeeded: () => {},
        onEpochChange: (epoch) => saveMountCursor(parentVaultId, cloudId,
          { lastSeq: 0, epoch }),
        pending: {
          load: () => loadPendingOps(`mount.${cloudId}`),
          save: (ops) => savePendingOps(`mount.${cloudId}`, ops),
        },
        onStatus: () => {},
      });
    };

    const manager = new MountSyncManager({
      parentVaultId,
      selfId,
      getDirectMounts: listMountEntities,
      getMountsIn: async () => [], // V1 : récursion via re-découverte au mount (voir note)
      applyOps: async (ops, src) =>
        void (await trpcVanillaClient.sync.applyOps.mutate({ ops, sourceVaultId: src })),
      purgeMounted: async (src) => {
        await trpcVanillaClient.sync.purgeMounted.mutate({ sourceVaultId: src });
        clearMountCursor(parentVaultId, src);
      },
      makeClient,
    });
    managerRef.current = manager;
    void manager.start();

    // Re-résoudre quand un vault_mount change ; router les ENTITY_CHANGE montés.
    const unsub = onWorkerMessage((msg) => {
      if (!msg || typeof msg !== "object") return;
      const m = msg as { type?: string; sourceVaultId?: string | null; op?: EntityOp };
      if (m.type !== "ENTITY_CHANGE" || !m.op) return;
      if (m.op.payload?.typeId === "vault_mount" && m.sourceVaultId == null) {
        void manager.refresh();
        return;
      }
      manager.onEntityChange({ sourceVaultId: m.sourceVaultId ?? null, op: m.op });
    });

    return () => {
      unsub();
      manager.stop();
      managerRef.current = null;
    };
  }, [vault?.state, vault?.activeVaultId]);

  return <>{children}</>;
}
```

> **Note récursion V1 :** `getMountsIn` renvoie `[]` ici parce que les `vault_mount` d'un salon distant sont répliqués DANS le père dès que ce salon est monté (ses entités, dont ses `vault_mount`, arrivent via `applyOps` avec provenance). La re-découverte se fait alors par `manager.refresh()` déclenché sur l'arrivée d'un `vault_mount` (même monté). Adapter `listMountEntities` pour inclure les `vault_mount` montés (provenance ≠ null) si la query `entities.list` les exclut — vérifier le filtre.

- [ ] **Step 2: Monter le provider dans l'arbre**

Chercher `<OnlineSyncProvider>` et envelopper de la même façon (juste à l'intérieur, pour partager le contexte vault) :

```tsx
<OnlineSyncProvider>
  <MountSyncProvider>{children}</MountSyncProvider>
</OnlineSyncProvider>
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: OK. (Si `useVault` n'expose pas `activeVaultId`, lire la shape réelle de `VaultContextValue` et adapter ; `activeVaultId` existe d'après PwaVaultSetup.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/online-sync/mounts/MountSyncProvider.tsx
git commit -m "feat(mounts): MountSyncProvider — câble le manager au runtime vault"
```

---

## Phase 5 — Garde côté client du père

### Task 12 : Le client du père n'envoie pas les ops montées

**Files:**
- Modify: `apps/web/src/lib/online-sync/OnlineSyncProvider.tsx` (le listener `onWorkerMessage` qui fait `client.enqueue`)

- [ ] **Step 1: Filtrer par provenance dans le forward du père**

Localiser le bloc (vers ligne ~168) :

```ts
    const unsub = onWorkerMessage((msg) => {
      if (
        msg &&
        typeof msg === "object" &&
        (msg as { type?: string }).type === "ENTITY_CHANGE"
      ) {
        const op = (msg as { op?: EntityOp }).op;
        if (op) client.enqueue([op]);
      }
    });
```

Remplacer par (ignorer les ops avec provenance ≠ null — elles partent vers leur salon via le MountSyncManager) :

```ts
    const unsub = onWorkerMessage((msg) => {
      if (
        msg &&
        typeof msg === "object" &&
        (msg as { type?: string }).type === "ENTITY_CHANGE"
      ) {
        const m = msg as { op?: EntityOp; sourceVaultId?: string | null };
        // Les entités montées (provenance ≠ null) ne vont JAMAIS dans le
        // salon du père — le MountSyncManager les route vers leur salon.
        if (m.sourceVaultId) return;
        if (m.op) client.enqueue([m.op]);
      }
    });
```

- [ ] **Step 2: Run typecheck + tests sync**

Run: `pnpm typecheck && pnpm --filter @supernote/web test -- src/lib/online-sync`
Expected: OK, tests PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/online-sync/OnlineSyncProvider.tsx
git commit -m "feat(sync): le client du père ignore les ops à provenance montée"
```

---

## Phase 6 — UI (desktop + mobile)

### Task 13 : Form « Connecter un vault » (réutilisable)

**Files:**
- Create: `apps/web/src/components/notes/ConnectVaultModal.tsx`
- Create: `apps/web/src/lib/online-sync/mounts/use-create-mount.ts` (hook : crée l'entité `vault_mount`)

- [ ] **Step 1: Hook de création du montage**

```ts
// apps/web/src/lib/online-sync/mounts/use-create-mount.ts
import { useCallback } from "react";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { normalizeServerUrl, normalizeVaultKey } from "../room-id";

export interface CreateMountArgs {
  serverUrl: string;
  vaultKey: string;
  token: string;
  label: string;
}

export function useCreateMount() {
  const createMount = useCallback(async (args: CreateMountArgs) => {
    const serverUrl = normalizeServerUrl(args.serverUrl);
    const vaultKey = normalizeVaultKey(args.vaultKey);
    if (!vaultKey) throw new Error("Une clé de salon est requise.");
    // Probe le serveur (comme CloudSetupForm) avant de créer le montage.
    const res = await fetch(`${serverUrl}/api/sync/info`);
    if (!res.ok) throw new Error(`Serveur injoignable (HTTP ${res.status}).`);
    const info = (await res.json()) as { enabled?: boolean };
    if (!info.enabled) throw new Error("Ce serveur n'a pas de base configurée.");
    await trpcVanillaClient.entities.create.mutate({
      type: "vault_mount",
      fields: { serverUrl, vaultKey, token: args.token.trim(), label: args.label.trim() || vaultKey },
    });
  }, []);
  return { createMount };
}
```

> Vérifier la shape exacte de `entities.create` (input zod dans `packages/ipc/src/schemas/entities.ts`) et adapter les noms de champs si besoin (`type` vs `typeId`, `fields` vs `data`).

- [ ] **Step 2: Modal HeroUI v3**

```tsx
// apps/web/src/components/notes/ConnectVaultModal.tsx
"use client";

import { useState } from "react";
import { Modal, Button, Input } from "@heroui/react";
import { useCreateMount } from "@/lib/online-sync/mounts/use-create-mount";
import { useToast } from "@supernote/ui";

export function ConnectVaultModal({
  isOpen, onClose,
}: { isOpen: boolean; onClose: () => void }) {
  const { createMount } = useCreateMount();
  const { toast } = useToast();
  const [vaultKey, setVaultKey] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [token, setToken] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await createMount({ serverUrl, vaultKey, token, label });
      toast({ title: "Vault connecté" });
      onClose();
    } catch (err) {
      toast({ title: (err as Error).message, variant: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="flex flex-col gap-3 p-5">
        <h2 className="text-base font-semibold">Connecter un vault</h2>
        <Input label="Clé de salon" value={vaultKey} onValueChange={setVaultKey}
          autoCapitalize="none" isRequired />
        <Input label="Nom affiché (optionnel)" value={label} onValueChange={setLabel} />
        <Input label="Serveur (optionnel)" value={serverUrl} onValueChange={setServerUrl}
          placeholder="même origine par défaut" />
        <Input label="Jeton (optionnel)" value={token} onValueChange={setToken} type="password" />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Annuler</Button>
          <Button variant="primary" isDisabled={busy || !vaultKey} onPress={() => void submit()}>
            Connecter
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

> Vérifier l'API exacte des composants HeroUI v3 (`Modal`, `Input` props `onValueChange`/`value`) dans le repo (lire un usage existant, ex. CloudSetupForm ou un autre Modal v3) et aligner.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/notes/ConnectVaultModal.tsx apps/web/src/lib/online-sync/mounts/use-create-mount.ts
git commit -m "feat(mounts): modal et hook « Connecter un vault »"
```

---

### Task 14 : Points d'entrée UI (FileTree header desktop + drawer mobile + Paramètres)

**Files:**
- Modify: `apps/web/src/components/notes/FileTree.tsx` (bouton « Connecter un vault » dans le header + ouverture de la modal)
- Modify: `apps/web/src/components/shell/mobile/MoreDrawer.tsx` (entrée « Connecter un vault »)
- Modify: `apps/web/src/components/settings/tabs/SyncTab.tsx` (section « Vaults connectés » + bouton)

- [ ] **Step 1: Bouton header FileTree (desktop)**

Dans le header du FileTree (à côté des boutons « + dossier / + note » existants ~ligne où sont les actions du header), ajouter un bouton icône `Plugs` qui ouvre `ConnectVaultModal` (état local `useState`). Suivre exactement le style des boutons d'action voisins (HeroUI `Button` variant ghost, icône Phosphor).

- [ ] **Step 2: Entrée drawer mobile**

Dans `MoreDrawer.tsx`, ajouter une ligne « Connecter un vault » (même forme que les autres items du drawer) qui ouvre la même modal.

- [ ] **Step 3: Section Paramètres → Synchronisation**

Dans `SyncTab.tsx`, ajouter une section « Vaults connectés » avec le bouton « Connecter un vault » (ouvre la modal) ; lister les montages existants (query `entities.list({ type: "vault_mount" })`) avec un bouton « Déconnecter » par ligne (delete de l'entité `vault_mount` → confirm).

- [ ] **Step 4: Run typecheck + lint mobile**

Run: `pnpm typecheck`
Expected: OK. Vérifier visuellement le rendu mobile (largeur, hit-targets) au `pnpm --filter @supernote/web dev`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/FileTree.tsx apps/web/src/components/shell/mobile/MoreDrawer.tsx apps/web/src/components/settings/tabs/SyncTab.tsx
git commit -m "feat(mounts): points d'entrée « Connecter un vault » (FileTree, mobile, réglages)"
```

---

### Task 15 : Nœud FileTree par montage + menu « Déconnecter »

**Files:**
- Modify: `apps/web/src/components/notes/FileTree.tsx`

Les entités montées arrivent déjà dans l'arbre via leur `filePath` préfixé `@mounts/<slug>/…`. Cette tâche : grouper ces chemins sous un nœud racine nommé d'après le `label` du montage (icône `Plugs`/teinte), et offrir « Déconnecter ce vault » (supprime l'entité `vault_mount` correspondante → le MountSyncManager purge automatiquement).

- [ ] **Step 1: Mapper slug → label de montage**

Charger les entités `vault_mount` (déjà disponibles via la query notes ou un hook) et construire `Map<slug, { label, mountEntityId }>` via `cloudRoomSlug(cloudVaultId(serverUrl, vaultKey))`.

- [ ] **Step 2: Regrouper les chemins `@mounts/<slug>/…` sous un nœud racine**

Dans la construction de l'arbre du FileTree, détecter le préfixe `@mounts/<slug>/`, retirer ce préfixe pour l'affichage, et rattacher le sous-arbre sous un nœud racine spécial « <label> » (icône distincte). Le reste de l'arbre (chemins sans préfixe) inchangé.

- [ ] **Step 3: Menu contextuel « Déconnecter ce vault »**

Sur le nœud racine de montage, item de menu qui : confirm (`useConfirm`), puis `entities.delete({ id: mountEntityId })`. La suppression de l'entité `vault_mount` déclenche `manager.refresh()` (déjà câblé Task 11) → stop + `purgeMounted` → les entités montées disparaissent.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/FileTree.tsx
git commit -m "feat(mounts): nœud FileTree par vault monté + déconnexion"
```

---

### Task 16 : Badge de provenance (liste de notes + vues bases)

**Files:**
- Modify: `apps/web/src/components/notes/NoteListItem.tsx`
- Vérifier: les vues bases (contacts/habitudes/todos) ne filtrent pas par accident sur `sourceVaultId`

- [ ] **Step 1: Exposer la provenance jusqu'à la note**

Vérifier que la `Note` (fixtures/adapters) porte un champ dérivable de la provenance — sinon, dériver le label depuis le préfixe `@mounts/<slug>/` du `filePath` via la `Map<slug,label>` (Task 15). Passer un prop optionnel `mountLabel?: string` à `NoteListItem`.

- [ ] **Step 2: Chip discret**

Quand `mountLabel` est présent, afficher un chip (HeroUI `Chip` size sm, variant flat) à côté du titre/date, libellé = nom du montage, teinte dédiée. Réutiliser le style des badges existants (attachmentBadge) pour cohérence.

- [ ] **Step 3: Vérifier les vues bases**

Lire les queries des vues contacts/habitudes/todos (`useNoteList`, vues Bases) et confirmer qu'aucune ne filtre sur `sourceVaultId` — l'union doit venir naturellement de la DB. Aucun changement si déjà neutre ; sinon retirer le filtre parasite.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/notes/NoteListItem.tsx
git commit -m "feat(mounts): badge de provenance sur les notes montées"
```

---

## Phase 7 — Validation finale

### Task 17 : Suite verte + E2E manuel

- [ ] **Step 1: Typecheck + toute la suite**

Run: `pnpm typecheck && pnpm --filter @supernote/web test`
Expected: typecheck OK, tous les tests PASS.

- [ ] **Step 2: E2E manuel (deux salons dev)**

Avec le backend dev (`sync-dev.db`), dans deux onglets/profils :
1. Salon `pere` (coffre cloud) + salon `enfant` ; créer un contact dans `enfant`.
2. Dans `pere`, connecter le vault `enfant` → le contact apparaît sous le nœud `enfant` dans Notes ET dans la vue Contacts, avec badge.
3. Éditer le contact depuis `pere` → vérifier (onglet `enfant`) que la modif est arrivée dans le salon `enfant` (push retour, dé-préfixé).
4. Déconnecter `enfant` → ses entités disparaissent de `pere`, salon `enfant` intact.
5. Boucle : dans `enfant`, monter `pere` → vérifier aucune réplication infinie (garde visited).

- [ ] **Step 3: Commit (si ajustements E2E)**

```bash
git add -A
git commit -m "fix(mounts): ajustements issus de l'E2E manuel"
```

---

## Couverture spec (self-review)

| Section spec | Tâche(s) |
|---|---|
| Colonne `sourceVaultId` + index | 2 |
| Provenance non transportée dans l'op-log | 3, 4, 6 (niveau message, pas EntityOp) |
| Entité `vault_mount` + seed | 7 |
| Préfixe `@mounts/<slug>/` | 1, 3, 4 |
| MountSyncManager (découverte, transitif, gardes, client/montage, curseurs, démontage) | 8, 9, 10, 11 |
| Routage écritures par provenance + dé-préfixage | 10, 11 |
| Client du père ignore les ops montées | 12 |
| Gardes worker (snapshot/applyOps/sweep/fichiers/purgeMounted/type à la volée/cross-provenance) | 4 |
| Contrat IPC (applyOps étendu, purgeMounted) | 5 |
| UI connecter (FileTree/mobile/réglages) | 13, 14 |
| Nœud FileTree + déconnexion | 15 |
| Badge provenance + vues bases | 16 |
| Tests vitest worker + manager | 3, 8, 9, 10 |

## Limites V1 (rappel, documentées dans la spec)

- Définitions de colonnes des types custom non transportées (types créés « nus »).
- Pas de droits par montage (tout membre du père peut éditer).
- Canvas `.excalidraw` des sous-vaults non transportés.
- Conflits d'id cross-provenance : skip + warn.
