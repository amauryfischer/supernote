/**
 * vault-worker — Web Worker entry point for PWA mode.
 *
 * Responsibilities:
 * - Accept INIT_VAULT message with FSA handle (idempotent — repeat calls
 *   for the same handle just re-emit VAULT_READY)
 * - Initialize sqlite-wasm with the official OPFS SAH pool VFS. The DB lives
 *   inside the SAH pool; the vault folder receives a mirrored byte copy at
 *   `.supernote/index.db` after every mutation so it stays Git-syncable.
 * - Apply schema (idempotent), including FTS5 (the official build ships it).
 * - Expose tRPC-like router via postMessage
 * - Persist (mirror to FSA) before acknowledging every mutation (no debounce)
 *   and serialize concurrent persists through `persistChain` so FSA writable
 *   streams don't race.
 * - Accept FLUSH bootstrap message to force a synchronous persist on
 *   navigation / page-hide
 * - Poll for file changes every 30s (fallback for FileSystemObserver)
 */

/// <reference lib="webworker" />

import { openDatabase, clearOpfsDb as clearOpfsDbViaPool, type Database } from "./sqlite-adapter";
import { SCHEMA_SQL } from "./db-schema";
import { saveDbToFsa, hydrateOpfsFromFsaIfNeeded, deleteFsaMirror } from "./db-persistence";
import { seedDefaults } from "./seed-default-types";
import { buildRouter, RouteHandler, type RouterLifecycleHooks } from "./worker-router";
import { migrateCanvasesToExcalidraw } from "./migration-canvas-excalidraw";
import {
  AutomationEngine,
  getPrevCronDate,
  type DomainEvent,
  type DomainEventType,
  type AutomationConfig,
  type ConditionEvaluator,
} from "@supernote/automations";
import { parseFormula, evaluate as evaluateFormula } from "@supernote/formulas";
import { buildEngineResolvers, type EngineResolversWithListRuns } from "./automation-resolvers";
import {
  routineRowToAutomationConfig,
  routineRowToAutomationConfigDetailed,
  ROUTINE_TYPE_ID,
} from "./automation-adapter";
import { buildVaultFormulaContext, makeVariableResolver } from "./variables";
import type {
  WorkerInboundMessage,
  WorkerRequest,
  InitVaultMessage,
} from "./worker-protocol";

// ── Debug log forwarding ──────────────────────────────────────────────────────
// Web Worker console messages don't always reach the main DevTools console
// (and never reach MCP browser tooling), so we mirror every console.info /
// warn / error onto the main thread via postMessage with a `__log` envelope.
// Wrapped once at module init; idempotent because `wrapped` short-circuits.
{
  const origInfo = console.info;
  const origWarn = console.warn;
  const origError = console.error;
  const forward = (level: string, args: unknown[]) => {
    try {
      const text = args
        .map((a) => {
          if (typeof a === "string") return a;
          // DOMException / Error stringify as `{}` via JSON — surface the
          // useful bits explicitly so the main thread sees what failed.
          if (a instanceof Error) {
            return `${a.name}: ${a.message}${a.stack ? "\n" + a.stack : ""}`;
          }
          try { return JSON.stringify(a); } catch { return String(a); }
        })
        .join(" ");
      self.postMessage({ __log: `[${level}] ${text}` });
    } catch {
      /* never crash worker for logging */
    }
  };
  console.info = (...args: unknown[]) => { forward("info", args); return origInfo.apply(console, args); };
  console.warn = (...args: unknown[]) => { forward("warn", args); return origWarn.apply(console, args); };
  console.error = (...args: unknown[]) => { forward("error", args); return origError.apply(console, args); };
}

// ── State ─────────────────────────────────────────────────────────────────────

let db: Database | null = null;
let vaultHandle: FileSystemDirectoryHandle | null = null;
let vaultId: string | null = null;
let vaultName: string | null = null;
let rootPath: string | null = null;
let router: Record<string, RouteHandler> = {};
let pollTimer: ReturnType<typeof setInterval> | null = null;
let automationEngine: AutomationEngine | null = null;
let engineResolvers: EngineResolversWithListRuns | null = null;
// Tracks the currently in-flight persist so concurrent mutations queue up
// behind it instead of racing the FSA writable. Initial value is a resolved
// promise so the first awaiter just falls through.
let persistChain: Promise<void> = Promise.resolve();

// ── DB init ───────────────────────────────────────────────────────────────────

