import { describe, it, expect } from "vitest";
import { ipcFieldToCore, coreFieldToIpc } from "./adapters";
import type { FieldDefinition } from "@supernote/ipc";
import type { Field } from "@supernote/core";

describe("relation field round-trip", () => {
  it("ipcFieldToCore keeps targetTypeId + cardinality", () => {
    const ipc: FieldDefinition = {
      id: "f1",
      name: "company",
      label: "Company",
      type: "relation",
      required: false,
      unique: false,
      multiple: false,
      targetTypeId: "type-co",
      cardinality: "one_to_one",
    };
    const core = ipcFieldToCore(ipc);
    expect(core.kind).toBe("relation");
    if (core.kind !== "relation") throw new Error("expected relation");
    expect(core.targetTypeId).toBe("type-co");
    expect(core.cardinality).toBe("one_to_one");
  });

  it("coreFieldToIpc writes targetTypeId + cardinality back", () => {
    const core = {
      id: "f2",
      name: "members",
      label: "Members",
      required: false,
      unique: false,
      kind: "relation",
      targetTypeId: "type-p",
      cardinality: "many_to_many",
    } as Field;
    const ipc = coreFieldToIpc(core);
    expect(ipc.type).toBe("relation");
    expect(ipc.targetTypeId).toBe("type-p");
    expect(ipc.cardinality).toBe("many_to_many");
    expect(ipc.multiple).toBe(true);
  });

  it("survives a full ipc → core → ipc round-trip", () => {
    const ipc: FieldDefinition = {
      id: "f3",
      name: "tasks",
      label: "Tasks",
      type: "relation",
      required: false,
      unique: false,
      multiple: true,
      targetTypeId: "type-t",
      cardinality: "many_to_many",
    };
    const back = coreFieldToIpc(ipcFieldToCore(ipc));
    expect(back.targetTypeId).toBe("type-t");
    expect(back.cardinality).toBe("many_to_many");
  });

  it("defaults a target-less relation to many_to_many without throwing", () => {
    const core = ipcFieldToCore({
      id: "f4",
      name: "rel",
      label: "Rel",
      type: "relation",
      required: false,
      unique: false,
      multiple: false,
    });
    if (core.kind !== "relation") throw new Error("expected relation");
    expect(core.targetTypeId).toBe("");
    expect(core.cardinality).toBe("many_to_many");
  });
});
