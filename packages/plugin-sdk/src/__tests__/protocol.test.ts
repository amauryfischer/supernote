import { describe, it, expect } from "vitest";
import {
  createRequest,
  createResponse,
  createError,
  createEvent,
  createHandshake,
  createHandshakeAck,
} from "../protocol/factory.js";
import {
  anyEnvelopeSchema,
  requestEnvelopeSchema,
  responseEnvelopeSchema,
  errorEnvelopeSchema,
} from "../protocol/schema.js";
import { PROTOCOL_VERSION } from "../protocol/types.js";

describe("protocol factory", () => {
  it("createRequest produces a valid request envelope", () => {
    const env = createRequest("entities.list", { filter: {} });
    expect(env.type).toBe("request");
    expect(env.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(env.id).toBeTruthy();
    expect(env.payload.method).toBe("entities.list");
    expect(env.payload.args).toEqual({ filter: {} });
  });

  it("createResponse produces a correlated response", () => {
    const req = createRequest("entities.get", { id: "123" });
    const res = createResponse(req.id, { id: "123", name: "Test" });
    expect(res.type).toBe("response");
    expect(res.correlationId).toBe(req.id);
    expect(res.payload.result).toEqual({ id: "123", name: "Test" });
  });

  it("createError produces a typed error", () => {
    const err = createError("PERMISSION_DENIED", "Not allowed", "req-1");
    expect(err.type).toBe("error");
    expect(err.payload.code).toBe("PERMISSION_DENIED");
    expect(err.correlationId).toBe("req-1");
  });

  it("createEvent has no correlationId", () => {
    const ev = createEvent("afterSave", { entityId: "abc" });
    expect(ev.type).toBe("event");
    expect(ev.correlationId).toBeUndefined();
  });

  it("createHandshake contains pluginId and protocolVersion", () => {
    const hs = createHandshake("com.example.plugin", ["entities:read"]);
    expect(hs.type).toBe("handshake");
    expect(hs.payload.pluginId).toBe("com.example.plugin");
    expect(hs.payload.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("createHandshakeAck reflects accepted state", () => {
    const ack = createHandshakeAck("hs-1", true, ["entities:read"]);
    expect(ack.type).toBe("handshake-ack");
    expect(ack.payload.accepted).toBe(true);
    expect(ack.payload.grantedPermissions).toContain("entities:read");
  });
});

describe("protocol schema validation", () => {
  it("validates a request envelope", () => {
    const env = createRequest("test.method", { foo: "bar" });
    const result = requestEnvelopeSchema.safeParse(env);
    expect(result.success).toBe(true);
  });

  it("validates a response envelope", () => {
    const env = createResponse("corr-1", { data: 42 });
    const result = responseEnvelopeSchema.safeParse(env);
    expect(result.success).toBe(true);
  });

  it("validates an error envelope", () => {
    const env = createError("INTERNAL_ERROR", "Something went wrong");
    const result = errorEnvelopeSchema.safeParse(env);
    expect(result.success).toBe(true);
  });

  it("rejects an envelope with wrong protocol version", () => {
    const env = {
      ...createRequest("test", {}),
      protocolVersion: "0.0",
    };
    const result = anyEnvelopeSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it("rejects an envelope with unknown type", () => {
    const env = {
      ...createRequest("test", {}),
      type: "unknown-type",
    };
    const result = anyEnvelopeSchema.safeParse(env);
    expect(result.success).toBe(false);
  });

  it("anyEnvelopeSchema accepts all known types", () => {
    const envelopes = [
      createRequest("test", {}),
      createResponse("x", {}),
      createError("TIMEOUT", "timed out"),
      createEvent("afterSave", {}),
      createHandshake("com.x.plugin", []),
      createHandshakeAck("hs-1", true, []),
    ];
    for (const env of envelopes) {
      expect(anyEnvelopeSchema.safeParse(env).success).toBe(true);
    }
  });
});
