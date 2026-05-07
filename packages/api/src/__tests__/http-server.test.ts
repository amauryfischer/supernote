import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHttpServer } from "../http/server.js";
import { createMockResolvers, MOCK_ENTITY, MOCK_ENTITY_TYPE, MOCK_RELATION } from "./mock-resolvers.js";

interface ServerInfo {
  url: string;
  port: number;
  token: string;
}

describe("HttpServer", () => {
  let info: ServerInfo;
  let server: ReturnType<typeof createHttpServer>;

  beforeEach(async () => {
    server = createHttpServer({ resolvers: createMockResolvers(), port: 0 });
    info = await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  // ---- Health check ----------------------------------------

  it("GET /api/v1/health returns 200 without auth", async () => {
    const res = await fetch(`${info.url}/api/v1/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("ok");
  });

  // ---- Auth token enforcement ------------------------------

  it("returns 401 when token is missing", async () => {
    const res = await fetch(`${info.url}/api/v1/entities`);
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is wrong", async () => {
    const res = await fetch(`${info.url}/api/v1/entities`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 with correct token", async () => {
    const res = await fetch(`${info.url}/api/v1/entities`, {
      headers: { Authorization: `Bearer ${info.token}` },
    });
    expect(res.status).toBe(200);
  });

  // ---- Entities CRUD ---------------------------------------

  it("GET /api/v1/entities returns entity list", async () => {
    const res = await fetch(`${info.url}/api/v1/entities`, {
      headers: { Authorization: `Bearer ${info.token}` },
    });
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it("GET /api/v1/entities/:id returns entity", async () => {
    const res = await fetch(`${info.url}/api/v1/entities/${MOCK_ENTITY.id}`, {
      headers: { Authorization: `Bearer ${info.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string } };
    expect(body.data.id).toBe(MOCK_ENTITY.id);
  });

  it("GET /api/v1/entities/:id returns 404 for unknown", async () => {
    const res = await fetch(`${info.url}/api/v1/entities/unknown-id`, {
      headers: { Authorization: `Bearer ${info.token}` },
    });
    expect(res.status).toBe(404);
  });

  it("POST /api/v1/entities creates entity and returns 201", async () => {
    const res = await fetch(`${info.url}/api/v1/entities`, {
      method: "POST",
      headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ typeId: "contact", fields: { name: "Bob" }, body: "" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { typeId: string } };
    expect(body.data.typeId).toBe("contact");
  });

  it("POST /api/v1/entities returns 400 for invalid body", async () => {
    const res = await fetch(`${info.url}/api/v1/entities`, {
      method: "POST",
      headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: {} }), // missing typeId
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /api/v1/entities/:id updates entity", async () => {
    const res = await fetch(`${info.url}/api/v1/entities/${MOCK_ENTITY.id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Updated body" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { body: string } };
    expect(body.data.body).toBe("Updated body");
  });

  it("PATCH /api/v1/entities/:id returns 404 for unknown", async () => {
    const res = await fetch(`${info.url}/api/v1/entities/unknown`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${info.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ body: "x" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/v1/entities/:id deletes entity", async () => {
    const res = await fetch(`${info.url}/api/v1/entities/${MOCK_ENTITY.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${info.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });

  it("DELETE /api/v1/entities/:id returns 404 for unknown", async () => {
    const res = await fetch(`${info.url}/api/v1/entities/unknown`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${info.token}` },
    });
    expect(res.status).toBe(404);
  });

  // ---- Schemas ---------------------------------------------

  it("GET /api/v1/schemas returns schema list", async () => {
    const res = await fetch(`${info.url}/api/v1/schemas`, {
      headers: { Authorization: `Bearer ${info.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  it("GET /api/v1/schemas/:id returns schema", async () => {
    const res = await fetch(`${info.url}/api/v1/schemas/${MOCK_ENTITY_TYPE.id}`, {
      headers: { Authorization: `Bearer ${info.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string } };
    expect(body.data.id).toBe(MOCK_ENTITY_TYPE.id);
  });

  it("GET /api/v1/schemas/:id returns 404 for unknown", async () => {
    const res = await fetch(`${info.url}/api/v1/schemas/unknown`, {
      headers: { Authorization: `Bearer ${info.token}` },
    });
    expect(res.status).toBe(404);
  });

  // ---- Search ----------------------------------------------

  it("POST /api/v1/search returns results", async () => {
    const res = await fetch(`${info.url}/api/v1/search?q=test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${info.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("POST /api/v1/search returns 400 with no query", async () => {
    const res = await fetch(`${info.url}/api/v1/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${info.token}` },
    });
    expect(res.status).toBe(400);
  });

  // ---- Relations -------------------------------------------

  it("GET /api/v1/relations returns 400 without source", async () => {
    const res = await fetch(`${info.url}/api/v1/relations`, {
      headers: { Authorization: `Bearer ${info.token}` },
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/v1/relations?source= returns relation list", async () => {
    const res = await fetch(`${info.url}/api/v1/relations?source=${MOCK_RELATION.sourceId}`, {
      headers: { Authorization: `Bearer ${info.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  // ---- Tags ------------------------------------------------

  it("GET /api/v1/tags returns tag list", async () => {
    const res = await fetch(`${info.url}/api/v1/tags`, {
      headers: { Authorization: `Bearer ${info.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[] };
    expect(body.data).toHaveLength(1);
  });

  // ---- Token management ------------------------------------

  it("getToken returns the active token", () => {
    expect(server.getToken()).toBe(info.token);
  });

  it("getUrl returns the active URL", () => {
    expect(server.getUrl()).toBe(info.url);
  });
});
