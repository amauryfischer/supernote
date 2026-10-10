/**
 * Helpers d'entités partagés par le routeur du worker et ses modules de routes
 * (`sync-routes`, `mail-routes`) : index FTS5, tombstones, index de mentions,
 * lecture défensive des blobs `fields`, pose des tags. Extraits de
 * `worker-router.ts` pour que les modules de routes n'aient pas à le réimporter.
 */

import type { Database } from "./sqlite-adapter";
import { row, rows, type SqlRow } from "./sql";
import { generateId } from "./fsa-file-io";
import { derivePath } from "./path-utils";
import { EMAIL_AI_CACHE_TYPE_ID, MAIL_COMMITMENT_TYPE_ID } from "./seed-default-types";

export interface EntityDoc {
  id: string;
  typeId: string;
  title: string;
  body: string;
  tags: string;
  /**
   * Folder + filename (minus `.md`) of the entity, with `/` replaced by
   * spaces so FTS5 tokenizes each segment. Lets users find a note by
   * any folder along its path — typing "leroy" matches every note in
   * `Maison VLM/Courses Leroy Merlin/...`, even ones whose own title and
   * body never mention the word.
   */
  path: string;
}

export function now(): string {
  return new Date().toISOString();
}

// ── FTS5 index helpers ────────────────────────────────────────────────────────

/**
 * Extract a searchable title from an entity's `fields` JSON.
 *
 * The .md filename is just the entity's random ID, so indexing the filename
 * makes every entity invisible to a name search ("Alice" never matches
 * "<id>.md"). We pull the human-readable name from `fields.name` (with
 * common alternatives) and fall back to the filename only if no name
 * field is present.
 *
 * Aliases (stored as a JSON-encoded string array under `fields.aliases`)
 * are appended to the returned string so FTS5 indexes them under the
 * `title` column — i.e. "@LD" resolves to a contact whose canonical name
 * is "Linh Dan" but who has "LD" listed as an alias.
 */
export function deriveTitle(fieldsJson: string | null, filePath: string | null): string {
  let fields: Record<string, unknown> = {};
  if (fieldsJson) {
    try {
      fields = JSON.parse(fieldsJson) as Record<string, unknown>;
    } catch {
      // Malformed JSON — fall through to filename
    }
  }
  let base = "";
  for (const key of ["name", "titre", "title", "nom"]) {
    const v = fields[key];
    if (typeof v === "string" && v.length > 0) { base = v; break; }
  }
  if (!base) {
    base = (filePath ?? "").split("/").pop()?.replace(".md", "") ?? "";
  }
  // Append aliases so MiniSearch matches them under the `title` field.
  // Stored as a JSON-encoded string array (`["LD","Linh"]`); also tolerate a
  // raw array (defensive) and a comma/newline-separated string.
  const aliasesRaw = fields["aliases"];
  const aliases: string[] = (() => {
    if (Array.isArray(aliasesRaw)) {
      return aliasesRaw.filter((a): a is string => typeof a === "string" && a.length > 0);
    }
    if (typeof aliasesRaw === "string" && aliasesRaw.length > 0) {
      const trimmed = aliasesRaw.trim();
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (Array.isArray(parsed)) {
            return parsed.filter((a): a is string => typeof a === "string" && a.length > 0);
          }
        } catch {
          // Fall through to the comma/newline split below.
        }
      }
      return trimmed
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return [];
  })();
  if (aliases.length === 0) return base;
  return base ? `${base} ${aliases.join(" ")}` : aliases.join(" ");
}

/**
 * Build a safe FTS5 MATCH expression from raw user input.
 *
 * FTS5 has its own query syntax (AND OR NOT NEAR, quoted phrases, prefix
 * `*`, column filters with `col:`). Forwarding raw user input would let a
 * stray colon or unbalanced quote throw a syntax error AND would change
 * semantics in surprising ways. We sanitize each whitespace-delimited
 * token, wrap it as a quoted phrase, and append `*` for prefix matching —
 * matching MiniSearch's old `prefix: true` behavior.
 *
 * Fuzzy matching (`fuzzy: 0.2` in the old MiniSearch config) is not
 * supported by FTS5 natively. The prefix glob covers most of what fuzzy
 * was actually used for in practice (typing "lin" to find "Linh").
 *
 * Returns `null` if the query has no usable tokens.
 */
