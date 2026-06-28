import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addBinding,
  buildTodoProvenanceFields,
  getBinding,
  loadBindings,
  MAIL_TODO_STORAGE_KEY,
  reconcileBindings,
  reconstructBindingFromEntity,
  removeBinding,
  saveBindings,
  TODO_MAIL_FIELDS,
  updateBindingQuadrant,
  updateBindingSummary,
  type MailTodoBinding,
  type TodoProvenanceSource,
} from "./mail-todo-binding";

// ─── Stub localStorage (l'environnement vitest est `node`, pas de DOM) ────────

function installLocalStorage(): Record<string, string> {
  const backing: Record<string, string> = {};
  const stub: Storage = {
    get length() {
      return Object.keys(backing).length;
    },
    clear: () => {
      for (const k of Object.keys(backing)) delete backing[k];
    },
    getItem: (k: string) => (k in backing ? backing[k]! : null),
    key: (i: number) => Object.keys(backing)[i] ?? null,
    removeItem: (k: string) => {
      delete backing[k];
    },
    setItem: (k: string, v: string) => {
      backing[k] = String(v);
    },
  };
  vi.stubGlobal("window", { localStorage: stub });
  return backing;
}

function makeBinding(over: Partial<MailTodoBinding> = {}): MailTodoBinding {
  return {
    threadId: "t1",
    todoId: "todo1",
    quadrant: "do",
    subject: "Sujet test",
    createdAt: 1000,
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("add / get / remove", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("addBinding persiste et getBinding le retrouve", () => {
    addBinding(makeBinding());
    expect(getBinding("t1")).toMatchObject({ threadId: "t1", todoId: "todo1", quadrant: "do" });
  });

  it("getBinding renvoie undefined pour un thread inconnu", () => {
    expect(getBinding("absent")).toBeUndefined();
  });

  it("removeBinding retire la liaison", () => {
    addBinding(makeBinding());
    removeBinding("t1");
    expect(getBinding("t1")).toBeUndefined();
  });

  it("removeBinding est un no-op silencieux si absent", () => {
    addBinding(makeBinding({ threadId: "t1" }));
    const next = removeBinding("absent");
    expect(next.map((b) => b.threadId)).toEqual(["t1"]);
  });

  it("addBinding ignore une entrée malformée (todoId vide)", () => {
    const next = addBinding(makeBinding({ todoId: "" }));
    expect(next).toEqual([]);
    expect(getBinding("t1")).toBeUndefined();
  });
});

describe("dédoublonnage par threadId", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("addBinding sur un thread existant remplace la liaison (la dernière gagne)", () => {
    addBinding(makeBinding({ todoId: "todoA", quadrant: "do" }));
    addBinding(makeBinding({ todoId: "todoB", quadrant: "schedule" }));
    const all = loadBindings();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ threadId: "t1", todoId: "todoB", quadrant: "schedule" });
  });

  it("saveBindings dédoublonne un tableau contenant deux entrées du même thread", () => {
    saveBindings([
      makeBinding({ threadId: "t1", todoId: "old" }),
      makeBinding({ threadId: "t1", todoId: "new" }),
    ]);
    const all = loadBindings();
    expect(all).toHaveLength(1);
    expect(all[0]?.todoId).toBe("new");
  });

  it("conserve plusieurs threads distincts", () => {
    addBinding(makeBinding({ threadId: "t1" }));
    addBinding(makeBinding({ threadId: "t2" }));
    expect(loadBindings().map((b) => b.threadId).sort()).toEqual(["t1", "t2"]);
  });
});

describe("updateBindingQuadrant", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("change le quadrant d'une liaison existante", () => {
    addBinding(makeBinding({ quadrant: "do" }));
    updateBindingQuadrant("t1", "eliminate");
    expect(getBinding("t1")?.quadrant).toBe("eliminate");
  });

  it("préserve les autres champs (todoId, subject, createdAt)", () => {
    addBinding(makeBinding({ todoId: "todoX", subject: "S", createdAt: 42 }));
    updateBindingQuadrant("t1", "delegate");
    expect(getBinding("t1")).toMatchObject({
      todoId: "todoX",
      subject: "S",
      createdAt: 42,
      quadrant: "delegate",
    });
  });

  it("no-op si le thread n'est pas lié", () => {
    addBinding(makeBinding({ threadId: "t1", quadrant: "do" }));
    updateBindingQuadrant("absent", "schedule");
    expect(getBinding("t1")?.quadrant).toBe("do");
    expect(getBinding("absent")).toBeUndefined();
  });
});

