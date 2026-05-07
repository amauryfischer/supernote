// ============================================================
// Client — transport layer (postMessage wrappers with correlation IDs)
// ============================================================

import { nanoid } from "nanoid";
import { anyEnvelopeSchema } from "../protocol/schema.js";
import { PROTOCOL_VERSION } from "../protocol/types.js";
import type { ResponseEnvelope, ErrorEnvelope } from "../protocol/types.js";

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

export interface TransportOptions {
  readonly timeoutMs?: number;
  readonly targetOrigin?: string;
}

/**
 * Client-side transport. Sends requests to parent window via postMessage
 * and awaits correlated responses.
 *
 * Used inside the plugin iframe context.
 */
export class ClientTransport {
  private readonly pending = new Map<string, PendingCall>();
  private readonly timeoutMs: number;
  private readonly targetOrigin: string;
  private eventHandlers = new Map<string, Array<(data: unknown) => void>>();
  private boundHandler: ((ev: MessageEvent) => void) | null = null;

  constructor(
    private readonly win: Window,
    options: TransportOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.targetOrigin = options.targetOrigin ?? "*";
    this.attach();
  }

  private attach(): void {
    this.boundHandler = (ev: MessageEvent) => {
      this.handleMessage(ev);
    };
    this.win.addEventListener("message", this.boundHandler);
  }

  private handleMessage(ev: MessageEvent): void {
    const parsed = anyEnvelopeSchema.safeParse(ev.data);
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
        const error = new Error(err.payload.message);
        pending.reject(error);
      }
      return;
    }

    if (envelope.type === "event") {
      const eventName = envelope.payload.event;
      const handlers = this.eventHandlers.get(eventName);
      if (handlers) {
        for (const h of handlers) {
          h(envelope.payload.data);
        }
      }
    }
  }

  /** Sends a request to parent and returns a promise for the result */
  call<T>(method: string, args: unknown): Promise<T> {
    const id = nanoid();

    const envelope = {
      protocolVersion: PROTOCOL_VERSION,
      id,
      type: "request" as const,
      payload: { method, args },
      timestamp: Date.now(),
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout calling ${method}`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      this.win.parent.postMessage(envelope, this.targetOrigin);
    });
  }

  /** Registers an event handler for plugin events pushed from the host */
  onEvent(event: string, handler: (data: unknown) => void): void {
    let handlers = this.eventHandlers.get(event);
    if (!handlers) {
      handlers = [];
      this.eventHandlers.set(event, handlers);
    }
    handlers.push(handler);
  }

  destroy(): void {
    if (this.boundHandler) {
      this.win.removeEventListener("message", this.boundHandler);
    }
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Transport destroyed"));
    }
    this.pending.clear();
  }
}