async function initSqlite(handle: FileSystemDirectoryHandle): Promise<Database> {
  // Hydrate the OPFS SAH pool from the vault folder's mirror copy on first
  // launch (fresh device, new browser profile, …). No-op when the SAH pool
  // already has a DB — that's the authoritative copy.
  //
  // On vault switch (resetStorage:true) we DO still hydrate — the new
  // vault's mirror is the authoritative source of its own state. Phantom
  // pollution left by pre-fix sessions (entries pointing at files that
  // aren't on disk in this vault) is reconciled by the background
  // `vault.reindex` sweep after VAULT_READY.
  console.info("[init.sqlite] hydrateOpfsFromFsaIfNeeded…");
  await hydrateOpfsFromFsaIfNeeded(handle);

  console.info("[init.sqlite] openDatabase (OPFS SAH pool VFS)");
  const database = await openDatabase();

  // Migration: drop legacy `entity_fts` virtual table (single `body` column,
  // bound to entity via `content="entity"` + 3 triggers) when its shape
  // doesn't match the new external-content schema (id/title/body/tags/path).
  // Done BEFORE running SCHEMA_SQL so the new CREATE VIRTUAL TABLE IF NOT
  // EXISTS actually creates the new table. After the drop, the FTS index is
  // empty — the router rebuilds it from `entity` rows at buildRouter time.
  try {
    const ftsCols = database.exec(`PRAGMA table_info("entity_fts")`);
    if (ftsCols.length > 0) {
      const colNames = ftsCols[0]!.values.map((row) => row[1] as string);
      const hasNewShape =
        colNames.includes("title") &&
        colNames.includes("path") &&
        colNames.includes("tags");
      if (!hasNewShape) {
        console.info("[init.sqlite] migrating entity_fts to multi-column shape");
        database.run(`
          DROP TRIGGER IF EXISTS entity_fts_ai;
          DROP TRIGGER IF EXISTS entity_fts_ad;
          DROP TRIGGER IF EXISTS entity_fts_au;
          DROP TABLE IF EXISTS entity_fts;
        `);
      }
    }
  } catch (e) {
    console.warn("[vault-worker] entity_fts migration failed (non-fatal)", e);
  }

  // Migration: "view" table was redesigned for the Bases feature.
  // Old schema had (entityTypeId, config, isDefault); new schema requires
  // typeId NOT NULL plus filters/sorts/visibleFields/etc.
  // CREATE TABLE IF NOT EXISTS won't add columns, so detect the old schema
  // by checking for the missing typeId column and drop+recreate.
  try {
    const cols = database.exec(`PRAGMA table_info("view")`);
    const hasTypeId =
      cols.length > 0 &&
      cols[0]!.values.some((row) => row[1] === "typeId");
    if (!hasTypeId) {
      console.info("[init.sqlite] migrating view table to Bases schema");
      database.run(`DROP TABLE IF EXISTS "view";`);
    }
  } catch (e) {
    console.warn("[vault-worker] view table migration failed (non-fatal)", e);
  }

  // Migration: ajoute les colonnes summarize / conditionalFormats / chartConfig /
  // formConfig à "view" si elles manquent (sans drop, données préservées).
  try {
    const cols = database.exec(`PRAGMA table_info("view")`);
    const names: string[] =
      cols.length > 0 ? cols[0]!.values.map((row) => row[1] as string) : [];
    const add = (col: string, ddl: string) => {
      if (!names.includes(col)) {
        try {
          database.run(`ALTER TABLE "view" ADD COLUMN ${ddl};`);
        } catch (e) {
          console.warn(`[vault-worker] view.${col} add column failed`, e);
        }
      }
    };
    add("summarize", `"summarize" TEXT NOT NULL DEFAULT '{}'`);
    add("conditionalFormats", `"conditionalFormats" TEXT NOT NULL DEFAULT '[]'`);
    add("chartConfig", `"chartConfig" TEXT`);
    add("formConfig", `"formConfig" TEXT`);
    add("timelineConfig", `"timelineConfig" TEXT`);
  } catch (e) {
    console.warn("[vault-worker] view columns migration failed (non-fatal)", e);
  }

  console.info("[init.sqlite] running SCHEMA_SQL (base + FTS5)");
  database.run(SCHEMA_SQL);
  console.info("[init.sqlite] done");
  return database;
}

const TODO_TYPE_ID = "todo";

function reminderAutomationId(todoId: string): string {
  return `reminder:${todoId}`;
}

/**
 * Build a one-shot AutomationConfig for a todo's reminder. Returns null when
 * the todo has no pending reminder (reminderAt absent, in the past with
 * reminderFiredAt set, or malformed). The engine is then in charge of firing
 * + auto-unregistering at `fireAt`.
 */
function buildReminderAutomation(
  todo: { id: string; fields: Record<string, unknown> },
): AutomationConfig | null {
  const f = todo.fields ?? {};
  const reminderAt = typeof f["reminderAt"] === "string" ? (f["reminderAt"] as string).trim() : "";
  if (!reminderAt) return null;
  const firedAt = typeof f["reminderFiredAt"] === "string" ? (f["reminderFiredAt"] as string).trim() : "";
  if (firedAt) return null;
  const todoText = typeof f["text"] === "string" ? (f["text"] as string) : "Todo";
  const customText = typeof f["reminderText"] === "string" ? (f["reminderText"] as string).trim() : "";
  const body = customText || `Rappel : ${todoText}`;
  return {
    id: reminderAutomationId(todo.id),
    kind: "ROUTINE",
    name: `Rappel todo ${todoText.slice(0, 60)}`,
    enabled: true,
    trigger: {
      type: "one-shot",
      fireAt: reminderAt,
      sourceEntityId: todo.id,
    },
    actions: [
      {
        type: "notify-app",
        title: "Rappel todo",
        body,
        level: "info",
      },
      {
        type: "notify-os",
        title: "Rappel todo",
        body,
      },
    ],
  };
}

