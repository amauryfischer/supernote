/**
 * automation-resolvers — wraps the existing worker-router dispatch table
 * so AutomationEngine can mutate vault state through the same code paths
 * used by tRPC mutations (preserves FTS sync, file write, tag apply, etc.).
 *
 * Also owns persistence of run results to the `automation_run` table and
 * dispatch of in-app notifications back to the UI thread via postMessage.
 */

import type { Database } from "./sqlite-adapter";
import type {
  AppNotification,
  AutomationRunResult,
  EngineResolvers,
  MailDraft,
} from "@supernote/automations";
import type { Entity as CoreEntity, FieldValue as CoreFieldValue } from "@supernote/core/types";
import type { Entity as IpcEntity, FieldValue as IpcFieldValue } from "@supernote/ipc";
import type { RouteHandler } from "./worker-router";

function ipcToCoreEntity(ipc: IpcEntity): CoreEntity {
  return {
    id: ipc.id,
    typeId: ipc.typeId,
    filePath: ipc.filePath,
    fields: ipc.fields as Record<string, CoreFieldValue>,
    body: ipc.body ?? "",
    createdAt: new Date(ipc.createdAt),
    updatedAt: new Date(ipc.updatedAt),
    tags: ipc.tags,
  };
}

function fieldsAsIpc(fields: Record<string, unknown>): Record<string, IpcFieldValue> {
  const out: Record<string, IpcFieldValue> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v as IpcFieldValue;
    } else if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      out[k] = v as string[];
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

export interface BuildResolversOptions {
  db: Database;
  router: Record<string, RouteHandler>;
  postMessage: (msg: unknown) => void;
}

export interface EngineResolversWithListRuns extends EngineResolvers {
  listRuns(automationId: string, limit?: number): AutomationRunResult[];
}

export function buildEngineResolvers(opts: BuildResolversOptions): EngineResolversWithListRuns {
  const { db, router, postMessage } = opts;

  async function callRouter<T>(path: string, input: unknown): Promise<T> {
    const handler = router[path];
    if (!handler) throw new Error(`router missing: ${path}`);
    return (await handler(input)) as T;
  }

  return {
    queryEntities: async (typeId: string): Promise<CoreEntity[]> => {
      const result = await callRouter<{ items: IpcEntity[] }>("entities.list", {
        typeId,
        limit: 1000,
      });
      return (result.items ?? []).map(ipcToCoreEntity);
    },

    getEntity: async (id: string): Promise<CoreEntity | null> => {
      try {
        const ipc = await callRouter<IpcEntity>("entities.get", { id });
        return ipcToCoreEntity(ipc);
      } catch {
        return null;
      }
    },

    createEntity: async (typeId, fields, tags) => {
      const ipc = await callRouter<IpcEntity>("entities.create", {
        typeId,
        fields: fieldsAsIpc(fields),
        tags,
      });
      return ipcToCoreEntity(ipc);
    },

    updateEntity: async (id, patch) => {
      const ipc = await callRouter<IpcEntity>("entities.update", {
        id,
        fields: fieldsAsIpc(patch),
      });
      return ipcToCoreEntity(ipc);
    },

    deleteEntity: async (id) => {
      await callRouter<unknown>("entities.delete", { id });
    },

    createRelation: async () => {
      throw new Error("createRelation: not implemented in browser worker");
    },

    deleteRelation: async () => {
      throw new Error("deleteRelation: not implemented in browser worker");
    },

    notify: (n: AppNotification) => {
      postMessage({
        type: "AUTOMATION_NOTIFICATION",
        notification: {
          title: n.title,
          body: n.body,
          level: n.level ?? "info",
          timestamp: n.timestamp.toISOString(),
        },
      });
    },

    createMailDraft: async (draft: MailDraft) => {
      console.warn("[automation] create-mail-draft action not supported in browser yet", draft);
    },

    persistRun: async (run: AutomationRunResult) => {
      db.run(
        `INSERT INTO automation_run
          (id, automationId, status, triggerPayload, actionResults, errorMessage, durationMs, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          run.id,
          run.automationId,
          run.status,
          run.triggerPayload != null ? JSON.stringify(run.triggerPayload) : null,
          JSON.stringify(run.actionResults ?? []),
          run.errorMessage ?? null,
          run.durationMs,
          run.createdAt.toISOString(),
        ],
      );
    },

    listRuns: (automationId: string, limit = 10): AutomationRunResult[] => {
      const res = db.exec(
        `SELECT id, automationId, status, triggerPayload, actionResults, errorMessage, durationMs, createdAt
          FROM automation_run
          WHERE automationId = ?
          ORDER BY createdAt DESC
          LIMIT ?`,
        [automationId, limit],
      );
      if (!res.length || !res[0]) return [];
      const { columns, values } = res[0];
      return values.map((v) => {
        const r = Object.fromEntries(columns.map((c, i) => [c, v[i] ?? null]));
        let triggerPayload: unknown = null;
        try {
          triggerPayload = r["triggerPayload"]
            ? JSON.parse(r["triggerPayload"] as string)
            : null;
        } catch {
          triggerPayload = null;
        }
        let actionResults: AutomationRunResult["actionResults"] = [];
        try {
          actionResults = JSON.parse((r["actionResults"] as string) || "[]");
        } catch {
          actionResults = [];
        }
        return {
          id: r["id"] as string,
          automationId: r["automationId"] as string,
          status: r["status"] as AutomationRunResult["status"],
          triggerPayload,
          actionResults,
          errorMessage: (r["errorMessage"] as string | null) ?? undefined,
          durationMs: Number(r["durationMs"] ?? 0),
          createdAt: new Date(r["createdAt"] as string),
        };
      });
    },
  };
}
