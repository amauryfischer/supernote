// ============================================================
// Plugin Protocol — message envelope types
// ============================================================

export const PROTOCOL_VERSION = "1.0" as const;

export type MessageDirection = "host-to-plugin" | "plugin-to-host";

// ------ Envelope --------------------------------------------

export interface Envelope<T = unknown> {
  /** Protocol version for negotiation */
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  /** Unique correlation ID (nanoid) */
  readonly id: string;
  /** Optional: correlates a Response to a Request */
  readonly correlationId?: string;
  readonly type: MessageType;
  readonly payload: T;
  readonly timestamp: number;
}

// ------ Message types ---------------------------------------

export type MessageType =
  | "request"
  | "response"
  | "event"
  | "error"
  | "handshake"
  | "handshake-ack";

// ------ Request ---------------------------------------------

export interface RequestPayload {
  readonly method: string;
  readonly args: unknown;
}

export type RequestEnvelope = Envelope<RequestPayload> & {
  readonly type: "request";
};

// ------ Response --------------------------------------------

export interface ResponsePayload<T = unknown> {
  readonly result: T;
}

export type ResponseEnvelope<T = unknown> = Envelope<ResponsePayload<T>> & {
  readonly type: "response";
};

// ------ Event -----------------------------------------------

export interface EventPayload {
  readonly event: string;
  readonly data: unknown;
}

export type EventEnvelope = Envelope<EventPayload> & {
  readonly type: "event";
};

// ------ Error -----------------------------------------------

export type PluginErrorCode =
  | "PERMISSION_DENIED"
  | "METHOD_NOT_FOUND"
  | "INVALID_ARGS"
  | "INTERNAL_ERROR"
  | "TIMEOUT"
  | "PLUGIN_NOT_FOUND"
  | "PROTOCOL_MISMATCH";

export interface ErrorPayload {
  readonly code: PluginErrorCode;
  readonly message: string;
  readonly details?: unknown;
}

export type ErrorEnvelope = Envelope<ErrorPayload> & {
  readonly type: "error";
};

// ------ Handshake -------------------------------------------

export interface HandshakePayload {
  readonly pluginId: string;
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly permissions: string[];
}

export type HandshakeEnvelope = Envelope<HandshakePayload> & {
  readonly type: "handshake";
};

export interface HandshakeAckPayload {
  readonly accepted: boolean;
  readonly reason?: string;
  readonly grantedPermissions: string[];
}

export type HandshakeAckEnvelope = Envelope<HandshakeAckPayload> & {
  readonly type: "handshake-ack";
};

// ------ Union -----------------------------------------------

export type AnyEnvelope =
  | RequestEnvelope
  | ResponseEnvelope
  | EventEnvelope
  | ErrorEnvelope
  | HandshakeEnvelope
  | HandshakeAckEnvelope;
