import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addBinding,
  getBinding,
  loadBindings,
  MAIL_TODO_STORAGE_KEY,
  removeBinding,
  saveBindings,
  updateBindingQuadrant,
  type MailTodoBinding,
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
