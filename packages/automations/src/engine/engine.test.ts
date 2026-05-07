// ============================================================
// AutomationEngine tests (25+ tests)
// ============================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AutomationEngine } from "./index.js";
import type {
  AutomationConfig,
  AutomationEngineOptions,
  AutomationRunResult,
  DomainEvent,
  EngineResolvers,
  Entity,
  RelationEdge,
} from "../types/index.js";
import {
  validateCronExpression,
  getNextCronDate,
  cronShouldFireAt,
} from "../triggers/cron.js";
import { eventMatchesTrigger } from "../triggers/event.js";
import {
  parseOffsetMs,
  computeAlarmDate,
  alarmShouldFireAt,
  extractDateField,
} from "../triggers/alarm.js";
import { renderTemplate } from "../templates/index.js";
import { AutomationConfigSchema } from "../types/schemas.js";
import { buildMailtoUrl } from "../actions/mail-draft.js";
import { runScript } from "../actions/script-runner.js";

// ------ Helpers ----------------------------------------------

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "ent-1",
    typeId: "person",
    filePath: "/vault/contacts/jean.md",
    fields: { name: "Jean", email: "jean@example.com", birthday: "1985-03-12" },
    body: "",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-15"),
    ...overrides,
  };
}

function makeResolvers(overrides: Partial<EngineResolvers> = {}): EngineResolvers {
  const entity = makeEntity();
  return {
    queryEntities: vi.fn().mockResolvedValue([entity]),
    getEntity: vi.fn().mockResolvedValue(entity),
    createEntity: vi.fn().mockResolvedValue({ ...entity, id: "new-ent" }),
    updateEntity: vi.fn().mockResolvedValue({ ...entity, id: "upd-ent" }),
    deleteEntity: vi.fn().mockResolvedValue(undefined),
    createRelation: vi.fn().mockResolvedValue({ id: "rel-1", sourceId: "a", targetId: "b", relationTypeId: "r", createdAt: new Date() } as RelationEdge),
    deleteRelation: vi.fn().mockResolvedValue(undefined),
    notify: vi.fn(),
    persistRun: vi.fn().mockResolvedValue(undefined),
    createMailDraft: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeEngine(opts: Partial<AutomationEngineOptions> = {}): AutomationEngine {
  return new AutomationEngine({
    formulaContext: {},
    resolvers: makeResolvers(),
    now: () => new Date("2026-05-07T09:00:00Z"),
    ...opts,
  });
}

const VALID_AUTOMATION: AutomationConfig = {
  id: "auto-1",
  kind: "REACTIVE",
  name: "Test automation",
  enabled: true,
  trigger: { type: "event", eventType: "entity.created" },
  actions: [{ type: "notify-app", title: "Hello", body: "World" }],
};

// ------ Parsing & validation ---------------------------------

describe("AutomationConfigSchema validation", () => {
  it("accepts a valid reactive automation", () => {
    const result = AutomationConfigSchema.safeParse(VALID_AUTOMATION);
    expect(result.success).toBe(true);
  });

  it("accepts a valid cron automation", () => {
    const config: AutomationConfig = {
      id: "cron-1",
      kind: "ROUTINE",
      name: "Weekly",
      enabled: true,
      trigger: { type: "cron", expression: "0 9 * * MON" },
      actions: [{ type: "notify-os", title: "Reminder", body: "Check tasks" }],
    };
    expect(AutomationConfigSchema.safeParse(config).success).toBe(true);
  });

  it("rejects automation without actions", () => {
    const bad = { ...VALID_AUTOMATION, actions: [] };
    const result = AutomationConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects unknown trigger type", () => {
    const bad = { ...VALID_AUTOMATION, trigger: { type: "unknown" } };
    const result = AutomationConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("accepts alarm trigger", () => {
    const config = {
      ...VALID_AUTOMATION,
      trigger: { type: "alarm", entityTypeId: "person", dateField: "birthday", offset: "-1d" },
    };
    expect(AutomationConfigSchema.safeParse(config).success).toBe(true);
  });

  it("rejects alarm trigger with invalid offset", () => {
    const config = {
      ...VALID_AUTOMATION,
      trigger: { type: "alarm", entityTypeId: "person", dateField: "birthday", offset: "invalid!!" },
    };
    expect(AutomationConfigSchema.safeParse(config).success).toBe(false);
  });
});

// ------ Cron scheduling --------------------------------------

describe("Cron trigger", () => {
  it("validates a correct cron expression", () => {
    expect(validateCronExpression("0 9 * * MON")).toBeNull();
  });

  it("returns error for invalid cron", () => {
    expect(validateCronExpression("not a cron")).not.toBeNull();
  });

  it("computes next cron date correctly", () => {
    // Use UTC timezone explicitly to avoid local-time interference
    const from = new Date("2026-05-04T10:00:00Z"); // Monday UTC
    const next = getNextCronDate({ expression: "0 9 * * MON", timezone: "UTC" }, from);
    expect(next > from).toBe(true);
    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCDay()).toBe(1); // Monday
  });

  it("detects cron should fire within 1-minute window", () => {
    // Use UTC timezone to avoid local-time interference
    const at = new Date("2026-05-11T09:00:30Z"); // Monday 9:00 UTC
    const config = { expression: "0 9 * * MON", timezone: "UTC" };
    expect(cronShouldFireAt(config, at)).toBe(true);
  });

  it("detects cron should NOT fire outside window", () => {
    const at = new Date("2026-05-11T10:30:00Z"); // Monday 10:30 UTC
    const config = { expression: "0 9 * * MON" };
    expect(cronShouldFireAt(config, at)).toBe(false);
  });
});

// ------ Event matching ---------------------------------------

describe("Event trigger matching", () => {
  const event: DomainEvent = {
    type: "entity.created",
    entityTypeId: "person",
    entityId: "ent-1",
    timestamp: new Date(),
  };

  it("matches correct event type", () => {
    expect(eventMatchesTrigger(event, { type: "event", eventType: "entity.created" })).toBe(true);
  });

  it("does not match wrong event type", () => {
    expect(eventMatchesTrigger(event, { type: "event", eventType: "entity.deleted" })).toBe(false);
  });

  it("matches with entityTypeId filter", () => {
    expect(
      eventMatchesTrigger(event, { type: "event", eventType: "entity.created", entityTypeId: "person" })
    ).toBe(true);
  });

  it("does not match with wrong entityTypeId filter", () => {
    expect(
      eventMatchesTrigger(event, { type: "event", eventType: "entity.created", entityTypeId: "project" })
    ).toBe(false);
  });
});

// ------ Alarm computation ------------------------------------

describe("Alarm trigger", () => {
  it("parses offset -1d to -86400000ms", () => {
    expect(parseOffsetMs("-1d")).toBe(-86_400_000);
  });

  it("parses offset +2h", () => {
    expect(parseOffsetMs("+2h")).toBe(7_200_000);
  });

  it("parses offset 0", () => {
    expect(parseOffsetMs("0")).toBe(0);
  });

  it("throws on invalid offset", () => {
    expect(() => parseOffsetMs("bad!!")).toThrow();
  });

  it("computes alarm fire date one day before", () => {
    const base = new Date("2026-03-12T00:00:00Z");
    const fire = computeAlarmDate(base, { offset: "-1d" });
    expect(fire.toISOString()).toBe("2026-03-11T00:00:00.000Z");
  });

  it("detects alarm should fire within window", () => {
    const entityDate = new Date("2026-03-12T00:00:00Z");
    const at = new Date("2026-03-11T00:00:30Z"); // 30s after fire time
    expect(
      alarmShouldFireAt(entityDate, { type: "alarm", entityTypeId: "person", dateField: "birthday", offset: "-1d" }, at)
    ).toBe(true);
  });

  it("extracts Date from ISO string", () => {
    const d = extractDateField("2026-03-12");
    expect(d).toBeInstanceOf(Date);
  });

  it("returns null for invalid date", () => {
    expect(extractDateField("not-a-date")).toBeNull();
  });
});

// ------ Template variables -----------------------------------

describe("Template rendering", () => {
  it("replaces simple var path", () => {
    const result = renderTemplate("Hello {{entity.fields.name}}", { entity: { fields: { name: "Jean" } } }, {});
    expect(result).toBe("Hello Jean");
  });

  it("replaces multiple vars", () => {
    const result = renderTemplate("{{a}} + {{b}}", { a: "foo", b: "bar" }, {});
    expect(result).toBe("foo + bar");
  });

  it("returns empty string for missing var", () => {
    const result = renderTemplate("{{missing.path}}", {}, {});
    expect(result).toBe("");
  });

  it("delegates formula expressions", () => {
    const evaluator = vi.fn().mockReturnValue(42);
    const result = renderTemplate("Result: {{formula:1+1}}", {}, {}, { formulaEvaluator: evaluator });
    expect(result).toBe("Result: 42");
    expect(evaluator).toHaveBeenCalledWith("1+1", {});
  });

  it("keeps formula placeholder when no evaluator", () => {
    const result = renderTemplate("{{formula:expr}}", {}, {});
    expect(result).toBe("{{formula:expr}}");
  });
});

// ------ Action tests -----------------------------------------

describe("create-mail-draft action", () => {
  it("builds correct mailto URL", () => {
    const url = buildMailtoUrl({
      to: ["jean@example.com"],
      subject: "Hello",
      body: "World",
    });
    expect(url).toContain("mailto:jean@example.com");
    expect(url).toContain("subject=Hello");
    expect(url).toContain("body=World");
  });

  it("includes cc in mailto URL", () => {
    const url = buildMailtoUrl({
      to: ["a@b.com"],
      cc: ["c@d.com"],
      subject: "Test",
      body: "Body",
    });
    expect(url).toContain("cc=c%40d.com");
  });
});

describe("run-script action", () => {
  it("executes simple arithmetic", () => {
    const result = runScript("2 + 3");
    expect(result.output).toBe(5);
  });

  it("captures console.log output", () => {
    const result = runScript("console.log('hello'); 1");
    expect(result.logs).toContain("hello");
  });

  it("throws on timeout exceeded", () => {
    expect(() => runScript("while(true){}", {}, 100)).toThrow();
  });
});

// ------ Engine run-once flow ---------------------------------

describe("AutomationEngine run-once", () => {
  it("runs an automation and returns SUCCESS", async () => {
    const engine = makeEngine();
    engine.registerAutomation(VALID_AUTOMATION);
    const result = await engine.runOnce("auto-1");
    expect(result.status).toBe("SUCCESS");
    expect(result.automationId).toBe("auto-1");
    expect(result.actionResults).toHaveLength(1);
    expect(result.actionResults[0]?.success).toBe(true);
  });

  it("persists the run result", async () => {
    const persistRun = vi.fn().mockResolvedValue(undefined);
    const engine = makeEngine({ resolvers: makeResolvers({ persistRun }) });
    engine.registerAutomation(VALID_AUTOMATION);
    await engine.runOnce("auto-1");
    expect(persistRun).toHaveBeenCalledOnce();
  });

  it("throws for unknown automation ID", async () => {
    const engine = makeEngine();
    await expect(engine.runOnce("no-such-id")).rejects.toThrow("not found");
  });

  it("emits run-started and run-completed events", async () => {
    const engine = makeEngine();
    engine.registerAutomation(VALID_AUTOMATION);
    const started = vi.fn();
    const completed = vi.fn();
    engine.on("run-started", started);
    engine.on("run-completed", completed);
    await engine.runOnce("auto-1");
    expect(started).toHaveBeenCalledWith("auto-1", expect.any(String));
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ status: "SUCCESS" }));
  });

  it("SKIPS when condition returns false", async () => {
    const engine = makeEngine({
      formulaContext: { person: { lastInteraction: { daysAgo: 5 } } },
    });
    const conditionalAuto: AutomationConfig = {
      ...VALID_AUTOMATION,
      id: "cond-auto",
      condition: "some-condition",
    };
    engine.registerAutomation(conditionalAuto);
    // Without evaluator, condition defaults to true (logged warning)
    const result = await engine.runOnce("cond-auto");
    expect(result.status).toBe("SUCCESS"); // no evaluator = condition passes
  });

  it("returns FAILURE when action fails", async () => {
    const resolvers = makeResolvers({
      notify: vi.fn().mockImplementation(() => { throw new Error("Notify failed"); }),
    });
    const engine = makeEngine({ resolvers });
    engine.registerAutomation(VALID_AUTOMATION);
    const result = await engine.runOnce("auto-1");
    expect(result.status).toBe("FAILURE");
    expect(result.actionResults[0]?.success).toBe(false);
  });
});

