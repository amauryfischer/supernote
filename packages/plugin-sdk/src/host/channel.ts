// ============================================================
// Host — typed postMessage channel with correlation IDs
// ============================================================

import { nanoid } from "nanoid";
import { anyEnvelopeSchema } from "../protocol/schema.js";
import {
  createRequest,
  createError,
  createHandshakeAck,
} from "../protocol/factory.js";
import type {
  AnyEnvelope,
  RequestEnvelope,
  ResponseEnvelope,
  ErrorEnvelope,
} from "../protocol/types.js";
import type { MessagePort } from "./types.js";

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

export interface HostChannelOptions {
  readonly timeoutMs?: number;
}

/**
 * Typed bidirectional channel between host and one plugin.
 * Manages correlation IDs and pending call lifecycle.
 */
export class HostChannel {
  private readonly pending = new Map<string, PendingCall>();
  private readonly timeoutMs: number;
  private messageHandler: ((data: unknown) => void) | null = null;

  constructor(
    private readonly port: MessagePort,
    options: HostChannelOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.attach();
  }

  private attach(): void {
    this.messageHandler = (data: unknown) => {
      this.handleIncoming(data);
    };
    this.port.onmessage = (ev) => {
      this.handleIncoming(ev.data);
    };
  }

  private handleIncoming(data: unknown): void {
    const parsed = anyEnvelopeSchema.safeParse(data);
    if (!parsed.success) return;

    const envelope = parsed.data;

    if (envelope.type === "response" || envelope.type === "error") {
      const correlationId = envelope.correlationId;
      if (!correlationId) return;

      const pending = this.pending.get(correlationId);
      if (!pending) return;

      clearTimeout(pending.timer);
      this.pending.delete(correlationId);

      if (envelope.type === "response") {
        pending.resolve((envelope as ResponseEnvelope).payload.result);
      } else {
        const err = envelope as ErrorEnvelope;
        pending.reject(
          new PluginCallError(
            err.payload.code,
            err.payload.message,
            err.payload.details
          )
        );
      }
    }
  }

  /** Sends a request to the plugin and awaits the correlated response */
  send<T>(method: string, args: unknown): Promise<T> {
    const envelope = createRequest(method, args);
    const id = envelope.id;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new PluginCallError(
            "TIMEOUT",
            `Call to ${method} timed out after ${this.timeoutMs}ms`
          )
        );
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      this.port.postMessage(envelope);
    });
  }

  /** Posts a raw envelope without waiting for response */
  post(envelope: AnyEnvelope): void {
    this.port.postMessage(envelope);
  }

  destroy(): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new PluginCallError("INTERNAL_ERROR", "Channel destroyed"));
    }
    this.pending.clear();
    this.port.onmessage = null;
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}

export class PluginCallError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "PluginCallError";
  }
}
