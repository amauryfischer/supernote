/**
 * AutomationsRuntime — per-vault lifecycle manager for AutomationEngine.
 *
 * Responsibilities:
 *  - Build EngineResolvers that delegate to the Prisma client.
 *  - Load automation YAML configs from <vault>/.supernote/automations/.
 *  - Register configs and start/stop the engine when a vault opens/closes.
 *  - Provide createMailDraft via OS-native mechanisms.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { shell } from "electron";
import jsYaml from "js-yaml";
import { ulid } from "ulid";
import { AutomationEngine } from "@supernote/automations";
import type {
  AutomationConfig,
  AutomationRunResult,
  EngineResolvers,
  MailDraft,
  AppNotification,
} from "@supernote/automations";
import type { Entity, RelationEdge } from "@supernote/core";
import type { PrismaClient } from "@supernote/db";
import type { NotificationsService } from "@supernote/notifications/dist/main/service";
import { logger } from "../logger.js";

const execFileAsync = promisify(execFile);

const SUPERNOTE_DIR = ".supernote";
const AUTOMATIONS_DIR = "automations";

// ── Mail draft helpers ──────────────────────────────────────────────────────

function buildMailtoUrl(draft: MailDraft): string {
  const params = new URLSearchParams();
  if (draft.cc?.length) params.set("cc", draft.cc.join(","));
  if (draft.bcc?.length) params.set("bcc", draft.bcc.join(","));
  if (draft.subject) params.set("subject", draft.subject);
  if (draft.body) params.set("body", draft.body);
  return `mailto:${draft.to.join(",")}?${params.toString()}`;
}

function appleMailScript(draft: MailDraft): string {
  const to = draft.to.map((a) => `"${a}"`).join(", ");
  const cc = draft.cc?.length ? `make new to recipient at end of to recipients with properties {address:"${draft.cc.join(",")}"}\n` : "";
  return [
    `tell application "Mail"`,
    `  set newMessage to make new outgoing message with properties {subject:"${draft.subject}", content:"${draft.body}"}`,
    `  tell newMessage`,
    `    make new to recipient at end of to recipients with properties {address:${to}}`,
    cc,
    `  end tell`,
    `  activate`,
    `end tell`,
  ].join("\n");
}

function outlookScript(draft: MailDraft): string {
  return [
    `$outlook = New-Object -ComObject Outlook.Application`,
    `$mail = $outlook.CreateItem(0)`,
    `$mail.To = "${draft.to.join(";")}"`,
    `$mail.CC = "${(draft.cc ?? []).join(";")}"`,
    `$mail.Subject = "${draft.subject}"`,
    `$mail.Body = "${draft.body}"`,
    `$mail.Display()`,
  ].join("; ");
}

async function createMailDraft(draft: MailDraft): Promise<void> {
  if (process.platform === "darwin") {
    await execFileAsync("osascript", ["-e", appleMailScript(draft)]);
  } else if (process.platform === "win32") {
    await execFileAsync("powershell", ["-Command", outlookScript(draft)]);
  } else {
    await shell.openExternal(buildMailtoUrl(draft));
  }
}

// ── Ollama LLM helper ──────────────────────────────────────────────────────

async function probeLlmPrompt(): Promise<((prompt: string) => Promise<string>) | undefined> {
  try {
    const resp = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(2_000),
    });
    if (!resp.ok) return undefined;
    logger.info("AutomationsRuntime: Ollama detected, llmPrompt resolver enabled");
    return async (prompt: string): Promise<string> => {
      const res = await fetch("http://localhost:11434/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "llama3", prompt, stream: false }),
      });
      if (!res.ok) throw new Error(`Ollama generate failed: ${res.status}`);
      const data = (await res.json()) as { response?: string };
      return data.response ?? "";
    };
  } catch {
    return undefined;
  }
}

// ── Prisma-backed resolvers ────────────────────────────────────────────────

function buildResolvers(
  prisma: PrismaClient,
  vaultId: string,
  notifications: NotificationsService | null,
  llmPrompt: ((prompt: string) => Promise<string>) | undefined,
): EngineResolvers {
  return {
    queryEntities: async (typeId, filter) => {
      const where: Record<string, unknown> = { vaultId, typeId };
      if (filter) Object.assign(where, filter);
      const rows = await prisma.entity.findMany({ where });
      return rows.map((r: unknown) => dbRowToEntity(r as DbEntityRow));
    },

    getEntity: async (id) => {
      const row = await prisma.entity.findUnique({ where: { id } });
      return row ? dbRowToEntity(row as DbEntityRow) : null;
    },

    createEntity: async (typeId, fields, tags) => {
      const id = ulid();
      const now = new Date();
      const row = await prisma.entity.create({
        data: {
          id,
          vaultId,
          typeId,
          filePath: "",
          fields: JSON.stringify(fields),
          body: "",
          fileHash: null,
        },
      });
      const entity = dbRowToEntity(row as DbEntityRow);
      if (tags?.length) {
        logger.debug("AutomationsRuntime.createEntity: tags ignored (not yet implemented)", { id });
      }
      void now; // suppress unused warning
      return entity;
    },

    updateEntity: async (id, patch) => {
      const existing = await prisma.entity.findUnique({ where: { id } });
      if (!existing) throw new Error(`Entity not found: ${id}`);
      const existingRow = existing as DbEntityRow;
      const currentFields = safeParseJson(existingRow.fields);
      const merged = { ...currentFields, ...patch };
      const row = await prisma.entity.update({
        where: { id },
        data: { fields: JSON.stringify(merged), updatedAt: new Date() },
      });
      return dbRowToEntity(row as DbEntityRow);
    },

    deleteEntity: async (id) => {
      await prisma.entity.delete({ where: { id } });
    },

    createRelation: async (sourceId, targetId, relationTypeId, fields) => {
      const id = ulid();
      const now = new Date();
      await prisma.relationEdge.create({
        data: {
          id,
          sourceId,
          targetId,
          relationTypeId,
          fields: JSON.stringify(fields ?? {}),
        },
      });
      const edge: RelationEdge = { id, sourceId, targetId, relationTypeId, fields: fields as RelationEdge["fields"], createdAt: now };
      return edge;
    },

    deleteRelation: async (id) => {
      await prisma.relationEdge.delete({ where: { id } });
    },

    notify: (notification: AppNotification) => {
      if (!notifications) {
        logger.warn("AutomationsRuntime.notify: no NotificationsService available");
        return;
      }
      const rawLevel = notification.level ?? "info";
      // NotificationLevel uses "danger" instead of "error"
      const level = rawLevel === "error" ? "danger" as const : rawLevel;
      void notifications
        .show({
          id: ulid(),
          level,
          title: notification.title,
          body: notification.body,
          source: "automation",
          createdAt: (notification.timestamp ?? new Date()).toISOString(),
          os: true,
        })
        .catch((err: unknown) => {
          logger.error("AutomationsRuntime.notify failed", { err: String(err) });
        });
    },

    persistRun: async (run: AutomationRunResult) => {
      try {
        await prisma.automationRun.create({
          data: {
            id: run.id,
            automationId: run.automationId,
            status: run.status,
            triggerPayload: JSON.stringify(run.triggerPayload),
            actionResults: JSON.stringify(run.actionResults),
            errorMessage: run.errorMessage,
            durationMs: run.durationMs,
            createdAt: run.createdAt,
          },
        });
      } catch (err) {
        logger.warn("AutomationsRuntime.persistRun failed (non-fatal)", { err: String(err) });
      }
    },

    createMailDraft,
    llmPrompt,
    httpFetch: globalThis.fetch,
  };
}

// ── YAML loader ────────────────────────────────────────────────────────────

function loadAutomationYamls(vaultPath: string): AutomationConfig[] {
  const automationsDir = path.join(vaultPath, SUPERNOTE_DIR, AUTOMATIONS_DIR);
  if (!fs.existsSync(automationsDir)) return [];

  const files = fs.readdirSync(automationsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  const configs: AutomationConfig[] = [];

  for (const file of files) {
    const filePath = path.join(automationsDir, file);
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = jsYaml.load(raw);
      configs.push(parsed as AutomationConfig);
    } catch (err) {
      logger.warn("AutomationsRuntime: failed to parse automation YAML", {
        file,
        err: String(err),
      });
    }
  }

  logger.info("AutomationsRuntime: loaded automation configs", { count: configs.length, vaultPath });
  return configs;
}

// ── DB row helpers ─────────────────────────────────────────────────────────

interface DbEntityRow {
  id: string;
  typeId: string;
  filePath: string;
  fields: string;
  body: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function dbRowToEntity(row: DbEntityRow): Entity {
  return {
    id: row.id,
    typeId: row.typeId,
    filePath: row.filePath,
    fields: safeParseJson(row.fields) as Entity["fields"],
    body: row.body ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── AutomationsRuntime ─────────────────────────────────────────────────────

export class AutomationsRuntime {
  private engine: AutomationEngine | null = null;

  async startForVault(
    vault: { id: string; path: string },
    prisma: PrismaClient,
    notifications: NotificationsService | null,
  ): Promise<AutomationEngine> {
    // Probe Ollama availability (non-fatal)
    const llmPrompt = await probeLlmPrompt().catch(() => undefined);
    const resolvers = buildResolvers(prisma, vault.id, notifications, llmPrompt);

    this.engine = new AutomationEngine({
      formulaContext: { vaultId: vault.id, vaultPath: vault.path },
      resolvers,
    });

    // Load and register automations from YAML files
    const configs = loadAutomationYamls(vault.path);
    for (const config of configs) {
      try {
        this.engine.registerAutomation(config);
      } catch (err) {
        logger.warn("AutomationsRuntime: failed to register automation", {
          id: (config as { id?: string }).id,
          err: String(err),
        });
      }
    }

    await this.engine.start();
    logger.info("AutomationsRuntime started", { vaultId: vault.id, automations: configs.length });
    return this.engine;
  }

  async stopForVault(): Promise<void> {
    if (this.engine) {
      await this.engine.stop();
      this.engine = null;
    }
    logger.info("AutomationsRuntime stopped");
  }

  getEngine(): AutomationEngine | null {
    return this.engine;
  }
}
