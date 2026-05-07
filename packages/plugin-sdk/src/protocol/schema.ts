// ============================================================
// Plugin Protocol — Zod schemas for runtime message validation
// ============================================================

import { z } from "zod";
import { PROTOCOL_VERSION } from "./types.js";

const envelopeBaseSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  correlationId: z.string().optional(),
  timestamp: z.number(),
});

export const requestEnvelopeSchema = envelopeBaseSchema.extend({
  type: z.literal("request"),
  payload: z.object({
    method: z.string().min(1),
    args: z.unknown(),
  }),
});

export const responseEnvelopeSchema = envelopeBaseSchema.extend({
  type: z.literal("response"),
  correlationId: z.string().min(1),
  payload: z.object({
    result: z.unknown(),
  }),
});

export const eventEnvelopeSchema = envelopeBaseSchema.extend({
  type: z.literal("event"),
  payload: z.object({
    event: z.string().min(1),
    data: z.unknown(),
  }),
});

export const errorEnvelopeSchema = envelopeBaseSchema.extend({
  type: z.literal("error"),
  correlationId: z.string().optional(),
  payload: z.object({
    code: z.enum([
      "PERMISSION_DENIED",
      "METHOD_NOT_FOUND",
      "INVALID_ARGS",
      "INTERNAL_ERROR",
      "TIMEOUT",
      "PLUGIN_NOT_FOUND",
      "PROTOCOL_MISMATCH",
    ]),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const handshakeEnvelopeSchema = envelopeBaseSchema.extend({
  type: z.literal("handshake"),
  payload: z.object({
    pluginId: z.string().min(1),
    protocolVersion: z.literal(PROTOCOL_VERSION),
    permissions: z.array(z.string()),
  }),
});

export const handshakeAckEnvelopeSchema = envelopeBaseSchema.extend({
  type: z.literal("handshake-ack"),
  payload: z.object({
    accepted: z.boolean(),
    reason: z.string().optional(),
    grantedPermissions: z.array(z.string()),
  }),
});

export const anyEnvelopeSchema = z.discriminatedUnion("type", [
  requestEnvelopeSchema,
  responseEnvelopeSchema,
  eventEnvelopeSchema,
  errorEnvelopeSchema,
  handshakeEnvelopeSchema,
  handshakeAckEnvelopeSchema,
]);
