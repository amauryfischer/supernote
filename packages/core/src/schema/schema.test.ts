import { describe, it, expect } from "vitest";
import { validateEntityFields, buildZodSchemaFromEntityType, castFieldValue, migrateEntity } from "./index.js";
import type { Entity, EntityType, Field } from "../types/index.js";
import { isOk, isErr } from "../result/index.js";

// ---- Fixtures ------------------------------------------------

const textField: Field = {
  id: "f1",
  name: "name",
  label: "Name",
  kind: "text",
  required: true,
  unique: false,
};

const emailField: Field = {
  id: "f2",
  name: "email",
  label: "Email",
  kind: "email",
  required: false,
  unique: true,
};

const numberField: Field = {
  id: "f3",
  name: "score",
  label: "Score",
  kind: "number",
  required: false,
  unique: false,
  min: 0,
  max: 100,
};

const selectField: Field = {
  id: "f4",
  name: "status",
  label: "Status",
  kind: "select",
  required: false,
  unique: false,
  options: [
    { value: "active", label: "Active" },
    { value: "inactive", label: "Inactive" },
  ],
};

const entityType: EntityType = {
  id: "contact",
  name: "Contact",
  plural: "Contacts",
  fields: [textField, emailField, numberField, selectField],
  defaultPath: "Contacts",
  fileNamePattern: "{slug}",
};

function makeEntity(fields: Record<string, unknown>): Entity {
  return {
    id: "01HX2KABCDEFGHIJKLMNOPQR",
    typeId: "contact",
    filePath: "Contacts/test.md",
    fields: fields as Record<string, import("../types/index.js").FieldValue>,
    body: "",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  };
}

// ---- Tests ---------------------------------------------------

describe("buildZodSchemaFromEntityType", () => {
  it("builds a schema with correct required fields", () => {
    const schema = buildZodSchemaFromEntityType(entityType);
    const result = schema.safeParse({ name: "Alice" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const schema = buildZodSchemaFromEntityType(entityType);
    const result = schema.safeParse({ name: "Alice", email: "not-an-email" });
    expect(result.success).toBe(false);
  });
});

describe("validateEntityFields", () => {
  it("returns Ok for valid entity", () => {
    const entity = makeEntity({ name: "Alice", email: "alice@example.com", score: 80, status: "active" });
    const result = validateEntityFields(entity, entityType);
    expect(isOk(result)).toBe(true);
  });

  it("returns Err for missing required field", () => {
    const entity = makeEntity({ email: "alice@example.com" });
    const result = validateEntityFields(entity, entityType);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.some((e) => e.fieldId === "name")).toBe(true);
    }
  });

  it("returns Err for invalid email format", () => {
    const entity = makeEntity({ name: "Bob", email: "bad-email" });
    const result = validateEntityFields(entity, entityType);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.some((e) => e.fieldId === "email")).toBe(true);
    }
  });

  it("returns Err for invalid select value", () => {
    const entity = makeEntity({ name: "Charlie", status: "unknown_status" });
    const result = validateEntityFields(entity, entityType);
    expect(isErr(result)).toBe(true);
  });

  it("marked as validated", () => {
    const entity = makeEntity({ name: "Alice" });
    const result = validateEntityFields(entity, entityType);
    if (isOk(result)) {
      expect((result.value as { _validated: boolean })._validated).toBe(true);
    }
  });
});

describe("castFieldValue", () => {
  it("casts string to number", () => {
    expect(castFieldValue("42", "number")).toBe(42);
  });

  it("returns null for invalid number", () => {
    expect(castFieldValue("abc", "number")).toBe(null);
  });

  it("casts 'true' string to boolean", () => {
    expect(castFieldValue("true", "bool")).toBe(true);
  });

  it("casts 0 to false for bool", () => {
    expect(castFieldValue(0, "bool")).toBe(false);
  });

  it("coerces to array for multiselect", () => {
    expect(castFieldValue("tag", "multiselect")).toEqual(["tag"]);
    expect(castFieldValue(["a", "b"], "multiselect")).toEqual(["a", "b"]);
  });

  it("returns null for null input", () => {
    expect(castFieldValue(null, "text")).toBe(null);
  });
});

describe("migrateEntity", () => {
  const fromType: EntityType = {
    id: "v1",
    name: "Contact",
    plural: "Contacts",
    fields: [textField, emailField],
    defaultPath: "Contacts",
    fileNamePattern: "{slug}",
  };

  const newField: Field = {
    id: "f5",
    name: "company",
    label: "Company",
    kind: "text",
    required: false,
    unique: false,
    defaultValue: "Unknown",
  };

  const toType: EntityType = {
    ...fromType,
    id: "v2",
    fields: [textField, newField], // email dropped, company added
  };

  it("carries forward matching fields", () => {
    const entity = makeEntity({ name: "Alice", email: "alice@example.com" });
    const { entity: migrated, proposal } = migrateEntity(entity, fromType, toType);
    expect(migrated.fields["name"]).toBe("Alice");
    expect(proposal.dropped).toContain("email");
  });

  it("applies default values for new required fields", () => {
    const entity = makeEntity({ name: "Alice" });
    const { entity: migrated } = migrateEntity(entity, fromType, toType);
    expect(migrated.fields["company"]).toBe("Unknown");
  });

  it("reports dropped fields", () => {
    const entity = makeEntity({ name: "Alice", email: "alice@example.com" });
    const { proposal } = migrateEntity(entity, fromType, toType);
    expect(proposal.dropped).toContain("email");
  });
});
