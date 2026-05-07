// ============================================================
// AutomationEngine — main orchestrator
// ============================================================

import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import pino from "pino";
import type {
  AutomationConfig,
  AutomationEngineOptions,
  AutomationRunResult,
  DomainEvent,
  FormulaContext,
  Logger,
  NextRun,
} from "../types/index.js";
import { AutomationConfigSchema } from "../types/schemas.js";
import { eventMatchesTrigger } from "../triggers/event.js";
import { getNextCronDate, cronShouldFireAt } from "../triggers/cron.js";
import { extractDateField, alarmShouldFireAt } from "../triggers/alarm.js";
import { evaluateCondition, type FormulaEvaluator } from "./condition.js";
import { runAction } from "./runner.js";
import type { TemplateVars } from "../templates/index.js";

type EngineEvents = {
  "run-started": [automationId: string, runId: string];
  "run-completed": [result: AutomationRunResult];
  "run-failed": [automationId: string, error: Error];
};

export class AutomationEngine extends EventEmitter<EngineEvents> {
  private readonly automations = new Map<string, AutomationConfig>();
  private readonly opts: AutomationEngineOptions;
  private readonly logger: Logger;
  private readonly now: () => Date;
  private schedulerHandle: ReturnType<typeof setInterval> | null = null;

  constructor(opts: AutomationEngineOptions) {
    super();
    this.opts = opts;
    this.logger = opts.logger ?? pino({ name: "automations" });
    this.now = opts.now ?? (() => new Date());
  }

  registerAutomation(automation: AutomationConfig): void {
    const parsed = AutomationConfigSchema.safeParse(automation);
    if (!parsed.success) {
      throw new Error(`Invalid automation config: ${parsed.error.message}`);
    }
    this.automations.set(automation.id, automation);
    this.logger.info({ id: automation.id, name: automation.name }, "Automation registered");
  }

  unregisterAutomation(id: string): void {
    this.automations.delete(id);
    this.logger.info({ id }, "Automation unregistered");
  }

  async emitEvent(event: DomainEvent): Promise<void> {
    const candidates = [...this.automations.values()].filter(
      (a) => a.enabled && a.trigger.type === "event"
    );
    for (const automation of candidates) {
      if (automation.trigger.type !== "event") continue;
      if (!eventMatchesTrigger(event, automation.trigger)) continue;
      const ctx = this.buildFormulaContext({ trigger: event, entity: event.entity });
      const conditionPasses = evaluateCondition(
        automation.condition,
        ctx,
        undefined,
        this.logger
      );
      if (!conditionPasses) continue;
      await this.executeAutomation(automation, { trigger: event, entity: event.entity });
    }
  }

  async start(): Promise<void> {
    const TICK_MS = 60_000;
    this.schedulerHandle = setInterval(() => void this.tick(), TICK_MS);
    this.logger.info("AutomationEngine started");
  }

  async stop(): Promise<void> {
    if (this.schedulerHandle) {
      clearInterval(this.schedulerHandle);
      this.schedulerHandle = null;
    }
    this.logger.info("AutomationEngine stopped");
  }

  async runOnce(automationId: string, payload?: unknown): Promise<AutomationRunResult> {
    const automation = this.automations.get(automationId);
    if (!automation) throw new Error(`Automation not found: ${automationId}`);
    return this.executeAutomation(automation, payload ?? {});
  }

  async getNextRuns(automationId?: string): Promise<NextRun[]> {
    const candidates = automationId
      ? [this.automations.get(automationId)].filter(Boolean) as AutomationConfig[]
      : [...this.automations.values()];

    const now = this.now();
    const results: NextRun[] = [];

    for (const automation of candidates) {
      if (!automation.enabled) continue;
      const trigger = automation.trigger;
      if (trigger.type === "cron") {
        try {
          const nextRunAt = getNextCronDate(trigger, now);
          results.push({ automationId: automation.id, automationName: automation.name, nextRunAt });
        } catch {
          // skip invalid cron
        }
      }
    }
    return results;
  }

  /** Called every minute by the scheduler to fire cron/alarm triggers. */
  private async tick(): Promise<void> {
    const now = this.now();
    for (const automation of this.automations.values()) {
      if (!automation.enabled) continue;
      const trigger = automation.trigger;

      if (trigger.type === "cron" && cronShouldFireAt(trigger, now)) {
        await this.executeAutomation(automation, { trigger: { type: "cron", firedAt: now } });
      } else if (trigger.type === "alarm") {
        await this.fireAlarmIfDue(automation, now);
      }
    }
  }

  private async fireAlarmIfDue(automation: AutomationConfig, now: Date): Promise<void> {
    const trigger = automation.trigger;
    if (trigger.type !== "alarm") return;

    const entities = await this.opts.resolvers.queryEntities(trigger.entityTypeId);
    for (const entity of entities) {
      const dateValue = entity.fields[trigger.dateField];
      const parsedDate = extractDateField(dateValue);
      if (!parsedDate) continue;
      if (alarmShouldFireAt(parsedDate, trigger, now)) {
        await this.executeAutomation(automation, { trigger, entity, firedAt: now });
      }
    }
  }

  private buildFormulaContext(vars: TemplateVars): FormulaContext {
    return {
      ...this.opts.formulaContext,
      ...vars,
      now: this.now(),
    };
  }

  private async executeAutomation(
    automation: AutomationConfig,
    payload: unknown
  ): Promise<AutomationRunResult> {
    const runId = nanoid();
    const startedAt = Date.now();

    this.emit("run-started", automation.id, runId);
    this.logger.info({ automationId: automation.id, runId }, "Run started");

    const vars = payload as TemplateVars;
    const ctx = this.buildFormulaContext(vars);

    const conditionPasses = evaluateCondition(
      automation.condition,
      ctx,
      undefined,
      this.logger
    );

    if (!conditionPasses) {
      const result: AutomationRunResult = {
        id: runId,
        automationId: automation.id,
        status: "SKIPPED",
        triggerPayload: payload,
        actionResults: [],
        durationMs: Date.now() - startedAt,
        createdAt: new Date(),
      };
      await this.opts.resolvers.persistRun(result);
      return result;
    }

    const actionResults = [];
    for (const action of automation.actions) {
      const result = await runAction(
        action,
        vars,
        ctx,
        this.opts.resolvers,
        this.logger
      );
      actionResults.push(result);
    }

    const anyFailed = actionResults.some((r) => !r.success);
    const status = anyFailed ? "FAILURE" : "SUCCESS";

    const runResult: AutomationRunResult = {
      id: runId,
      automationId: automation.id,
      status,
      triggerPayload: payload,
      actionResults,
      durationMs: Date.now() - startedAt,
      createdAt: new Date(),
    };

    await this.opts.resolvers.persistRun(runResult);
    this.emit("run-completed", runResult);
    this.logger.info({ automationId: automation.id, runId, status }, "Run completed");

    return runResult;
  }
}
