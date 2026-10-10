/**
 * Routes `mail.*` : miroir local de Gmail (tables `mail_*`) et cache IA des
 * fils (entités système `email_ai_cache`). Le réseau Gmail se fait sur le thread
 * principal ; ici on range, on sert les lectures et on tient la file d'écriture.
 * Extraites de `worker-router.ts`.
 */

import type { Database } from "./sqlite-adapter";
import type { RouteHandler, RouterLifecycleHooks } from "./worker-router";
import { row, rows, runInTransaction, type SqlRow } from "./sql";
import { EMAIL_AI_CACHE_TYPE_ID, MAIL_COMMITMENT_TYPE_ID } from "./seed-default-types";
import { now, tombstoneAdd } from "./entity-helpers";

/** Helpers du miroir mail dont `sync.applyOps` a besoin pour répercuter les ops reçues. */
export interface MailMirror {
  MAIL_STATE_THREAD_ID: string;
  dropMirroredThread: (fieldsJson: unknown) => void;
  adoptSharedMailState: (accountId: string, f: Record<string, unknown>) => void;
  upsertSharedMailThread: (accountId: string, threadId: string, f: Record<string, unknown>) => void;
}

export function buildMailRoutes(
  db: Database,
  vaultId: string,
  hooks: RouterLifecycleHooks,
): { routes: Record<string, RouteHandler>; mirror: MailMirror } {
  // ── Mail mirror (local-first Gmail cache) ──────────────────────────────────
  // Account-scoped cache. Gmail stays the source of truth; these handlers only
  // read/write the local mirror tables. Network I/O lives on the main thread.

  const parseStrArr = (raw: unknown): string[] => {
    if (typeof raw !== "string" || raw.length === 0) return [];
    try {
      const v: unknown = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  };

  /** Recompute a label set: drop `remove`, add `add`, dedupe, order-stable. */
  const patchLabels = (current: string[], add: string[], remove: string[]): string[] => {
    const out = current.filter((l) => !remove.includes(l));
    for (const l of add) if (!out.includes(l)) out.push(l);
    return out;
  };

  const mailThreadRowToOut = (r: SqlRow) => ({
    id: r["id"] as string,
    subject: (r["subject"] as string) ?? "",
    from: {
      name: (r["fromName"] as string) ?? "",
      email: (r["fromEmail"] as string) ?? "",
    },
    date: (r["lastDate"] as string) ?? "",
    snippet: (r["snippet"] as string) ?? "",
    labelIds: parseStrArr(r["labelIds"]),
    historyId: (r["historyId"] as string | null) ?? null,
    aiCategory: (r["aiCategory"] as string | null) ?? null,
    aiCategoryConfidence: r["aiCategoryConfidence"] != null ? Number(r["aiCategoryConfidence"]) : null,
    aiCategoryRuns: r["aiCategoryRuns"] != null ? Number(r["aiCategoryRuns"]) : null,
    aiCategoryAt: r["aiCategoryAt"] != null ? Number(r["aiCategoryAt"]) : null,
    aiSummary: (r["aiSummary"] as string | null) ?? null,
    aiSummaryFp: (r["aiSummaryFp"] as string | null) ?? null,
    aiSummaryAt: r["aiSummaryAt"] != null ? Number(r["aiSummaryAt"]) : null,
  });

  const mailListThreads = async (input: unknown): Promise<unknown> => {
    const { accountId, labelId, isUnread, isStarred, limit = 50, offset = 0 } =
      (input as {
        accountId: string;
        labelId?: string;
        isUnread?: boolean;
        isStarred?: boolean;
        limit?: number;
        offset?: number;
      }) ?? {};
    if (!accountId) return { items: [], total: 0 };
    const where: string[] = [`accountId = ?`];
    const params: (string | number)[] = [accountId];
    // labelIds is a JSON array string like ["INBOX","UNREAD"]; the quoted token
    // match is exact enough (closing quote rules out prefix collisions).
    if (labelId) {
      where.push(`labelIds LIKE ?`);
      params.push(`%${JSON.stringify(labelId)}%`);
    }
    if (isUnread) where.push(`labelIds LIKE '%"UNREAD"%'`);
    if (isStarred) where.push(`labelIds LIKE '%"STARRED"%'`);
    const whereSql = where.join(" AND ");
    const totalRow = row(
      db.exec(`SELECT COUNT(*) AS c FROM mail_thread WHERE ${whereSql}`, params),
    );
    const total = totalRow ? Number(totalRow["c"]) : 0;
    const res = db.exec(
      `SELECT id, subject, fromName, fromEmail, snippet, lastDate, labelIds, historyId,
              aiCategory, aiCategoryConfidence, aiCategoryRuns, aiCategoryAt,
              aiSummary, aiSummaryFp, aiSummaryAt
         FROM mail_thread WHERE ${whereSql}
        ORDER BY lastInternalDate DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { items: rows(res).map(mailThreadRowToOut), total };
  };

  /**
   * Recherche instantanée dans le mirror. Les filtres arrivent DÉJÀ analysés
   * (le worker ne connaît pas la syntaxe Gmail) : on les traduit en prédicats
   * SQL. Les mots libres balaient objet / expéditeur / extrait, et le CORPS des
   * messages déjà mirrorés via un EXISTS — c'est ce qui fait la différence avec
   * un simple filtre de liste.
   *
   * LIKE en minuscules des deux côtés : les colonnes ne sont pas indexées pour
   * la recherche, mais le mirror tient quelques centaines de fils → réponse
   * sous la milliseconde, sans table FTS à maintenir en plus.
   */
  const mailSearchThreads = async (input: unknown): Promise<unknown> => {
    const {
      accountId,
      terms = [],
      from = [],
      to = [],
      subject = [],
      labelIds = [],
      isUnread,
      isRead,
      isStarred,
      hasAttachment,
      after,
      before,
      limit = 100,
      offset = 0,
    } = (input as {
      accountId: string;
      terms?: string[];
      from?: string[];
      to?: string[];
      subject?: string[];
      labelIds?: string[];
      isUnread?: boolean;
      isRead?: boolean;
      isStarred?: boolean;
      hasAttachment?: boolean;
      after?: number;
      before?: number;
      limit?: number;
      offset?: number;
    }) ?? {};
    if (!accountId) return { items: [], total: 0 };

    const where: string[] = [`t.accountId = ?`];
    const params: (string | number)[] = [accountId];
    const like = (v: string) => `%${v.toLowerCase()}%`;

    for (const id of labelIds) {
      where.push(`t.labelIds LIKE ?`);
      params.push(`%${JSON.stringify(id)}%`);
    }
    if (isUnread) where.push(`t.labelIds LIKE '%"UNREAD"%'`);
    if (isRead) where.push(`t.labelIds NOT LIKE '%"UNREAD"%'`);
    if (isStarred) where.push(`t.labelIds LIKE '%"STARRED"%'`);
    if (typeof after === "number") {
      where.push(`t.lastInternalDate >= ?`);
      params.push(after);
    }
    if (typeof before === "number") {
      where.push(`t.lastInternalDate <= ?`);
      params.push(before);
    }
    for (const f of from) {
      where.push(`(lower(t.fromEmail) LIKE ? OR lower(t.fromName) LIKE ?)`);
      params.push(like(f), like(f));
    }
    for (const sub of subject) {
      where.push(`lower(t.subject) LIKE ?`);
      params.push(like(sub));
    }
    for (const dest of to) {
      where.push(
        `EXISTS (SELECT 1 FROM mail_message m WHERE m.accountId = t.accountId AND m.threadId = t.id AND lower(m.toJson) LIKE ?)`,
      );
      params.push(like(dest));
    }
    if (hasAttachment) {
      where.push(
        `EXISTS (SELECT 1 FROM mail_message m WHERE m.accountId = t.accountId AND m.threadId = t.id AND m.attachmentsJson NOT IN ('', '[]'))`,
      );
    }
    for (const term of terms) {
      where.push(
        `(lower(t.subject) LIKE ? OR lower(t.snippet) LIKE ? OR lower(t.fromName) LIKE ? OR lower(t.fromEmail) LIKE ?
          OR EXISTS (SELECT 1 FROM mail_message m WHERE m.accountId = t.accountId AND m.threadId = t.id AND lower(m.bodyText) LIKE ?))`,
      );
      const l = like(term);
      params.push(l, l, l, l, l);
    }

    const whereSql = where.join(" AND ");
    const totalRow = row(
      db.exec(`SELECT COUNT(*) AS c FROM mail_thread t WHERE ${whereSql}`, params),
    );
    const total = totalRow ? Number(totalRow["c"]) : 0;
    const res = db.exec(
      `SELECT t.id, t.subject, t.fromName, t.fromEmail, t.snippet, t.lastDate, t.labelIds,
              t.aiCategory, t.aiCategoryConfidence, t.aiCategoryRuns, t.aiCategoryAt,
              t.aiSummary, t.aiSummaryFp, t.aiSummaryAt
         FROM mail_thread t WHERE ${whereSql}
        ORDER BY t.lastInternalDate DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { items: rows(res).map(mailThreadRowToOut), total };
  };

  const mailGetThread = async (input: unknown): Promise<unknown> => {
    const { accountId, threadId } = (input as { accountId: string; threadId: string }) ?? {};
    if (!accountId || !threadId) return { thread: null };
    const t = row(
      db.exec(
        `SELECT labelIds, messagesLoaded FROM mail_thread WHERE accountId = ? AND id = ?`,
        [accountId, threadId],
      ),
    );
    if (!t) return { thread: null };
    const msgRes = db.exec(
      `SELECT id, threadId, subject, fromName, fromEmail, toJson, date, snippet,
              bodyText, bodyHtml, attachmentsJson, messageId, refs, webLink, labelIds
         FROM mail_message WHERE accountId = ? AND threadId = ?
        ORDER BY internalDate ASC`,
      [accountId, threadId],
    );
    const messages = rows(msgRes).map((r) => ({
      id: r["id"] as string,
      threadId: r["threadId"] as string,
      subject: (r["subject"] as string) ?? "",
      from: { name: (r["fromName"] as string) ?? "", email: (r["fromEmail"] as string) ?? "" },
      to: (() => {
        try {
          const v: unknown = JSON.parse((r["toJson"] as string) || "[]");
          return Array.isArray(v) ? v : [];
        } catch {
          return [];
        }
      })(),
      date: (r["date"] as string) ?? "",
      snippet: (r["snippet"] as string) ?? "",
      bodyText: (r["bodyText"] as string) ?? "",
      bodyHtml: (r["bodyHtml"] as string) ?? undefined,
      attachments: (() => {
        try {
          const v: unknown = JSON.parse((r["attachmentsJson"] as string) || "[]");
          return Array.isArray(v) ? v : [];
        } catch {
          return [];
        }
      })(),
      messageId: (r["messageId"] as string) ?? undefined,
      references: (r["refs"] as string) ?? undefined,
      webLink: (r["webLink"] as string) ?? "",
      labelIds: parseStrArr(r["labelIds"]),
    }));
    return {
      thread: {
        id: threadId,
        messages,
        labelIds: parseStrArr(t["labelIds"]),
        complete: Number(t["messagesLoaded"]) === 1,
      },
    };
  };

  const mailGetLabels = async (input: unknown): Promise<unknown> => {
    const { accountId } = (input as { accountId: string }) ?? {};
    if (!accountId) return { labels: [] };
    const res = db.exec(
      `SELECT id, name, colorJson, type FROM mail_label WHERE accountId = ? ORDER BY name ASC`,
      [accountId],
    );
    const labels = rows(res).map((r) => {
      const color = (() => {
        const raw = r["colorJson"];
        if (typeof raw !== "string" || !raw) return undefined;
        try {
          const v = JSON.parse(raw) as { textColor?: string; backgroundColor?: string };
          if (v && typeof v.textColor === "string" && typeof v.backgroundColor === "string") {
            return { textColor: v.textColor, backgroundColor: v.backgroundColor };
          }
        } catch {
          /* ignore malformed color */
        }
        return undefined;
      })();
      return {
        id: r["id"] as string,
        name: (r["name"] as string) ?? "",
        ...(color ? { color } : {}),
        ...(r["type"] ? { type: r["type"] as string } : {}),
      };
    });
    return { labels };
  };

  const mailGetState = async (input: unknown): Promise<unknown> => {
    const { accountId } = (input as { accountId: string }) ?? {};
    if (!accountId) {
      return {
        historyId: null,
        lastFullSyncAt: 0,
        lastSyncAt: 0,
        threadCount: 0,
        pendingOutbox: 0,
        failedOutbox: 0,
      };
    }
    const s = row(
      db.exec(
        `SELECT historyId, lastFullSyncAt, lastSyncAt FROM mail_sync_state WHERE accountId = ?`,
        [accountId],
      ),
    );
    const tc = row(db.exec(`SELECT COUNT(*) AS c FROM mail_thread WHERE accountId = ?`, [accountId]));
    const ob = row(
      db.exec(
        `SELECT COUNT(*) AS c FROM mail_outbox WHERE accountId = ? AND status != 'failed'`,
        [accountId],
      ),
    );
    const fb = row(
      db.exec(
        `SELECT COUNT(*) AS c FROM mail_outbox WHERE accountId = ? AND status = 'failed'`,
        [accountId],
      ),
    );
    return {
      historyId: s ? ((s["historyId"] as string | null) ?? null) : null,
      lastFullSyncAt: s ? Number(s["lastFullSyncAt"]) : 0,
      lastSyncAt: s ? Number(s["lastSyncAt"]) : 0,
      threadCount: tc ? Number(tc["c"]) : 0,
      pendingOutbox: ob ? Number(ob["c"]) : 0,
      failedOutbox: fb ? Number(fb["c"]) : 0,
    };
  };

  // ── email AI cache: entity id = deterministic from accountId + threadId ──
  const emailAiCacheEntityId = (accountId: string, threadId: string): string =>
    `eac_${accountId.replace(/[^a-zA-Z0-9]/g, "_")}_${threadId}`;
  const mailCommitmentEntityId = (accountId: string, threadId: string): string =>
    `mc_${accountId.replace(/[^a-zA-Z0-9]/g, "_")}_${threadId}`;

  // Miroir partagé : le premier appareil qui lit Gmail publie fils, labels et
  // curseur via les entités email_ai_cache ; les autres les reçoivent au lieu de
  // relire Gmail (quota par minute et par utilisateur, tous appareils cumulés).
  // L'entité portant ce faux threadId transporte le curseur et les labels.
  const MAIL_STATE_THREAD_ID = "__state";

  const parseFields = (json: unknown): Record<string, unknown> => {
    try { return JSON.parse((json as string) || "{}") as Record<string, unknown>; } catch { return {}; }
  };

  const hasPendingMailOp = (accountId: string, threadId: string): boolean =>
    !!row(db.exec(
      `SELECT 1 AS x FROM mail_outbox WHERE accountId = ? AND threadId = ? AND status != 'failed' LIMIT 1`,
      [accountId, threadId],
    ));

  type MirrorLabel = { id: string; name?: string; color?: { textColor: string; backgroundColor: string }; type?: string };

  const replaceMailLabels = (accountId: string, labels: MirrorLabel[], ts: number): void => {
    // Liste vide = échec probable de labels.list côté client, on ne purge pas.
    if (labels.length === 0) return;
    db.run(
      `DELETE FROM mail_label WHERE accountId = ? AND id NOT IN (${labels.map(() => "?").join(", ")})`,
      [accountId, ...labels.map((l) => l.id)],
    );
    for (const l of labels) {
      db.run(
        `INSERT INTO mail_label (accountId, id, name, colorJson, type, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(accountId, id) DO UPDATE SET
           name = excluded.name, colorJson = excluded.colorJson, type = excluded.type, updatedAt = excluded.updatedAt`,
        [accountId, l.id, l.name ?? "", l.color ? JSON.stringify(l.color) : null, l.type ?? null, ts],
      );
    }
  };

  // Un fil avec une op locale en attente garde son état optimiste : le reçu est
  // antérieur à l'intention de l'utilisateur sur cet appareil.
  const upsertSharedMailThread = (accountId: string, threadId: string, f: Record<string, unknown>): void => {
    if (typeof f["eac_label_ids"] !== "string" || hasPendingMailOp(accountId, threadId)) return;
    db.run(
      `INSERT INTO mail_thread
         (accountId, id, subject, fromName, fromEmail, snippet, lastDate, lastInternalDate, labelIds, messagesLoaded, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(accountId, id) DO UPDATE SET
         subject = excluded.subject,
         fromName = excluded.fromName,
         fromEmail = excluded.fromEmail,
         snippet = excluded.snippet,
         lastDate = excluded.lastDate,
         lastInternalDate = excluded.lastInternalDate,
         labelIds = excluded.labelIds,
         -- Le résumé partagé porte une date de dernier message différente de celle
         -- déjà mirrorée : un message est arrivé/reparti sans que ce détail le
         -- sache → on invalide "complete" pour forcer un refetch au lieu de servir
         -- un contenu périmé (cf. mailGetThread).
         messagesLoaded = CASE WHEN excluded.lastInternalDate <> mail_thread.lastInternalDate
                                THEN 0 ELSE mail_thread.messagesLoaded END,
         updatedAt = excluded.updatedAt`,
      [
        accountId,
        threadId,
        String(f["eac_subject"] ?? ""),
        String(f["eac_from_name"] ?? ""),
        String(f["eac_from_email"] ?? ""),
        String(f["eac_snippet"] ?? ""),
        String(f["eac_date"] ?? ""),
        Number(f["eac_internal_date"]) || 0,
        f["eac_label_ids"],
        Date.now(),
      ],
    );
  };

  const dropMirroredThread = (fieldsJson: unknown): void => {
    const f = parseFields(fieldsJson);
    const tid = f["eac_thread_id"];
    const acct = f["eac_account_email"];
    if (typeof tid !== "string" || typeof acct !== "string" || tid === MAIL_STATE_THREAD_ID) return;
    if (hasPendingMailOp(acct, tid)) return;
    db.run(`DELETE FROM mail_message WHERE accountId = ? AND threadId = ?`, [acct, tid]);
    db.run(`DELETE FROM mail_thread WHERE accountId = ? AND id = ?`, [acct, tid]);
  };

  const isHistoryId = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);

  const adoptSharedMailState = (accountId: string, f: Record<string, unknown>): void => {
    const ts = Date.now();
    const incoming = f["eac_history_id"];
    if (isHistoryId(incoming)) {
      const cur = row(db.exec(`SELECT historyId FROM mail_sync_state WHERE accountId = ?`, [accountId]))?.["historyId"];
      // Jamais reculer : un curseur plus ancien ferait relire des fils déjà vus.
      if (!isHistoryId(cur) || BigInt(incoming) > BigInt(cur)) {
        db.run(
          `INSERT INTO mail_sync_state (accountId, historyId, lastFullSyncAt, lastSyncAt, updatedAt)
           VALUES (?, ?, 0, ?, ?)
           ON CONFLICT(accountId) DO UPDATE SET
             historyId = excluded.historyId, lastSyncAt = excluded.lastSyncAt, updatedAt = excluded.updatedAt`,
          [accountId, incoming, ts, ts],
        );
      }
    }
    // Sans elle, un appareil nourri par le salon relirait toute la boîte (réconciliation 6 h) à sa première synchro.
    const fullAt = Number(f["eac_full_sync_at"]);
    if (fullAt > 0) {
      db.run(`UPDATE mail_sync_state SET lastFullSyncAt = MAX(lastFullSyncAt, ?) WHERE accountId = ?`, [fullAt, accountId]);
    }
    if (typeof f["eac_labels_json"] === "string") {
      const labels = parseFields(f["eac_labels_json"]);
      if (Array.isArray(labels)) replaceMailLabels(accountId, labels as MirrorLabel[], ts);
    }
  };

  const deleteEmailAiCacheEntity = (accountId: string, threadId: string): void => {
    const entityId = emailAiCacheEntityId(accountId, threadId);
    const existing = row(db.exec(`SELECT fields FROM entity WHERE id = ?`, [entityId]));
    if (!existing) return;
    db.run(`DELETE FROM entity WHERE id = ?`, [entityId]);
    tombstoneAdd(db, entityId);
    const previous = { id: entityId, typeId: EMAIL_AI_CACHE_TYPE_ID, fields: parseFields(existing["fields"]), sourceVaultId: null };
    try { hooks.onEntityDeleted?.(entityId, previous); } catch (e) { console.warn("[hook] onEntityDeleted (email_ai_cache)", e); }
  };

  const upsertSystemEntity = (
    target: { typeId: string; entityId: string; filePath: string; base: Record<string, unknown> },
    patch: Record<string, unknown>,
  ): void => {
    const { typeId, entityId, filePath, base } = target;
    const existing = row(db.exec(`SELECT id, fields FROM entity WHERE id = ?`, [entityId]));
    const ts = now();
    if (existing) {
      const oldFields: Record<string, unknown> = (() => {
        try { return JSON.parse((existing["fields"] as string) || "{}"); } catch { return {}; }
      })();
      // Chaque synchro republie toute la boîte : sans ce filtre, chaque tick
      // enverrait une op par fil et par appareil.
      if (Object.entries(patch).every(([k, v]) => oldFields[k] === v)) return;
      const merged = { ...oldFields, ...patch };
      db.run(
        `UPDATE entity SET fields = ?, updatedAt = ? WHERE id = ?`,
        [JSON.stringify(merged), ts, entityId],
      );
      const full = { id: entityId, typeId, fields: merged, updatedAt: ts };
      try { hooks.onEntityUpdated?.(full, { ...full, fields: oldFields }); } catch (e) { console.warn(`[hook] onEntityUpdated (${typeId})`, e); }
    } else {
      const fields: Record<string, unknown> = { ...base, ...patch };
      db.run(
        `INSERT OR IGNORE INTO entity
           (id, vaultId, typeId, filePath, fields, body, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
        [entityId, vaultId, typeId, filePath, JSON.stringify(fields), ts, ts],
      );
      const full = { id: entityId, typeId, typeName: typeId, fields, filePath, body: "", createdAt: ts, updatedAt: ts };
      try { hooks.onEntityCreated?.(full); } catch (e) { console.warn(`[hook] onEntityCreated (${typeId})`, e); }
    }
  };

  const upsertEmailAiCacheEntity = (
    accountId: string,
    threadId: string,
    patch: Record<string, unknown>,
  ): void =>
    upsertSystemEntity(
      {
        typeId: EMAIL_AI_CACHE_TYPE_ID,
        entityId: emailAiCacheEntityId(accountId, threadId),
        filePath: `@system/email-ai/${threadId}`,
        base: { eac_thread_id: threadId, eac_account_email: accountId },
      },
      patch,
    );

  const mailSetAiCategory = async (input: unknown): Promise<unknown> => {
    const { accountId, threadId, category, confidence, runs } = input as {
      accountId: string; threadId: string; category: string; confidence: number; runs: number;
    };
    if (!accountId || !threadId) return { ok: false };
    const ts = Date.now();
    db.run(
      `UPDATE mail_thread
         SET aiCategory = ?, aiCategoryConfidence = ?, aiCategoryRuns = ?, aiCategoryAt = ?
       WHERE accountId = ? AND id = ?`,
      [category, confidence, runs, ts, accountId, threadId],
    );
    upsertEmailAiCacheEntity(accountId, threadId, {
      eac_category: category,
      eac_category_confidence: confidence,
      eac_category_runs: runs,
      eac_category_at: ts,
    });
    return { ok: true };
  };

  const mailSetAiSummary = async (input: unknown): Promise<unknown> => {
    const { accountId, threadId, summary, fingerprint } = input as {
      accountId: string; threadId: string; summary: string; fingerprint: string;
    };
    if (!accountId || !threadId) return { ok: false };
    const ts = Date.now();
    db.run(
      `UPDATE mail_thread
         SET aiSummary = ?, aiSummaryFp = ?, aiSummaryAt = ?
       WHERE accountId = ? AND id = ?`,
      [summary, fingerprint, ts, accountId, threadId],
    );
    upsertEmailAiCacheEntity(accountId, threadId, {
      eac_summary: summary,
      eac_summary_fp: fingerprint,
      eac_summary_at: ts,
    });
    return { ok: true };
  };

  // Pas de dénormalisation dans mail_thread : un fil envoyé n'est pas dans le
  // miroir inbox, et email_ai_cache le ferait apparaître en boîte ailleurs.
  const mailSetCommitments = async (input: unknown): Promise<unknown> => {
    const { accountId, threadId, subject, items, fingerprint } = input as {
      accountId: string; threadId: string; subject: string; items: string; fingerprint: string;
    };
    if (!accountId || !threadId) return { ok: false };
    upsertSystemEntity(
      {
        typeId: MAIL_COMMITMENT_TYPE_ID,
        entityId: mailCommitmentEntityId(accountId, threadId),
        filePath: `@system/mail-commitments/${threadId}`,
        base: { mc_thread_id: threadId, mc_account_email: accountId },
      },
      { mc_subject: subject, mc_items: items, mc_fp: fingerprint, mc_at: Date.now() },
    );
    return { ok: true };
  };

  const mailGetAiCache = async (input: unknown): Promise<unknown> => {
    const { accountId, threadIds } = input as { accountId: string; threadIds: string[] };
    if (!accountId || !threadIds?.length) return { items: [] };
    const items: Array<Record<string, unknown>> = [];
    for (const tid of threadIds) {
      const r = row(db.exec(
        `SELECT aiCategory, aiCategoryConfidence, aiCategoryRuns, aiCategoryAt,
                aiSummary, aiSummaryFp, aiSummaryAt
           FROM mail_thread WHERE accountId = ? AND id = ?`,
        [accountId, tid],
      ));
      items.push({
        threadId: tid,
        aiCategory: r ? (r["aiCategory"] as string | null) ?? null : null,
        aiCategoryConfidence: r?.["aiCategoryConfidence"] != null ? Number(r["aiCategoryConfidence"]) : null,
        aiCategoryRuns: r?.["aiCategoryRuns"] != null ? Number(r["aiCategoryRuns"]) : null,
        aiCategoryAt: r?.["aiCategoryAt"] != null ? Number(r["aiCategoryAt"]) : null,
        aiSummary: r ? (r["aiSummary"] as string | null) ?? null : null,
        aiSummaryFp: r ? (r["aiSummaryFp"] as string | null) ?? null : null,
        aiSummaryAt: r?.["aiSummaryAt"] != null ? Number(r["aiSummaryAt"]) : null,
      });
    }
    return { items };
  };

  const mailSyncUpsert = async (input: unknown): Promise<unknown> => {
    const {
      accountId,
      threads,
      messages,
      labels,
      removeThreadIds,
      historyId,
      markFullSync,
    } = (input as {
      accountId: string;
      threads?: Array<{
        id: string;
        subject?: string;
        from?: { name?: string; email?: string };
        snippet?: string;
        date?: string;
        internalDate?: number;
        labelIds?: string[];
        historyId?: string;
      }>;
      messages?: Array<{
        threadId: string;
        labelIds: string[];
        items: Array<Record<string, unknown>>;
      }>;
      labels?: Array<{ id: string; name?: string; color?: { textColor: string; backgroundColor: string }; type?: string }>;
      removeThreadIds?: string[];
      historyId?: string;
      markFullSync?: boolean;
    }) ?? {};
    if (!accountId) return { threads: 0, messages: 0, removed: 0 };
    const ts = Date.now();
    // Batch entier en une transaction : le DELETE des messages d'un thread suivi
    // de leur ré-INSERT ne peut plus laisser un thread vidé sur disque si l'onglet
    // meurt au milieu, et on fait un seul commit au lieu d'un par statement.
    const result = runInTransaction(db, () => {
    let threadsUpserted = 0;
    let messagesUpserted = 0;
    let removed = 0;

    for (const t of threads ?? []) {
      // Un résumé (incrémental ou full sync) ne porte pas les messages : par
      // défaut messagesLoaded est préservé pour qu'un fil déjà complet garde ses
      // messages quand seul son résumé se rafraîchit. MAIS si la date du dernier
      // message du résumé diffère de celle déjà mirrorée, un message est
      // arrivé/reparti sans que le détail stocké le sache → on invalide
      // "complete" (cf. mailGetThread) pour forcer un refetch au lieu de servir
      // un fil périmé. ThreadListItem ne porte ni compte de messages ni
      // historyId par fil (`t.historyId` reste toujours null côté appelant) :
      // la date du dernier message est le seul signal disponible ici.
      db.run(
        `INSERT INTO mail_thread
           (accountId, id, historyId, subject, fromName, fromEmail, snippet, lastDate, lastInternalDate, labelIds, messagesLoaded, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(accountId, id) DO UPDATE SET
           historyId = excluded.historyId,
           subject = excluded.subject,
           fromName = excluded.fromName,
           fromEmail = excluded.fromEmail,
           snippet = excluded.snippet,
           lastDate = excluded.lastDate,
           lastInternalDate = excluded.lastInternalDate,
           labelIds = excluded.labelIds,
           messagesLoaded = CASE WHEN excluded.lastInternalDate <> mail_thread.lastInternalDate
                                  THEN 0 ELSE mail_thread.messagesLoaded END,
           updatedAt = excluded.updatedAt`,
        [
          accountId,
          t.id,
          t.historyId ?? null,
          t.subject ?? "",
          t.from?.name ?? "",
          t.from?.email ?? "",
          t.snippet ?? "",
          t.date ?? "",
          t.internalDate ?? 0,
          JSON.stringify(t.labelIds ?? []),
          ts,
        ],
      );
      threadsUpserted++;
    }

    for (const group of messages ?? []) {
      // Replace the thread's message set wholesale (Gmail returns the full thread).
      db.run(`DELETE FROM mail_message WHERE accountId = ? AND threadId = ?`, [
        accountId,
        group.threadId,
      ]);
      for (const m of group.items) {
        db.run(
          `INSERT INTO mail_message
             (accountId, id, threadId, subject, fromName, fromEmail, toJson, date, internalDate,
              snippet, bodyText, bodyHtml, attachmentsJson, messageId, refs, webLink, labelIds, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            accountId,
            m["id"] as string,
            group.threadId,
            (m["subject"] as string) ?? "",
            ((m["from"] as { name?: string } | undefined)?.name) ?? "",
            ((m["from"] as { email?: string } | undefined)?.email) ?? "",
            JSON.stringify(m["to"] ?? []),
            (m["date"] as string) ?? "",
            (m["internalDate"] as number) ?? 0,
            (m["snippet"] as string) ?? "",
            (m["bodyText"] as string) ?? "",
            (m["bodyHtml"] as string | undefined) ?? null,
            JSON.stringify(m["attachments"] ?? []),
            (m["messageId"] as string | undefined) ?? null,
            (m["references"] as string | undefined) ?? null,
            (m["webLink"] as string) ?? "",
            JSON.stringify(m["labelIds"] ?? []),
            ts,
          ],
        );
        messagesUpserted++;
      }
      // Mark the thread fully mirrored + refresh its union labels.
      db.run(
        `UPDATE mail_thread SET messagesLoaded = 1, labelIds = ?, updatedAt = ?
           WHERE accountId = ? AND id = ?`,
        [JSON.stringify(group.labelIds), ts, accountId, group.threadId],
      );
    }

    replaceMailLabels(accountId, labels ?? [], ts);

    for (const id of removeThreadIds ?? []) {
      db.run(`DELETE FROM mail_message WHERE accountId = ? AND threadId = ?`, [accountId, id]);
      db.run(`DELETE FROM mail_thread WHERE accountId = ? AND id = ?`, [accountId, id]);
      removed++;
    }

    if (historyId !== undefined || markFullSync) {
      const full = markFullSync ? ts : 0;
      db.run(
        `INSERT INTO mail_sync_state (accountId, historyId, lastFullSyncAt, lastSyncAt, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(accountId) DO UPDATE SET
           historyId = COALESCE(excluded.historyId, mail_sync_state.historyId),
           lastFullSyncAt = CASE WHEN ? > 0 THEN ? ELSE mail_sync_state.lastFullSyncAt END,
           lastSyncAt = excluded.lastSyncAt,
           updatedAt = excluded.updatedAt`,
        [accountId, historyId ?? null, full, ts, ts, full, full],
      );
    }

    return { threads: threadsUpserted, messages: messagesUpserted, removed };
    });

    // Fils avant curseur : un appareil qui adopte le curseur a déjà reçu les fils.
    runInTransaction(db, () => {
      for (const t of threads ?? []) {
        upsertEmailAiCacheEntity(accountId, t.id, {
          eac_subject: t.subject ?? "",
          eac_from_name: t.from?.name ?? "",
          eac_from_email: t.from?.email ?? "",
          eac_snippet: t.snippet ?? "",
          eac_date: t.date ?? "",
          eac_internal_date: t.internalDate ?? 0,
          eac_label_ids: JSON.stringify(t.labelIds ?? []),
        });
      }
      for (const id of removeThreadIds ?? []) deleteEmailAiCacheEntity(accountId, id);
      const state: Record<string, unknown> = {};
      if (historyId) state["eac_history_id"] = historyId;
      if (markFullSync) state["eac_full_sync_at"] = Date.now();
      if (labels?.length) state["eac_labels_json"] = JSON.stringify(labels);
      if (Object.keys(state).length > 0) upsertEmailAiCacheEntity(accountId, MAIL_STATE_THREAD_ID, state);
    });
    return result;
  };

  const mailApplyLocalMutation = async (input: unknown): Promise<unknown> => {
    const {
      accountId,
      opId,
      threadId,
      kind,
      addLabelIds = [],
      removeLabelIds = [],
      dropThread,
      enqueue = true,
    } = (input as {
      accountId: string;
      opId: string;
      threadId: string;
      kind: string;
      addLabelIds?: string[];
      removeLabelIds?: string[];
      dropThread?: boolean;
      enqueue?: boolean;
    }) ?? {};
    if (!accountId || !threadId || !opId) return { ok: false };
    const ts = Date.now();

    // Patch du miroir (thread + N messages) et enqueue outbox en une seule
    // transaction : l'atomicité annoncée dans les commentaires devient réelle.
    return runInTransaction(db, () => {
    if (dropThread) {
      db.run(`DELETE FROM mail_message WHERE accountId = ? AND threadId = ?`, [accountId, threadId]);
      db.run(`DELETE FROM mail_thread WHERE accountId = ? AND id = ?`, [accountId, threadId]);
    } else {
      const t = row(
        db.exec(`SELECT labelIds FROM mail_thread WHERE accountId = ? AND id = ?`, [accountId, threadId]),
      );
      if (t) {
        const next = patchLabels(parseStrArr(t["labelIds"]), addLabelIds, removeLabelIds);
        db.run(`UPDATE mail_thread SET labelIds = ?, updatedAt = ? WHERE accountId = ? AND id = ?`, [
          JSON.stringify(next),
          ts,
          accountId,
          threadId,
        ]);
      }
      const msgs = rows(
        db.exec(`SELECT id, labelIds FROM mail_message WHERE accountId = ? AND threadId = ?`, [
          accountId,
          threadId,
        ]),
      );
      for (const m of msgs) {
        const next = patchLabels(parseStrArr(m["labelIds"]), addLabelIds, removeLabelIds);
        db.run(`UPDATE mail_message SET labelIds = ?, updatedAt = ? WHERE accountId = ? AND id = ?`, [
          JSON.stringify(next),
          ts,
          accountId,
          m["id"] as string,
        ]);
      }
    }

    if (enqueue) {
      db.run(
        `INSERT INTO mail_outbox (opId, accountId, threadId, kind, payloadJson, createdAt, attempts, status)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'pending')
         ON CONFLICT(opId) DO UPDATE SET
           payloadJson = excluded.payloadJson, status = 'pending'`,
        [
          opId,
          accountId,
          threadId,
          kind,
          JSON.stringify({ addLabelIds, removeLabelIds, dropThread: !!dropThread }),
          ts,
        ],
      );
    }
    return { ok: true };
    });
  };

  const mailListOutbox = async (input: unknown): Promise<unknown> => {
    const { accountId } = (input as { accountId: string }) ?? {};
    if (!accountId) return { items: [] };
    const res = db.exec(
      `SELECT opId, threadId, kind, payloadJson, attempts, createdAt
         FROM mail_outbox WHERE accountId = ? AND status != 'failed'
        ORDER BY createdAt ASC`,
      [accountId],
    );
    const items = rows(res).map((r) => {
      const payload = (() => {
        try {
          return JSON.parse((r["payloadJson"] as string) || "{}") as {
            addLabelIds?: string[];
            removeLabelIds?: string[];
          };
        } catch {
          return {};
        }
      })();
      return {
        opId: r["opId"] as string,
        threadId: r["threadId"] as string,
        kind: r["kind"] as string,
        addLabelIds: Array.isArray(payload.addLabelIds) ? payload.addLabelIds : [],
        removeLabelIds: Array.isArray(payload.removeLabelIds) ? payload.removeLabelIds : [],
        attempts: Number(r["attempts"]) || 0,
        createdAt: Number(r["createdAt"]) || 0,
      };
    });
    return { items };
  };

  const mailResolveOutbox = async (input: unknown): Promise<unknown> => {
    const { opIds, outcome, error } = (input as {
      opIds: string[];
      outcome: "ack" | "fail";
      error?: string;
    }) ?? {};
    if (!Array.isArray(opIds) || opIds.length === 0) return { resolved: 0 };
    let resolved = 0;
    for (const opId of opIds) {
      if (outcome === "ack") {
        db.run(`DELETE FROM mail_outbox WHERE opId = ?`, [opId]);
      } else {
        db.run(
          `UPDATE mail_outbox SET attempts = attempts + 1,
             status = CASE WHEN attempts + 1 >= 5 THEN 'failed' ELSE 'pending' END,
             lastError = ? WHERE opId = ?`,
          [error ?? null, opId],
        );
      }
      resolved++;
    }
    return { resolved };
  };

  const mailRetryFailed = async (input: unknown): Promise<unknown> => {
    const { accountId } = (input as { accountId: string }) ?? {};
    if (!accountId) return { retried: 0 };
    const before = row(
      db.exec(
        `SELECT COUNT(*) AS c FROM mail_outbox WHERE accountId = ? AND status = 'failed'`,
        [accountId],
      ),
    );
    db.run(
      `UPDATE mail_outbox SET status = 'pending', attempts = 0, lastError = NULL
         WHERE accountId = ? AND status = 'failed'`,
      [accountId],
    );
    return { retried: before ? Number(before["c"]) : 0 };
  };

  return {
    routes: {
      "mail.listThreads": mailListThreads,
      "mail.searchThreads": mailSearchThreads,
      "mail.getThread": mailGetThread,
      "mail.getLabels": mailGetLabels,
      "mail.getState": mailGetState,
      "mail.setAiCategory": mailSetAiCategory,
      "mail.setAiSummary": mailSetAiSummary,
      "mail.setCommitments": mailSetCommitments,
      "mail.getAiCache": mailGetAiCache,
      "mail.syncUpsert": mailSyncUpsert,
      "mail.applyLocalMutation": mailApplyLocalMutation,
      "mail.listOutbox": mailListOutbox,
      "mail.resolveOutbox": mailResolveOutbox,
      "mail.retryFailed": mailRetryFailed,
    },
    mirror: { MAIL_STATE_THREAD_ID, dropMirroredThread, adoptSharedMailState, upsertSharedMailThread },
  };
}