function registerTodoReminderEntity(entity: { id: string; typeId: string; fields: Record<string, unknown> }): void {
  if (!automationEngine) return;
  if (entity.typeId !== TODO_TYPE_ID) return;
  const cfg = buildReminderAutomation(entity);
  const autoId = reminderAutomationId(entity.id);
  if (!cfg) {
    automationEngine.unregisterAutomation(autoId);
    return;
  }
  try {
    automationEngine.registerAutomation(cfg);
  } catch (e) {
    console.warn("[engine] register reminder failed", entity.id, e);
  }
}

function unregisterTodoReminderEntity(todoId: string): void {
  automationEngine?.unregisterAutomation(reminderAutomationId(todoId));
}

function registerRoutineEntity(entity: { id: string; typeId: string; fields: Record<string, unknown> }): void {
  if (!automationEngine) return;
  if (entity.typeId !== ROUTINE_TYPE_ID) return;
  const cfg = routineRowToAutomationConfig({ id: entity.id, fields: entity.fields });
  if (!cfg) {
    automationEngine.unregisterAutomation(entity.id);
    return;
  }
  try {
    automationEngine.registerAutomation(cfg);
  } catch (e) {
    console.warn("[engine] registerAutomation failed", entity.id, e);
  }
}

function emitDomainEvent(
  type: DomainEventType,
  entity: { id: string; typeId: string; fields: Record<string, unknown> } | null,
  previous?: { id: string; typeId: string; fields: Record<string, unknown> } | null,
): void {
  if (!automationEngine) return;
  const evt: DomainEvent = {
    type,
    entityId: entity?.id ?? previous?.id,
    entityTypeId: entity?.typeId ?? previous?.typeId,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entity: entity as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    previous: previous as any,
    timestamp: new Date(),
  };
  void automationEngine.emitEvent(evt).catch((err) => {
    console.warn("[engine] emitEvent failed", type, err);
  });
}

/**
 * Catch-up policy on engine boot: for every enabled cron routine, look at the
 * most recent expected fire time strictly before `now`. If no persisted run
 * exists for that automation OR the last persisted run is older than the
 * previous cron occurrence, fire the routine ONCE with a `catchUp` payload.
 *
 * Intentionally fires *only* the latest missed occurrence, not the full
 * backlog — a routine scheduled hourly should not replay 168 times after a
 * week-long absence. The `catchUp` marker lets actions (and downstream
 * persistence) distinguish a recovered run from an in-window tick.
 */
async function runCatchUpCron(database: Database, configs: AutomationConfig[]): Promise<void> {
  if (!automationEngine) return;
  const now = new Date();
  for (const cfg of configs) {
    if (!cfg.enabled) continue;
    if (cfg.trigger.type !== "cron") continue;
    const prev = getPrevCronDate(cfg.trigger, now);
    if (!prev) continue;

    const lastRunRes = database.exec(
      `SELECT createdAt FROM automation_run WHERE automationId = ? ORDER BY createdAt DESC LIMIT 1`,
      [cfg.id],
    );
    const lastRunIso = lastRunRes[0]?.values?.[0]?.[0] as string | undefined;
    const lastRun = lastRunIso ? new Date(lastRunIso) : null;
    if (lastRun && lastRun.getTime() >= prev.getTime()) continue;

    try {
      await automationEngine.runOnce(cfg.id, {
        trigger: { type: "cron", firedAt: prev, catchUp: true },
        catchUp: true,
        missedAt: prev,
      });
      console.info("[engine] catch-up fired", { id: cfg.id, missedAt: prev.toISOString() });
    } catch (e) {
      console.warn("[engine] catch-up failed", cfg.id, e);
    }
  }
}

/**
 * Re-fetch a routine entity from the DB and register its config with the
 * engine. Returns true on successful registration, false when the row is
 * missing or the config fails validation. Diagnostic logs are emitted on
 * the failure path so the user (and the audit) can pinpoint why a routine
 * the UI shows as enabled never reaches the engine map.
 */
async function reregisterRoutineFromDb(
  id: string,
): Promise<{ ok: boolean; reason?: string; issues?: Array<{ path: string; code: string; message: string }> }> {
  if (!automationEngine || !db || !vaultId) return { ok: false, reason: "engine non initialisé" };
  const res = db.exec(
    `SELECT id, typeId, fields FROM entity WHERE id = ? AND vaultId = ? AND typeId = ?`,
    [id, vaultId, ROUTINE_TYPE_ID],
  );
  if (!res.length || !res[0]?.values?.length) {
    console.warn("[engine] re-register: routine row not found", { id });
    return { ok: false, reason: "entité routine introuvable en DB" };
  }
  const { columns, values } = res[0];
  const r = Object.fromEntries(columns.map((c, i) => [c, values[0]![i] ?? null]));
  let fields: Record<string, unknown> = {};
  try {
    fields = JSON.parse((r["fields"] as string) || "{}") as Record<string, unknown>;
  } catch (e) {
    console.warn("[engine] re-register: fields blob parse failed", { id, err: e });
    return { ok: false, reason: "fields blob JSON.parse a échoué" };
  }
  const diag = routineRowToAutomationConfigDetailed({ id: r["id"] as string, fields });
  if (!diag.config) {
    console.warn("[engine] re-register: invalid config", {
      id,
      reason: diag.reason,
      issues: diag.issues,
      sampleFields: {
        hasTrigger: typeof fields["trigger"],
        hasActions: typeof fields["actions"],
        actionsLength: typeof fields["actions"] === "string"
          ? (() => { try { const a = JSON.parse(fields["actions"] as string); return Array.isArray(a) ? a.length : "not-array"; } catch { return "parse-fail"; } })()
          : "not-string",
        cron: fields["cron"],
        enabled: fields["enabled"],
      },
    });
    return { ok: false, reason: diag.reason, issues: diag.issues };
  }
  try {
    automationEngine.registerAutomation(diag.config);
    console.info("[engine] re-registered routine on demand", { id });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[engine] re-register: registerAutomation threw", { id, err: e });
    return { ok: false, reason: `registerAutomation: ${msg}` };
  }
}