describe("updateBindingSummary", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("attache un résumé à une liaison existante", () => {
    addBinding(makeBinding());
    updateBindingSummary("t1", "  Résumé du fil.  ");
    expect(getBinding("t1")?.summary).toBe("Résumé du fil.");
  });

  it("préserve les autres champs", () => {
    addBinding(makeBinding({ todoId: "todoX", quadrant: "schedule", snippet: "snip" }));
    updateBindingSummary("t1", "Résumé");
    expect(getBinding("t1")).toMatchObject({
      todoId: "todoX",
      quadrant: "schedule",
      snippet: "snip",
      summary: "Résumé",
    });
  });

  it("no-op si résumé vide (après trim)", () => {
    addBinding(makeBinding());
    updateBindingSummary("t1", "   ");
    expect(getBinding("t1")?.summary).toBeUndefined();
  });

  it("no-op si le thread n'est pas lié", () => {
    addBinding(makeBinding({ threadId: "t1" }));
    updateBindingSummary("absent", "Résumé");
    expect(getBinding("absent")).toBeUndefined();
    expect(getBinding("t1")?.summary).toBeUndefined();
  });

  it("ne lève pas quand window n'a pas dispatchEvent (stub minimal)", () => {
    addBinding(makeBinding());
    expect(() => updateBindingSummary("t1", "Résumé")).not.toThrow();
  });
});

describe("buildTodoProvenanceFields", () => {
  it("écrit toujours le threadId, omet les valeurs absentes", () => {
    expect(buildTodoProvenanceFields({ threadId: "t1" })).toEqual({
      [TODO_MAIL_FIELDS.threadId]: "t1",
    });
  });

  it("inclut from/snippet quand présents", () => {
    expect(
      buildTodoProvenanceFields({
        threadId: "t1",
        fromName: "Alice",
        fromEmail: "a@x.io",
        snippet: "aperçu",
      }),
    ).toEqual({
      [TODO_MAIL_FIELDS.threadId]: "t1",
      [TODO_MAIL_FIELDS.fromName]: "Alice",
      [TODO_MAIL_FIELDS.fromEmail]: "a@x.io",
      [TODO_MAIL_FIELDS.snippet]: "aperçu",
    });
  });
});

describe("reconstructBindingFromEntity", () => {
  function makeEntity(fields: Record<string, unknown>, over: Partial<TodoProvenanceSource> = {}): TodoProvenanceSource {
    return { id: "todoX", fields, createdAt: "2026-06-01T10:00:00.000Z", ...over };
  }

  it("reconstruit une liaison et dérive le quadrant depuis urgent+importance", () => {
    const b = reconstructBindingFromEntity(
      makeEntity({
        [TODO_MAIL_FIELDS.threadId]: "thread-1",
        text: "Répondre à Bob",
        urgent: true,
        importance: "high",
        [TODO_MAIL_FIELDS.fromName]: "Bob",
        [TODO_MAIL_FIELDS.snippet]: "salut",
      }),
    );
    expect(b).toMatchObject({
      threadId: "thread-1",
      todoId: "todoX",
      quadrant: "do", // urgent + high
      subject: "Répondre à Bob",
      fromName: "Bob",
      snippet: "salut",
    });
    expect(b?.createdAt).toBe(Date.parse("2026-06-01T10:00:00.000Z"));
  });

  it("dérive schedule pour !urgent + high", () => {
    const b = reconstructBindingFromEntity(
      makeEntity({ [TODO_MAIL_FIELDS.threadId]: "t", urgent: false, importance: "high" }),
    );
    expect(b?.quadrant).toBe("schedule");
  });

  it("tolère les axes en string (urgent='true')", () => {
    const b = reconstructBindingFromEntity(
      makeEntity({ [TODO_MAIL_FIELDS.threadId]: "t", urgent: "true", importance: "low" }),
    );
    expect(b?.quadrant).toBe("delegate"); // urgent + non-important
  });

  it("renvoie null sans mailThreadId (todo non issu d'un email)", () => {
    expect(reconstructBindingFromEntity(makeEntity({ text: "tâche normale" }))).toBeNull();
  });

  it("renvoie null pour une tâche faite (done) — la carte ne ressuscite pas", () => {
    const b = reconstructBindingFromEntity(
      makeEntity({ [TODO_MAIL_FIELDS.threadId]: "t", done: true }),
    );
    expect(b).toBeNull();
  });

  it("createdAt → 0 si date absente/invalide (reste une liaison valide)", () => {
    const b = reconstructBindingFromEntity({
      id: "todoX",
      fields: { [TODO_MAIL_FIELDS.threadId]: "t" },
      createdAt: null,
    });
    expect(b?.createdAt).toBe(0);
  });
});

