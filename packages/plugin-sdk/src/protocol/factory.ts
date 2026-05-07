// ============================================================
// Protocol message factories
// ============================================================

import { nanoid } from "nanoid";
import { PROTOCOL_VERSION } from "./types.js";
import type {
  RequestEnvelope,
  ResponseEnvelope,
  ErrorEnvelope,
  EventEnvelope,
  HandshakeEnvelope,
  HandshakeAckEnvelope,
  PluginErrorCode,
} from "./types.js";

function now(): number {
  return Date.now();
}

export function createRequest(method: string, args: unknown): RequestEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: nanoid(),
    type: "request",
    payload: { method, args },
    timestamp: now(),
  };
}

export function createResponse<T>(
  correlationId: string,
  result: T
): ResponseEnvelope<T> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: nanoid(),
    correlationId,
    type: "response",
    payload: { result },
    timestamp: now(),
  };
}

export function createError(
  code: PluginErrorCode,
  message: string,
  correlationId?: string,
  details?: unknown
): ErrorEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: nanoid(),
    correlationId,
    type: "error",
    payload: { code, message, details },
    timestamp: now(),
  };
}

export function createEvent(event: string, data: unknown): EventEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: nanoid(),
    type: "event",
    payload: { event, data },
    timestamp: now(),
  };
}

export function createHandshake(
  pluginId: string,
  permissions: string[]
): HandshakeEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: nanoid(),
    type: "handshake",
    payload: { pluginId, protocolVersion: PROTOCOL_VERSION, permissions },
    timestamp: now(),
  };
}

export function createHandshakeAck(
  correlationId: string,
  accepted: boolean,
  grantedPermissions: string[],
  reason?: string
): HandshakeAckEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    id: nanoid(),
    correlationId,
    type: "handshake-ack",
    payload: { accepted, grantedPermissions, reason },
    timestamp: now(),
  };
}