export function buildFtsMatch(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    // Strip FTS5 special characters. Keep letters/digits/underscore — the
    // unicode61 tokenizer with `remove_diacritics 2` does case-folding and
    // diacritic removal at index time, so passing "lea" matches "Léa".
    .split(/\s+/)
    .map((t) => t.replace(/["():\-.\^*¬]/g, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" ");
}

export function ftsAdd(db: Database, doc: EntityDoc): void {
  // Defensive: a stale row from a previous indexing pass would lead to
  // duplicate hits in the same query. FTS5 has no UNIQUE constraint on the
  // UNINDEXED `id`, so we explicitly delete-then-insert.
  db.run(`DELETE FROM entity_fts WHERE id = ?`, [doc.id]);
  db.run(
    `INSERT INTO entity_fts (id, title, body, tags, path) VALUES (?, ?, ?, ?, ?)`,
    [doc.id, doc.title, doc.body, doc.tags, doc.path],
  );
}

export function ftsRemove(db: Database, id: string): void {
  db.run(`DELETE FROM entity_fts WHERE id = ?`, [id]);
}

/**
 * Entity-deletion tombstones — see the `deleted_entity` table in db-schema.ts.
 * Mark on delete, clear on (re)create/upsert, and check in the reindex so an
 * orphan .md (one whose disk removal failed during a delete) can't resurrect a
 * deleted entity on the next boot.
 */
export function tombstoneAdd(db: Database, id: string): void {
  db.run(
    `INSERT INTO deleted_entity (id, deletedAt) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET deletedAt = excluded.deletedAt`,
    [id, now()],
  );
}

export function tombstoneClear(db: Database, id: string): void {
  db.run(`DELETE FROM deleted_entity WHERE id = ?`, [id]);
}

export function isTombstoned(db: Database, id: string): boolean {
  return !!row(db.exec(`SELECT id FROM deleted_entity WHERE id = ?`, [id]));
}

/**
 * Rebuild the entity_fts index from scratch for the given vault. Called at
 * router boot when the FTS table is empty (fresh vault, post-migration) and
 * after `vault.reindex` completes so the index reflects the disk truth.
 */
export function ftsRebuild(db: Database, vaultId: string): void {
  // `entity_fts` is shared by all vaults in this DB — but in practice the
  // worker only ever sees one vault. Wiping unconditionally keeps the
  // rebuild logic simple and matches the old `initMiniSearch` behavior
  // (which dropped and recreated the in-memory index on every call).
  db.run(`DELETE FROM entity_fts`);
  const allEntities = rows(
    db.exec(
      `SELECT e.id, e.typeId, e.filePath, e.fields, e.body,
              GROUP_CONCAT(t.path, ' ') as tagPaths
       FROM entity e
       LEFT JOIN entity_tag et ON et.entityId = e.id
       LEFT JOIN tag t ON t.id = et.tagId
       WHERE e.vaultId = ? AND e.typeId NOT IN (?, ?)
       GROUP BY e.id`,
      [vaultId, EMAIL_AI_CACHE_TYPE_ID, MAIL_COMMITMENT_TYPE_ID],
    ),
  );
  for (const r of allEntities) {
    ftsAdd(db, {
      id: r["id"] as string,
      typeId: r["typeId"] as string,
      title: deriveTitle(r["fields"] as string | null, r["filePath"] as string | null),
      body: (r["body"] as string) ?? "",
      tags: (r["tagPaths"] as string) ?? "",
      path: derivePath(r["filePath"] as string | null),
    });
  }
  console.info(`[search] ftsRebuild indexed ${allEntities.length} entit(y/ies) for vault ${vaultId}`);
}

export function entityToDoc(r: SqlRow): EntityDoc {
  return {
    id: r["id"] as string,
    typeId: r["typeId"] as string,
    title: deriveTitle(r["fields"] as string | null, r["filePath"] as string | null),
    body: (r["body"] as string) ?? "",
    tags: (r["tags"] as string) ?? "",
    path: derivePath(r["filePath"] as string | null),
  };
}

// ── Mention (backlinks) index helpers ────────────────────────────────────────
//
// La table `mention` alimente entities.getBacklinks / backlinkCounts. Elle est
// (re)peuplée ici à chaque create/update d'entité, purgée au delete, et
// backfillée au boot si elle est vide alors que des corps existent (vaults
// antérieurs à l'activation du pipeline).
//
// Syntaxe inline — copie volontaire de packages/core/src/markdown/mentions.ts
// (les regex y sont privées ; core n'exporte que extractMentions, qui exige un
// AST remark — trop lourd pour le chemin par-sauvegarde du worker, et ses
// offsets sont relatifs aux nœuds texte, pas au body brut).

const MENTION_EMBED_RE = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
const MENTION_WIKILINK_RE = /(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
// Jusqu'à 4 mots après l'@, lettres accentuées comprises ; pas d'@ collé à un
// mot (adresses e-mail).
const MENTION_AT_RE = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+){0,3})/gu;
// Forme écrite par l'éditeur : `@[Nom complet](entity:ID)` ; l'id se résout en premier.
const MENTION_REF_RE = /@\[([^\]]+)\](?:\(entity:([^)\s]+)\))?/g;