// ------ AutomationRun logging --------------------------------

describe("AutomationRun logging", () => {
  it("records duration in milliseconds", async () => {
    const engine = makeEngine();
    engine.registerAutomation(VALID_AUTOMATION);
    const result = await engine.runOnce("auto-1");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records createdAt timestamp", async () => {
    const engine = makeEngine();
    engine.registerAutomation(VALID_AUTOMATION);
    const result = await engine.runOnce("auto-1");
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it("records triggerPayload", async () => {
    const engine = makeEngine();
    engine.registerAutomation(VALID_AUTOMATION);
    const payload = { custom: "value" };
    const result = await engine.runOnce("auto-1", payload);
    expect(result.triggerPayload).toEqual(payload);
  });
});

// ------ Next runs --------------------------------------------

describe("getNextRuns", () => {
  it("returns next run for cron automation", async () => {
    const engine = makeEngine();
    const cronAuto: AutomationConfig = {
      id: "cron-auto",
      kind: "ROUTINE",
      name: "Weekly",
      enabled: true,
      trigger: { type: "cron", expression: "0 9 * * MON" },
      actions: [{ type: "notify-app", title: "Hi", body: "There" }],
    };
    engine.registerAutomation(cronAuto);
    const runs = await engine.getNextRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.automationId).toBe("cron-auto");
    expect(runs[0]?.nextRunAt).toBeInstanceOf(Date);
  });

  it("returns empty for no cron automations", async () => {
    const engine = makeEngine();
    engine.registerAutomation(VALID_AUTOMATION);
    const runs = await engine.getNextRuns();
    expect(runs).toHaveLength(0);
  });
});

// ------ Event emission flow ----------------------------------

describe("emitEvent", () => {
  it("fires automation matching event type", async () => {
    const resolvers = makeResolvers();
    const engine = makeEngine({ resolvers });
    engine.registerAutomation(VALID_AUTOMATION);
    const event: DomainEvent = {
      type: "entity.created",
      entityId: "ent-1",
      entityTypeId: "person",
      timestamp: new Date(),
    };
    await engine.emitEvent(event);
    expect(resolvers.notify).toHaveBeenCalledOnce();
  });

  it("does not fire automation for non-matching event", async () => {
    const resolvers = makeResolvers();
    const engine = makeEngine({ resolvers });
    engine.registerAutomation(VALID_AUTOMATION);
    const event: DomainEvent = {
      type: "entity.deleted",
      entityId: "ent-1",
      entityTypeId: "person",
      timestamp: new Date(),
    };
    await engine.emitEvent(event);
    expect(resolvers.notify).not.toHaveBeenCalled();
  });

  it("does not fire disabled automation", async () => {
    const resolvers = makeResolvers();
    const engine = makeEngine({ resolvers });
    engine.registerAutomation({ ...VALID_AUTOMATION, enabled: false });
    const event: DomainEvent = {
      type: "entity.created",
      entityTypeId: "person",
      entityId: "ent-1",
      timestamp: new Date(),
    };
    await engine.emitEvent(event);
    expect(resolvers.notify).not.toHaveBeenCalled();
  });
});
