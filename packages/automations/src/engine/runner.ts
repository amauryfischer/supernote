// ============================================================
// Action runner — executes a single ActionConfig with resolvers
// ============================================================

import { nanoid } from "nanoid";
import type {
  ActionConfig,
  ActionResult,
  ActionType,
  AppNotification,
  EngineResolvers,
  FormulaContext,
  Logger,
  MailDraft,
} from "../types/index.js";
import { renderTemplate as _renderTemplate, renderConfigStrings, type TemplateVars } from "../templates/index.js";
import type { TemplateEngineOptions } from "../templates/index.js";
import { runScript } from "../actions/script-runner.js";

function timer(): () => number {
  const start = Date.now();
  return () => Date.now() - start;
}

/**
 * Render all string fields in an action config using template vars.
 */
function renderAction(
  config: ActionConfig,
  vars: TemplateVars,
  ctx: FormulaContext,
  opts: TemplateEngineOptions
): ActionConfig {
  const { type, ...rest } = config;
  const rendered = renderConfigStrings(rest as Record<string, unknown>, vars, ctx, opts);
  return { type, ...rendered } as ActionConfig;
}

export async function runAction(
  action: ActionConfig,
  vars: TemplateVars,
  ctx: FormulaContext,
  resolvers: EngineResolvers,
  logger: Logger,
  opts: TemplateEngineOptions = {}
): Promise<ActionResult> {
  const elapsed = timer();
  const rendered = renderAction(action, vars, ctx, opts);

  try {
    const output = await executeAction(rendered, resolvers, logger);
    return {
      actionType: action.type as ActionType,
      success: true,
      output,
      durationMs: elapsed(),
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error({ action: action.type, error }, "Action failed");
    return {
      actionType: action.type as ActionType,
      success: false,
      error,
      durationMs: elapsed(),
    };
  }
}

async function executeAction(
  action: ActionConfig,
  resolvers: EngineResolvers,
  logger: Logger
): Promise<unknown> {
  switch (action.type) {
    case "create-mail-draft": {
      const draft: MailDraft = {
        to: [action.to],
        cc: action.cc ? [action.cc] : undefined,
        bcc: action.bcc ? [action.bcc] : undefined,
        subject: action.subject,
        body: action.body,
        attachments: action.attachments,
      };
      await resolvers.createMailDraft(draft);
      return { draftCreated: true };
    }

    case "create-entity": {
      const entity = await resolvers.createEntity(action.typeId, action.fields, action.tags);
      return { entityId: entity.id };
    }

    case "update-entity": {
      const entity = await resolvers.updateEntity(action.entityId, action.patch);
      return { entityId: entity.id };
    }

    case "create-relation": {
      const edge = await resolvers.createRelation(
        action.sourceId,
        action.targetId,
        action.relationTypeId,
        action.fields
      );
      return { edgeId: edge.id };
    }

    case "notify-os": {
      const notification: AppNotification = {
        title: action.title,
        body: action.body,
        level: "info",
        timestamp: new Date(),
      };
      resolvers.notify(notification);
      return { notified: true };
    }

    case "notify-app": {
      const notification: AppNotification = {
        title: action.title,
        body: action.body,
        level: action.level ?? "info",
        timestamp: new Date(),
      };
      resolvers.notify(notification);
      return { notified: true };
    }

    case "webhook": {
      const fetch = resolvers.httpFetch ?? globalThis.fetch;
      const response = await fetch(action.url, {
        method: action.method ?? "POST",
        headers: {
          "Content-Type": "application/json",
          ...action.headers,
        },
        body: action.body,
      });
      return { status: response.status, ok: response.ok };
    }

    case "llm-prompt": {
      if (!resolvers.llmPrompt) {
        logger.warn({ action: "llm-prompt" }, "LLM resolver not configured, skipping");
        return { skipped: true, reason: "llm-prompt not configured" };
      }
      const result = await resolvers.llmPrompt(action.prompt);
      return { result };
    }

    case "run-script": {
      const result = runScript(action.script, {}, action.timeout);
      return result;
    }

    case "create-inbox-note": {
      const entity = await resolvers.createEntity(
        "inbox",
        { title: action.title, body: action.body },
        action.tags
      );
      return { entityId: entity.id };
    }

    default: {
      const _exhaustive: never = action;
      throw new Error(`Unknown action type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