// Le sérialiseur de l'éditeur écrit `@${name}` sans marquer la fin du nom :
// « @Alice Dupont hier » peut viser « Alice Dupont » comme « Alice ». On essaie
// du plus long au plus court, ponctuation finale retirée.
// ponytail: heuristique par préfixe (≤4 mots) ; la vraie racine est
// packages/editor/src/serialization/serialize.ts qui perd `props.id`.
function atMentionCandidates(capture: string): string[] {
  const words = capture.split(" ");
  const out: string[] = [];
  for (let n = words.length; n > 0; n--) {
    const candidate = words.slice(0, n).join(" ").replace(/[.-]+$/, "");
    if (candidate) out.push(candidate);
  }
  return out;
}

interface RawMentionHit {
  /** Cibles candidates, la première résolue gagne ("Alice" dans [[Alice|elle]]). */
  targets: string[];
  mentionType: "EMBED" | "WIKILINK" | "MENTION_ENTITY";
  /** Ligne du body contenant le lien — aperçu affiché dans BacklinksPanel. */
  rawText: string;
  /** Offset absolu (en caractères) du match dans le body. */
  offset: number;
}

/** Scan brut du body, ligne par ligne (la ligne devient le rawText). */
function scanMentions(body: string): RawMentionHit[] {
  const out: RawMentionHit[] = [];
  let offset = 0;
  for (const line of body.split("\n")) {
    // Pré-filtre : la grande majorité des lignes n'a ni [[ ni @.
    if (line.includes("[[") || line.includes("@")) {
      const rawText = line.trim().slice(0, 500);
      const collect = (
        re: RegExp,
        mentionType: RawMentionHit["mentionType"],
        expand: (target: string) => string[] = (t) => [t],
      ): void => {
        for (const m of line.matchAll(re)) {
          const target = m[1]?.trim();
          if (target) out.push({ targets: expand(target), mentionType, rawText, offset: offset + (m.index ?? 0) });
        }
      };
      collect(MENTION_EMBED_RE, "EMBED");
      collect(MENTION_WIKILINK_RE, "WIKILINK");
      collect(MENTION_AT_RE, "MENTION_ENTITY", atMentionCandidates);
      for (const m of line.matchAll(MENTION_REF_RE)) {
        const name = m[1]?.trim();
        const id = m[2]?.trim();
        const targets = [id, name].filter((t): t is string => !!t);
        if (targets.length) out.push({ targets, mentionType: "MENTION_ENTITY", rawText, offset: offset + (m.index ?? 0) });
      }
    }
    offset += line.length + 1; // +1 pour le \n consommé par le split
  }
  return out;
}

