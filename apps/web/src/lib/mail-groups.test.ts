import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  filterGroupItems,
  filterInboxItems,
  getGroup,
  groupIdFromTab,
  groupTabKey,
  loadGroups,
  MAIL_GROUPS_STORAGE_KEY,
  removeGroup,
  routedLabelIds,
  saveGroups,
  upsertGroup,
  type MailGroup,
} from "./mail-groups";

// ─── Stub localStorage (environnement vitest = node, pas de DOM) ──────────────
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

function makeGroup(over: Partial<MailGroup> = {}): MailGroup {
  return { id: "g1", name: "Réunions", labelIds: ["L1"], createdAt: 1000, ...over };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("upsert / get / remove", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("ajoute puis relit un groupe", () => {
    expect(loadGroups()).toEqual([]);
    upsertGroup(makeGroup());
    expect(getGroup("g1")).toMatchObject({ name: "Réunions", labelIds: ["L1"] });
  });

  it("remplace un groupe existant (même id)", () => {
    upsertGroup(makeGroup());
    upsertGroup(makeGroup({ name: "Renommé", labelIds: ["L1", "L2"] }));
    expect(loadGroups()).toHaveLength(1);
    expect(getGroup("g1")).toMatchObject({ name: "Renommé", labelIds: ["L1", "L2"] });
  });

  it("retire un groupe", () => {
    upsertGroup(makeGroup());
    upsertGroup(makeGroup({ id: "g2", name: "Factures" }));
    removeGroup("g1");
    expect(loadGroups().map((g) => g.id)).toEqual(["g2"]);
  });

  it("ignore un groupe malformé (no-op)", () => {
    upsertGroup({ id: "", name: "x", labelIds: [], createdAt: 1 });
    expect(loadGroups()).toEqual([]);
  });
});

describe("dédoublonnage par id à l'écriture", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("la dernière entrée gagne", () => {
    saveGroups([makeGroup({ name: "A" }), makeGroup({ name: "B" })]);
    expect(loadGroups()).toHaveLength(1);
    expect(getGroup("g1")?.name).toBe("B");
  });
});

describe("routedLabelIds", () => {
  it("union dédoublonnée de tous les labels", () => {
    const groups = [
      makeGroup({ id: "g1", labelIds: ["L1", "L2"] }),
      makeGroup({ id: "g2", labelIds: ["L2", "L3"] }),
    ];
    expect(routedLabelIds(groups).sort()).toEqual(["L1", "L2", "L3"]);
  });

  it("[] pour aucun groupe", () => {
    expect(routedLabelIds([])).toEqual([]);
  });
});

describe("groupTabKey / groupIdFromTab", () => {
  it("encode puis décode l'id", () => {
    expect(groupTabKey("g1")).toBe("g:g1");
    expect(groupIdFromTab("g:g1")).toBe("g1");
  });

  it("null pour inbox / todo", () => {
    expect(groupIdFromTab("inbox")).toBeNull();
    expect(groupIdFromTab("todo")).toBeNull();
  });
});

describe("filterInboxItems", () => {
  const items = [
    { id: "a", labelIds: ["INBOX"] },
    { id: "b", labelIds: ["INBOX", "L1"] },
    { id: "c", labelIds: ["INBOX", "L2"] },
  ];

  it("garde tout quand aucun groupe", () => {
    expect(filterInboxItems(items, []).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("retire les items portant un label routé", () => {
    const groups = [makeGroup({ id: "g1", labelIds: ["L1"] })];
    expect(filterInboxItems(items, groups).map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("retire selon l'union de tous les groupes", () => {
    const groups = [
      makeGroup({ id: "g1", labelIds: ["L1"] }),
      makeGroup({ id: "g2", labelIds: ["L2"] }),
    ];
    expect(filterInboxItems(items, groups).map((i) => i.id)).toEqual(["a"]);
  });
});

describe("filterGroupItems", () => {
  const items = [
    { id: "a", labelIds: ["INBOX"] },
    { id: "b", labelIds: ["INBOX", "L1"] },
    { id: "c", labelIds: ["INBOX", "L1", "L2"] },
  ];

  it("garde les items portant un label du groupe", () => {
    expect(filterGroupItems(items, makeGroup({ labelIds: ["L1"] })).map((i) => i.id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("OR sur plusieurs labels du groupe", () => {
    expect(filterGroupItems(items, makeGroup({ labelIds: ["L2"] })).map((i) => i.id)).toEqual([
      "c",
    ]);
  });

  it("[] pour groupe indéfini ou sans label", () => {
    expect(filterGroupItems(items, undefined)).toEqual([]);
    expect(filterGroupItems(items, makeGroup({ labelIds: [] }))).toEqual([]);
  });
});

describe("tolérance aux données invalides", () => {
  it("JSON invalide → []", () => {
    const backing = installLocalStorage();
    backing[MAIL_GROUPS_STORAGE_KEY] = "{pas du json";
    expect(loadGroups()).toEqual([]);
  });

  it("entrées non conformes filtrées", () => {
    const backing = installLocalStorage();
    backing[MAIL_GROUPS_STORAGE_KEY] = JSON.stringify([
      makeGroup(),
      { id: "bad" },
      { id: "g3", name: "ok", labelIds: [1, 2], createdAt: 5 },
    ]);
    expect(loadGroups().map((g) => g.id)).toEqual(["g1"]);
  });

  it("loadGroups sans window → []", () => {
    expect(loadGroups()).toEqual([]);
  });
});
