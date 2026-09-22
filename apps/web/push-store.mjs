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