/**
 * Résout une cible de mention (id direct, nom, titre ou filename) → entity id.
 * Même logique que `loadEntityByRef` (le cache @Ref/[[Wiki]] des formules) :
 * id exact, puis LIKE sur le JSON `fields` / le filePath — étendue au champ
 * `title` (les notes stockent leur nom là, pas dans `name`) et aux fichiers à
 * la racine du vault (sans `/` devant). Homonymes : la plus ancienne gagne
 * (ORDER BY createdAt), pour un résultat stable d'une réindexation à l'autre.
 * Le cache mémoïse par cible — un rebuild où 50 notes citent [[Alice]] ne fait
 * qu'une seule requête.
 */
function createMentionResolver(db: Database, vaultId: string): (ref: string) => string | null {
  const cache = new Map<string, string | null>();
  return (ref: string): string | null => {
    const hit = cache.get(ref);
    if (hit !== undefined) return hit;
    const r =
      row(db.exec(
        `SELECT id FROM entity WHERE vaultId = ? AND id = ?`,
        [vaultId, ref],
      )) ??
      row(db.exec(
        `SELECT id FROM entity
          WHERE vaultId = ?
            AND (fields LIKE ? OR fields LIKE ? OR filePath LIKE ? OR filePath = ?)
          ORDER BY createdAt ASC LIMIT 1`,
        [vaultId, `%"name":${JSON.stringify(ref)}%`, `%"title":${JSON.stringify(ref)}%`, `%/${ref}.md`, `${ref}.md`],
      ));
    const id = r ? (r["id"] as string) : null;
    cache.set(ref, id);
    return id;
  };
}

/**
 * (Ré)indexe les mentions sortantes d'une entité : DELETE puis INSERT batch.
 * Seules les mentions RÉSOLUES sont stockées (targetId non-null) — un @email
 * ou un [[lien cassé]] ne crée pas de ligne. Dédupliqué par cible : une note
 * qui cite [[Alice]] trois fois ne produit qu'un backlink (et le panneau
 * utilise sourceId comme clé React). Les auto-références sont ignorées.
 */