const SYSTEM_BIRTHDAY_TEMPLATE_KEY = "system:birthday-reminders";

/**
 * Idempotently insert a default "Rappel anniversaires" routine entity on
 * first boot. The marker is `templateKey = system:birthday-reminders`. Once
 * the user has deleted it explicitly we don't re-create it on the next boot
 * — we'd lose their decision. Tracked via a `setting` row.
 */
async function seedSystemRoutines(database: Database, vId: string): Promise<void> {
  try {
    const seededFlag = database.exec(
      `SELECT value FROM setting WHERE vaultId = ? AND key = ?`,
      [vId, "system.routines.birthdaySeeded"],
    );
    if (seededFlag[0]?.values?.length) return;

    const existing = database.exec(
      `SELECT id FROM entity WHERE vaultId = ? AND typeId = ?
         AND fields LIKE ? LIMIT 1`,
      [vId, ROUTINE_TYPE_ID, `%"templateKey":"${SYSTEM_BIRTHDAY_TEMPLATE_KEY}"%`],
    );
    if (!existing[0]?.values?.length) {
      const handler = router["entities.create"];
      if (!handler) {
        console.warn("[seed] entities.create handler missing — birthday routine skipped");
        return;
      }
      const trigger = {
        type: "alarm",
        entityTypeId: "personne",
        dateField: "birthday",
        offset: "0",
        timezone: "Europe/Paris",
        recurAnnually: true,
      };
      const actions = [
        {
          type: "notify-app",
          title: "Anniversaire aujourd'hui",
          body: "{{entity.fields.name}} fête son anniversaire aujourd'hui.",
          level: "info",
        },
        {
          type: "notify-os",
          title: "Anniversaire aujourd'hui",
          body: "{{entity.fields.name}} fête son anniversaire aujourd'hui.",
        },
      ];
      await handler({
        typeId: ROUTINE_TYPE_ID,
        fields: {
          name: "Rappel anniversaires",
          description: "Notification le jour des anniversaires des contacts",
          enabled: true,
          templateKey: SYSTEM_BIRTHDAY_TEMPLATE_KEY,
          trigger: JSON.stringify(trigger),
          actions: JSON.stringify(actions),
          conditions: "",
          cron: "",
        },
      });
      console.info("[seed] system birthday routine inserted");
    }

    // Mark as seeded so we don't re-insert after explicit deletion.
    const ts = new Date().toISOString();
    database.run(
      `INSERT OR REPLACE INTO setting (id, vaultId, key, value, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?)`,
      [`${vId}:system.routines.birthdaySeeded`, vId, "system.routines.birthdaySeeded", "1", ts, ts],
    );
  } catch (err) {
    console.warn("[seed] seedSystemRoutines failed (non-fatal)", err);
  }
}