describe("reconcileBindings", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  const entity = (id: string, threadId: string, over: Record<string, unknown> = {}): TodoProvenanceSource => ({
    id,
    createdAt: "2026-06-01T10:00:00.000Z",
    fields: { [TODO_MAIL_FIELDS.threadId]: threadId, text: "s", urgent: true, importance: "high", ...over },
  });

  it("recrée les liaisons manquantes depuis la provenance coffre", () => {
    expect(loadBindings()).toEqual([]);
    const added = reconcileBindings([entity("todo1", "thr1"), entity("todo2", "thr2")]);
    expect(added).toBe(2);
    expect(loadBindings().map((b) => b.threadId).sort()).toEqual(["thr1", "thr2"]);
  });

  it("ne touche pas une liaison localStorage existante (elle gagne : résumé/quadrant optimiste)", () => {
    addBinding(makeBinding({ threadId: "thr1", todoId: "todo1", quadrant: "eliminate", summary: "résumé local" }));
    const added = reconcileBindings([entity("todo1", "thr1")]); // coffre dit quadrant "do"
    expect(added).toBe(0);
    expect(getBinding("thr1")).toMatchObject({ quadrant: "eliminate", summary: "résumé local" });
  });

  it("dédoublonne par todoId (même todo, threadId déjà lié autrement)", () => {
    addBinding(makeBinding({ threadId: "thr1", todoId: "todo1" }));
    const added = reconcileBindings([entity("todo1", "thr-renamed")]);
    expect(added).toBe(0);
  });

  it("ignore les entités sans provenance email", () => {
    const added = reconcileBindings([{ id: "todoZ", fields: { text: "normale" }, createdAt: "2026-06-01T10:00:00.000Z" }]);
    expect(added).toBe(0);
    expect(loadBindings()).toEqual([]);
  });

  it("renvoie 0 et n'écrit rien pour une liste vide", () => {
    expect(reconcileBindings([])).toBe(0);
  });

  it("élague une liaison dont le todo est devenu `done` dans le coffre", () => {
    addBinding(makeBinding({ threadId: "thr1", todoId: "todo1" }));
    expect(getBinding("thr1")).toBeDefined();
    reconcileBindings([entity("todo1", "thr1", { done: true })]);
    expect(getBinding("thr1")).toBeUndefined();
  });

  it("élague le `done` même au format chaîne (\"true\")", () => {
    addBinding(makeBinding({ threadId: "thr1", todoId: "todo1" }));
    reconcileBindings([entity("todo1", "thr1", { done: "true" })]);
    expect(getBinding("thr1")).toBeUndefined();
  });

  it("garde les liaisons non-done et n'élague que les done (mix)", () => {
    addBinding(makeBinding({ threadId: "thr1", todoId: "todo1" }));
    addBinding(makeBinding({ threadId: "thr2", todoId: "todo2" }));
    reconcileBindings([
      entity("todo1", "thr1", { done: true }),
      entity("todo2", "thr2"),
    ]);
    expect(getBinding("thr1")).toBeUndefined();
    expect(getBinding("thr2")).toBeDefined();
  });

  it("n'élague PAS un todo absent des sources (évite de purger sur requête partielle)", () => {
    addBinding(makeBinding({ threadId: "thr1", todoId: "todo1" }));
    reconcileBindings([entity("todo2", "thr2")]);
    expect(getBinding("thr1")).toBeDefined();
  });
});

describe("tolérance aux données invalides", () => {
  it("loadBindings tolère un JSON invalide → []", () => {
    const backing = installLocalStorage();
    backing[MAIL_TODO_STORAGE_KEY] = "{not json";
    expect(loadBindings()).toEqual([]);
  });

  it("loadBindings tolère une valeur non-tableau → []", () => {
    const backing = installLocalStorage();
    backing[MAIL_TODO_STORAGE_KEY] = JSON.stringify({ threadId: "t1" });
    expect(loadBindings()).toEqual([]);
  });

  it("loadBindings filtre les entrées malformées et garde les valides", () => {
    const backing = installLocalStorage();
    backing[MAIL_TODO_STORAGE_KEY] = JSON.stringify([
      makeBinding({ threadId: "ok" }),
      { threadId: "bad", todoId: "x" }, // quadrant/subject/createdAt manquants
      { threadId: "bad2", todoId: "x", quadrant: "nope", subject: "s", createdAt: 1 },
      null,
      42,
    ]);
    const all = loadBindings();
    expect(all.map((b) => b.threadId)).toEqual(["ok"]);
  });

  it("ne lève jamais quand window est absent", () => {
    // pas de stub window → typeof window === "undefined"
    expect(() => loadBindings()).not.toThrow();
    expect(loadBindings()).toEqual([]);
    expect(() => saveBindings([makeBinding()])).not.toThrow();
    expect(() => addBinding(makeBinding())).not.toThrow();
    expect(() => removeBinding("t1")).not.toThrow();
    expect(() => updateBindingQuadrant("t1", "do")).not.toThrow();
    expect(getBinding("t1")).toBeUndefined();
  });
});