export function indexMentions(
  db: Database,
  vaultId: string,
  sourceId: string,
  body: string,
  resolve?: (ref: string) => string | null,
): void {
  db.run(`DELETE FROM mention WHERE sourceId = ?`, [sourceId]);
  if (!body) return;
  const hits = scanMentions(body);
  if (hits.length === 0) return;
  const resolver = resolve ?? createMentionResolver(db, vaultId);
  const ts = now();
  const seenTargets = new Set<string>();
  for (const hit of hits) {
    let targetId: string | null = null;
    for (const candidate of hit.targets) {
      targetId = resolver(candidate);
      if (targetId) break;
    }
    if (!targetId || targetId === sourceId || seenTargets.has(targetId)) continue;
    seenTargets.add(targetId);
    db.run(
      `INSERT INTO mention (id, sourceId, targetId, rawText, mentionType, offset, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [generateId(), sourceId, targetId, hit.rawText, hit.mentionType, hit.offset, ts, ts],
    );
  }
}

/** Purge les mentions ÉMISES par une entité supprimée. Les mentions qui la
 *  CIBLENT sont gérées par le schéma (FK targetId ON DELETE SET NULL,
 *  `PRAGMA foreign_keys = ON` posé par SCHEMA_SQL à chaque boot) — ceci est
 *  la ceinture-bretelles explicite, comme ftsRemove. */
export function mentionsRemove(db: Database, id: string): void {
  db.run(`DELETE FROM mention WHERE sourceId = ?`, [id]);
}

/**
 * Rebuild complet de la table mention pour le vault — même esprit que
 * ftsRebuild (wipe inconditionnel : le worker ne voit qu'un vault). Appelé au
 * backfill de boot et après vault.reindex. Le résolveur (et son cache) est
 * partagé sur toute la passe. À envelopper dans runInTransaction par
 * l'appelant : 100 % synchrone, un seul commit OPFS pour tout le batch.
 */
export function mentionsRebuild(db: Database, vaultId: string): number {
  db.run(`DELETE FROM mention`);
  const sources = rows(db.exec(
    `SELECT id, body FROM entity WHERE vaultId = ? AND body IS NOT NULL AND body != ''`,
    [vaultId],
  ));
  const resolve = createMentionResolver(db, vaultId);
  let scanned = 0;
  for (const r of sources) {
    const body = (r["body"] as string) ?? "";
    if (!body.includes("[[") && !body.includes("@")) continue;
    indexMentions(db, vaultId, r["id"] as string, body, resolve);
    scanned++;
  }
  return scanned;
}

/**
 * Parse an `entity_type.fields` blob (a JSON array of column definitions) into
 * an array. Returns `[]` for NULL / empty / malformed input so a sync payload
 * always carries a well-formed `typeFields`. Accepts the raw SQL cell value
 * (`unknown`) since callers read it straight off a row.
 */
export function parseTypeFieldsBlob(raw: unknown): unknown[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Parse the JSON-encoded `fields` blob defensively. A previous bad code path
 * could store the blob as a string-of-JSON-string (or even deeper), which
 * makes plain `JSON.parse` return a string. Spreading that string elsewhere
 * yields character-indexed keys and silently corrupts the entity. We unwrap
 * up to 5 layers and refuse anything that doesn't end up as a plain object.
 */
export function safeParseFieldsBlob(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    let parsed: unknown = JSON.parse(raw);
    for (let i = 0; i < 5 && typeof parsed === "string"; i++) {
      try { parsed = JSON.parse(parsed); } catch { break; }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const obj = parsed as Record<string, unknown>;
    // Strip numeric character-index keys that came from a previous bug where
    // a JSON string was spread into the fields object (`{"0":"{","1":"\\\"",
    // "2":"t",…, "title":"Réunion…"}`). The real fields are the named keys.
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/^\d+$/.test(k)) continue;
      // Detect over-escaped JSON-looking strings (`canvas` and friends that
      // accumulated backslashes through bad round-trips). Try to recover via
      // repeated JSON.parse; if unrecoverable, drop the value so a fresh save
      // can re-write a clean blob — better an empty canvas than a permanent
      // bag of `\\\\\\\\\\` that grows on every reload.
      if (typeof v === "string" && (v.startsWith("{") || v.startsWith("["))) {
        // Heuristic: any JSON-looking string with 4+ consecutive backslashes
        // is corrupted past the point of round-trip recovery.
        if (/\\{4,}/.test(v)) {
          // Skip — equivalent to dropping the field.
          continue;
        }
        let cur: unknown = v;
        for (let i = 0; i < 6 && typeof cur === "string"; i++) {
          try {
            const next = JSON.parse(cur);
            if (typeof next === "string") { cur = next; continue; }
            cleaned[k] = JSON.stringify(next);
            break;
          } catch {
            break;
          }
        }
        if (cleaned[k] === undefined) cleaned[k] = v;
      } else {
        cleaned[k] = v;
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}
// Synchrone à dessein : appelée dans runInTransaction, une levée doit annuler le COMMIT.
export function applyEntityTags(
  db: Database,
  vaultId: string,
  entityId: string,
  tags: string[],
  ts: string,
): void {
  for (const tagPath of tags) {
    let tagRow = row(db.exec(`SELECT id FROM tag WHERE vaultId = ? AND path = ?`, [vaultId, tagPath]));
    if (!tagRow) {
      const tagId = generateId();
      db.run(
        `INSERT OR IGNORE INTO tag (id, vaultId, path, label, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
        [tagId, vaultId, tagPath, tagPath.split("/").pop() ?? tagPath, ts, ts],
      );
      tagRow = { id: tagId };
    }
    const tagId = tagRow["id"] ?? null;
    db.run(
      `INSERT OR IGNORE INTO entity_tag (entityId, tagId, createdAt) VALUES (?, ?, ?)`,
      [entityId, tagId, ts],
    );
  }
}