async function bootAutomationEngine(database: Database, vId: string): Promise<void> {
  try {
    const { context: baseFormulaContext, baseScope } = buildVaultFormulaContext(database, vId);
    engineResolvers = buildEngineResolvers({
      db: database,
      router,
      postMessage: (msg) => self.postMessage(msg),
    });
    const consoleLogger = {
      info: (o: object | string, m?: string) => console.info("[automation]", m ?? "", o),
      warn: (o: object | string, m?: string) => console.warn("[automation]", m ?? "", o),
      error: (o: object | string, m?: string) => console.error("[automation]", m ?? "", o),
      debug: (o: object | string, m?: string) => console.debug("[automation]", m ?? "", o),
    };

    // Plug @supernote/formulas as the condition evaluator: parse the user's
    // expression once, evaluate with the vault's full scope (every base
    // exposed by name + plural, every global variable through the resolver).
    // Returns `unknown` so the engine's `Boolean(result)` cast decides the
    // truthiness. Errors are caught upstream by evaluateCondition().
    const conditionEvaluator: ConditionEvaluator = (expr, _ctx) => {
      const parsed = parseFormula(expr);
      if (!parsed.ok) throw new Error(`parse: ${parsed.error.message}`);
      const fullCtx = {
        ...baseFormulaContext,
        resolveVariable: makeVariableResolver(database, baseFormulaContext, new Set(), baseScope),
      };
      const res = evaluateFormula(parsed.value, fullCtx, baseScope);
      if (!res.ok) throw new Error(`eval: ${res.error.message}`);
      return res.value;
    };

    automationEngine = new AutomationEngine({
      formulaContext: baseFormulaContext as Record<string, unknown>,
      resolvers: engineResolvers,
      logger: consoleLogger,
      evaluator: conditionEvaluator,
    });

    // When a one-shot reminder fires, stamp `reminderFiredAt` on the source
    // todo so a worker reboot doesn't re-register + re-fire it.
    automationEngine.on("one-shot-fired", (_automationId, sourceEntityId) => {
      if (!sourceEntityId) return;
      const handler = router["entities.update"];
      if (!handler) return;
      void handler({
        id: sourceEntityId,
        fields: { reminderFiredAt: new Date().toISOString() },
      }).catch((err) => {
        console.warn("[engine] mark reminderFiredAt failed", sourceEntityId, err);
      });
    });

    // Seed the default system routines (idempotent) BEFORE loading routines
    // from DB. Currently only the contact birthday alarm — adds itself once
    // per vault, then the user can edit / disable it like any routine. Marker
    // is `templateKey === "system:birthday-reminders"`.
    await seedSystemRoutines(database, vId);

    const routineRows = database.exec(
      `SELECT id, fields FROM entity WHERE vaultId = ? AND typeId = ?`,
      [vId, ROUTINE_TYPE_ID],
    );
    const registered: AutomationConfig[] = [];
    if (routineRows.length && routineRows[0]) {
      const { columns, values } = routineRows[0];
      for (const v of values) {
        const r = Object.fromEntries(columns.map((c, i) => [c, v[i] ?? null]));
        let fields: Record<string, unknown> = {};
        try {
          fields = JSON.parse((r["fields"] as string) || "{}") as Record<string, unknown>;
        } catch {
          fields = {};
        }
        const cfg = routineRowToAutomationConfig({ id: r["id"] as string, fields });
        if (cfg) {
          try {
            automationEngine.registerAutomation(cfg);
            registered.push(cfg);
          } catch (e) { console.warn("[engine] register on boot failed", r["id"], e); }
        } else {
          console.warn("[engine] routine skipped on boot — invalid config", {
            id: r["id"],
            name: fields["name"],
            hasTrigger: typeof fields["trigger"],
            hasActions: typeof fields["actions"],
            cron: fields["cron"],
          });
        }
      }
    }

    await runCatchUpCron(database, registered);

    // Boot scan for pending todo reminders. Each todo with `reminderAt` set
    // and `reminderFiredAt` empty becomes a one-shot AutomationConfig. The
    // first scheduler tick (or immediate tickNow on Periodic Sync) fires any
    // overdue reminders and auto-unregisters them.
    try {
      const todoRows = database.exec(
        `SELECT id, fields FROM entity WHERE vaultId = ? AND typeId = ?`,
        [vId, TODO_TYPE_ID],
      );
      if (todoRows.length && todoRows[0]) {
        const { columns, values } = todoRows[0];
        let count = 0;
        for (const v of values) {
          const r = Object.fromEntries(columns.map((c, i) => [c, v[i] ?? null]));
          let fields: Record<string, unknown> = {};
          try {
            fields = JSON.parse((r["fields"] as string) || "{}") as Record<string, unknown>;
          } catch {
            fields = {};
          }
          const cfg = buildReminderAutomation({ id: r["id"] as string, fields });
          if (!cfg) continue;
          try {
            automationEngine.registerAutomation(cfg);
            count++;
          } catch (e) {
            console.warn("[engine] register reminder on boot failed", r["id"], e);
          }
        }
        if (count > 0) console.info(`[engine] ${count} reminder(s) registered on boot`);
      }
    } catch (e) {
      console.warn("[engine] reminder boot scan failed", e);
    }

    // Wire dispatch entries that talk to the engine — declared here so they
    // share the `engine` + `resolvers` references via closure.
    const resolvers = engineResolvers;
    router["routines.run"] = async (input) => {
      const { id } = input as { id: string; payload?: unknown };
      if (!automationEngine) throw new Error("Automation engine not initialized");
      // Lazy re-registration: a routine may have been created on a previous
      // worker bootstrap (before engine wiring existed) or registration may
      // have silently failed at boot (config invalid at that time, validator
      // race, etc.). Look up the entity and re-register before running so
      // the user-visible "Run" button never hits "Automation not found".
      let result: import("@supernote/automations").AutomationRunResult;
      try {
        result = await automationEngine.runOnce(id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/Automation not found/i.test(msg)) throw err;
        const diag = await reregisterRoutineFromDb(id);
        if (!diag.ok) {
          const issuesStr = diag.issues?.length
            ? ` (${diag.issues.map((i) => `${i.path}: ${i.message}`).join("; ")})`
            : "";
          throw new Error(
            `Routine ${id} non exécutable — ${diag.reason ?? "raison inconnue"}${issuesStr}`,
          );
        }
        result = await automationEngine.runOnce(id);
      }
      return {
        id: result.id,
        automationId: result.automationId,
        status: result.status,
        triggerPayload: result.triggerPayload ?? null,
        actionResults: result.actionResults,
        errorMessage: result.errorMessage,
        durationMs: result.durationMs,
        createdAt: result.createdAt.toISOString(),
      };
    };

    router["routines.getRuns"] = async (input) => {
      const { automationId, limit } = input as { automationId: string; limit?: number };
      const runs = resolvers.listRuns(automationId, limit ?? 10);
      return {
        items: runs.map((r) => ({
          id: r.id,
          automationId: r.automationId,
          status: r.status,
          triggerPayload: r.triggerPayload ?? null,
          actionResults: r.actionResults,
          errorMessage: r.errorMessage,
          durationMs: r.durationMs,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    };
    router["routines.getNextRuns"] = async (input) => {
      const { id, count } = input as { id: string; count?: number };
      if (!automationEngine) return [];
      const all = await automationEngine.getNextRuns(id);
      return all.slice(0, count ?? 5).map((n) => n.nextRunAt.toISOString());
    };

    await automationEngine.start();
  } catch (err) {
    console.error("[engine] boot failed (non-fatal, routines disabled)", err);
    automationEngine = null;
  }
}

async function persistDb(): Promise<void> {
  if (!db || !vaultHandle) {
    console.warn(
      `[persist] persistDb skipped — db=${!!db} vaultHandle=${!!vaultHandle}. Bytes NOT written.`,
    );
    return;
  }
  try {
    // OPFS persistence is automatic via the SAH pool VFS — every COMMIT
    // already lands on disk. We only mirror to FSA here so the vault folder
    // stays Git-syncable and portable across devices.
    await saveDbToFsa(vaultHandle);
  } catch (err) {
    console.error("[vault-worker] persist failed — FSA mirror NOT updated", err);
  }
}

/**
 * Persist immediately (no debounce) and serialize through `persistChain`
 * so back-to-back mutations don't race the FSA writable stream. We deliberately
 * do NOT debounce: a 500ms window meant a navigation right after an entity
 * create could re-INIT the worker and reload an empty DB before the write
 * landed. FSA writes are async + small, so the cost of writing on every
 * mutation is negligible compared to losing data.
 */
function schedulePersist(): Promise<void> {
  const next = persistChain.then(() => persistDb());
  // Swallow rejection so the chain doesn't poison subsequent persists.
  persistChain = next.catch(() => undefined);
  return next;
}

/** Force-flush any pending persist and wait for it to complete. */
async function flushPersist(): Promise<void> {
  await schedulePersist();
}

// ── Vault init ────────────────────────────────────────────────────────────────

async function isSameVaultHandle(
  current: FileSystemDirectoryHandle | null,
  next: FileSystemDirectoryHandle,
): Promise<boolean> {
  if (!current) return false;
  // Cheap pre-check first: name must match.
  if (current.name !== next.name) return false;
  // FSA exposes isSameEntry — preferred when available.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (current as any).isSameEntry;
  if (typeof fn === "function") {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (current as any).isSameEntry(next);
    } catch {
      return false;
    }
  }
  // Fallback: identity / name equality already passed.
  return current === next;
}

async function handleInitVault(
  handle: FileSystemDirectoryHandle,
  resetStorage: boolean = false,
): Promise<void> {
  try {
    // Idempotency: if the same vault is already initialized, just re-emit
    // VAULT_READY and bail. Without this, every navigation re-fires INIT
    // which reloads the DB from FSA — a debounced persist that hadn't
    // flushed yet would be silently dropped, making freshly created
    // entities disappear.
    //
    // `resetStorage` short-circuits the idempotency path: a vault switch
    // explicitly demands a wipe even if (by some coincidence) the handle
    // looks identical.
    if (!resetStorage && db && vaultId && (await isSameVaultHandle(vaultHandle, handle))) {
      console.info("[init] reusing existing vault", handle.name, "vaultId=", vaultId);
      self.postMessage({
        type: "VAULT_READY",
        vaultId,
        vaultName: vaultName ?? handle.name,
        rootPath: rootPath ?? handle.name,
      });
      return;
    }

    console.info("[init] full re-init from FSA, handle.name=", handle.name, "resetStorage=", resetStorage);
    vaultHandle = handle;

    if (resetStorage) {
      // Vault switch: tear down the previous DB and unlink the SAH-backed
      // OPFS file through the pool API (the pool owns the locks, so this
      // succeeds where a main-thread `removeEntry` on `.supernote-vfs`
      // would silently fail). After this, `hydrateOpfsFromFsaIfNeeded`
      // sees an empty OPFS and seeds from the NEW vault's FSA mirror —
      // or starts blank when the new folder is fresh.
      if (db) {
        try {
          db.close();
        } catch (err) {
          console.warn("[init] db.close() before reset failed (non-fatal)", err);
        }
        db = null;
      }
      // Drop module-scope state from the previous vault so nothing stale
      // leaks into the new init (router, engine, ids, …).
      vaultId = null;
      vaultName = null;
      rootPath = null;
      router = {};
      automationEngine = null;
      engineResolvers = null;
      try {
        await clearOpfsDbViaPool();
        console.info("[init] resetStorage: OPFS DB unlinked via SAH pool");
      } catch (err) {
        console.warn("[init] resetStorage: OPFS unlink failed (non-fatal)", err);
      }
      // Also delete the FSA-side mirror so we don't re-hydrate a pre-fix
      // polluted copy on the next initSqlite call. The clean DB we're about
      // to build will be persisted back to FSA, restoring a coherent
      // mirror. Any legitimate entity data is rebuilt by the reindex sweep
      // from the actual `.md` / `.excalidraw` files on disk (their YAML
      // frontmatter preserves stable IDs, so no real data is lost).
      try {
        await deleteFsaMirror(handle);
      } catch (err) {
        console.warn("[init] resetStorage: deleteFsaMirror failed (non-fatal)", err);
      }
    }

    console.info("[init] step=initSqlite");
    db = await initSqlite(handle);
    console.info("[init] step=initSqlite done");
    // Sanity: how many rows are in `entity` right after load? If this is 0
    // after a previous create+reload cycle, persistence is broken.
    try {
      const sanity = db.exec(`SELECT COUNT(*) as c FROM entity`);
      const total =
        sanity.length && sanity[0]?.values?.[0]?.[0] != null
          ? Number(sanity[0]!.values[0]![0])
          : 0;
      console.info(`[init] sanity: entity table has ${total} row(s) total after initSqlite`);
    } catch (err) {
      console.warn("[init] sanity check failed", err);
    }
    console.info("[vault-worker] sqlite ready");

    // Get or create vault record
    vaultName = handle.name;
    rootPath = handle.name; // FSA doesn't expose full path

    const existingVault = db.exec(`SELECT id FROM vault LIMIT 1`);
    const ts = new Date().toISOString();
    if (existingVault.length && existingVault[0]?.values.length) {
      vaultId = existingVault[0].values[0]![0] as string;
    } else {
      // Create a unique vault ID using timestamp + random
      vaultId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.toUpperCase();
      db.run(
        `INSERT INTO vault (id, name, rootPath, isActive, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)`,
        [vaultId, vaultName, rootPath, ts, ts],
      );
    }

    console.info("[init] step=seedDefaults");
    seedDefaults(db, vaultId, ts);

    // Lifecycle hooks bridge entity CRUD → automation engine: every
    // entity.created/updated/deleted is broadcast so event-triggered
    // automations can fire, and routine-entity changes re-sync the
    // registered AutomationConfig set.
    const hooks: RouterLifecycleHooks = {
      onEntityCreated: (entity) => {
        const e = entity as { id: string; typeId: string; fields: Record<string, unknown> } | null;
        if (!e) return;
        registerRoutineEntity(e);
        registerTodoReminderEntity(e);
        emitDomainEvent("entity.created", e);
      },
      onEntityUpdated: (entity, previous) => {
        const e = entity as { id: string; typeId: string; fields: Record<string, unknown> } | null;
        const p = previous as { id: string; typeId: string; fields: Record<string, unknown> } | null;
        if (!e) return;
        registerRoutineEntity(e);
        registerTodoReminderEntity(e);
        emitDomainEvent("entity.updated", e, p);
      },
      onEntityDeleted: (id, previous) => {
        const p = previous as { id: string; typeId: string; fields: Record<string, unknown> } | null;
        if (p?.typeId === ROUTINE_TYPE_ID) automationEngine?.unregisterAutomation(id);
        if (p?.typeId === TODO_TYPE_ID) unregisterTodoReminderEntity(id);
        emitDomainEvent("entity.deleted", null, p);
      },
    };

    console.info("[init] step=buildRouter");
    router = buildRouter(db, handle, vaultId, hooks);
    console.info("[init] step=buildRouter done");

    console.info("[init] step=bootEngine");
    await bootAutomationEngine(db, vaultId);
    console.info("[init] step=bootEngine done");

    // Diagnostic: how many entities did we just load from disk?
    let loadedCount = 0;
    try {
      const countRes = db.exec(`SELECT COUNT(*) as c FROM entity WHERE vaultId = ?`, [vaultId]);
      loadedCount =
        countRes.length && countRes[0]?.values?.[0]?.[0] != null
          ? Number(countRes[0]!.values[0]![0])
          : 0;
      console.info("[init] loaded", loadedCount, "entities from FSA for vault", vaultId);
    } catch {
      // Diagnostic only — never fail init for this
    }

    // Persist initial state — saves the (possibly empty) DB so a second
    // tab / reload doesn't see "uninitialised" if the user navigates fast.
    console.info("[init] step=persistDb (initial)");
    await persistDb();
    console.info("[init] step=persistDb done");

    // Start polling for file changes (30s interval)
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => void reindexIfNeeded(), 30_000);

    console.info("[vault-worker] VAULT_READY about to post", { vaultId, vaultName });
    self.postMessage({
      type: "VAULT_READY",
      vaultId,
      vaultName,
      rootPath,
    });

    // Background reindex — always runs after init so user-supplied files
    // dropped into the vault folder (orphan `.md` without Supernote
    // frontmatter, standalone `.excalidraw`, etc.) get surfaced in the UI
    // even when the DB already had rows. `reindexVault` is dedup-safe: it
    // skips any filePath already present and never overwrites Supernote-
    // native files (those keep their declared id/type).
    //
    // Runs OUT-OF-BAND so it can't block VAULT_READY, and emits
    // INDEX_PROGRESS so the UI sees entities populate live.
    void (async () => {
      try {
        const reindex = router["vault.reindex"];
        if (!reindex) return;
        const result = (await reindex(undefined)) as { indexed?: number; removed?: number };
        const indexed = result?.indexed ?? 0;
        const removed = result?.removed ?? 0;
        if (indexed > 0) {
          if (loadedCount === 0) {
            console.info(
              `[init] empty DB recovered from disk: reindexed ${indexed} entit(y/ies) from vault files`,
            );
          } else {
            console.info(
              `[init] adopted ${indexed} orphan file(s) discovered in the vault folder`,
            );
          }
        }
        if (removed > 0) {
          console.info(
            `[init] swept ${removed} phantom entit(y/ies) whose filePath is not on disk`,
          );
        }
        if (indexed > 0 || removed > 0) {
          // Persist the recovered/adopted/swept state immediately so a refresh
          // doesn't have to wait for the 30 s poll cycle.
          await schedulePersist();
          self.postMessage({ type: "INDEX_PROGRESS", indexed, total: indexed });
        }
        await runCanvasMigration();
      } catch (err) {
        console.warn("[init] background reindex failed (non-fatal)", err);
      }
    })();

    async function runCanvasMigration() {
      if (!db || !vaultId) return;
      try {
        const n = await migrateCanvasesToExcalidraw({ db, vaultHandle: handle, vaultId });
        if (n > 0) {
          console.info(`[init] migrated ${n} canvas(es) to .excalidraw sibling`);
          await schedulePersist();
        }
      } catch (err) {
        console.warn("[init] canvas excalidraw migration failed (non-fatal)", err);
      }
    }
  } catch (err) {
    console.error("[vault-worker] init failed", err);
    self.postMessage({
      type: "VAULT_ERROR",
      error: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
    });
  }
}

// ── Polling reindex ───────────────────────────────────────────────────────────

async function reindexIfNeeded(): Promise<void> {
  if (!router["vault.reindex"]) return;
  try {
    const result = await router["vault.reindex"]!(undefined);
    const { indexed } = result as { indexed: number };
    if (indexed > 0) {
      void schedulePersist();
      self.postMessage({ type: "INDEX_PROGRESS", indexed, total: indexed });
    }
  } catch {
    // Non-fatal
  }
}

// ── Message routing ───────────────────────────────────────────────────────────

async function handleRpcRequest(msg: WorkerRequest): Promise<void> {
  const { id, path, input } = msg;

  if (!db || !vaultId) {
    self.postMessage({ id, ok: false, error: "Vault not initialized" });
    return;
  }

  const handler = router[path];
  if (!handler) {
    self.postMessage({ id, ok: false, error: `Unknown procedure: ${path}` });
    return;
  }

  try {
    const result = await handler(input);
    // For mutations, persist BEFORE acknowledging the response. This guarantees
    // the caller can safely navigate away the moment they receive `ok: true`
    // — the bytes are already on disk (FSA + OPFS).
    //
    // Defensive: also persist for any route name that *looks* like a write
    // (create/add/update/delete/set/remove/rename) regardless of the
    // declared msg.type. This protects against tRPC misconfigurations
    // (e.g. a write surfaced as `.query()` upstream) silently dropping
    // user data on navigation.
    const looksLikeMutation = /\.(create|add|update|delete|set|remove|rename|reindex)(\.|$)/i.test(
      `.${path}.`,
    );
    if (msg.type === "mutation" || looksLikeMutation) {
      await schedulePersist();
    }
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleFlush(id: string): Promise<void> {
  try {
    await flushPersist();
    self.postMessage({ id, ok: true, result: null });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Event listener ────────────────────────────────────────────────────────────

self.addEventListener("message", (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;
  if (!msg) return;

  if ("type" in msg && msg.type === "INIT_VAULT") {
    const initMsg = msg as InitVaultMessage;
    void handleInitVault(initMsg.handle, initMsg.resetStorage === true);
    return;
  }
  if ("type" in msg && msg.type === "FLUSH") {
    void handleFlush((msg as { id: string }).id);
    return;
  }
  if ("type" in msg && msg.type === "AUTOMATION_TICK") {
    void handleAutomationTick();
    return;
  }
  void handleRpcRequest(msg as WorkerRequest);
});

async function handleAutomationTick(): Promise<void> {
  if (!automationEngine || !db || !vaultId) return;
  try {
    await automationEngine.tickNow();
    // Also re-run catch-up: a long background sleep may have skipped one full
    // cron occurrence even between two ticks, so a defensive pass keeps the
    // "last missed occurrence" guarantee intact.
    const routineRows = db.exec(
      `SELECT id, fields FROM entity WHERE vaultId = ? AND typeId = ?`,
      [vaultId, ROUTINE_TYPE_ID],
    );
    const configs: AutomationConfig[] = [];
    if (routineRows.length && routineRows[0]) {
      const { columns, values } = routineRows[0];
      for (const v of values) {
        const r = Object.fromEntries(columns.map((c, i) => [c, v[i] ?? null]));
        let fields: Record<string, unknown> = {};
        try { fields = JSON.parse((r["fields"] as string) || "{}"); } catch { fields = {}; }
        const cfg = routineRowToAutomationConfig({ id: r["id"] as string, fields });
        if (cfg) configs.push(cfg);
      }
    }
    await runCatchUpCron(db, configs);
    void schedulePersist();
  } catch (e) {
    console.warn("[engine] tick handler failed", e);
  }
}
